import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "./db.ts";
import { databaseReady } from "./db.ts";
import { ChatService, type RunTurn } from "./chat-service.ts";
import { serializeDebugError } from "./debug-events.ts";
import { UserMcpManager } from "./agent-runtime.ts";
import {
  createSession, deleteSessionByToken, hashPassword, publicUser,
  readBearerToken, userFromBearer, verifyPassword, type UserRecord,
} from "./auth.ts";

type ErrorCode = "INVALID_REQUEST" | "UNAUTHORIZED" | "EMAIL_CONFLICT" | "INVALID_CREDENTIALS" |
  "NOT_FOUND" | "DIDA_TOKEN_REQUIRED" | "DIDA_TOKEN_INVALID" | "AGENT_ERROR" | "INTERNAL_ERROR" | "NOT_READY";

function sendError(res: Response, status: number, code: ErrorCode, message: string) {
  res.status(status).json({ error: { code, message } });
}

function bodyOf(req: Request): Record<string, unknown> {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw Object.assign(new Error("请求体必须是 JSON 对象。"), { status: 400, code: "INVALID_REQUEST" });
  }
  return req.body as Record<string, unknown>;
}

function textField(body: Record<string, unknown>, name: string, options: { min?: number; max?: number; optional?: boolean } = {}): string | undefined {
  const value = body[name];
  if (value === undefined && options.optional) return undefined;
  if (typeof value !== "string" || value.trim().length < (options.min ?? 1) || value.trim().length > (options.max ?? 10_000)) {
    throw Object.assign(new Error(`${name} 格式不正确。`), { status: 400, code: "INVALID_REQUEST" });
  }
  return value.trim();
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !emailPattern.test(email)) throw Object.assign(new Error("邮箱格式不正确。"), { status: 400, code: "INVALID_REQUEST" });
  return email;
}

function numberValue(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

function conversationJson(row: Record<string, unknown>) {
  return {
    id: row.id, title: row.title,
    usage: { inputTokens: numberValue(row.input_tokens), outputTokens: numberValue(row.output_tokens), totalTokens: numberValue(row.total_tokens) },
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function turnJson(row: Record<string, unknown>) {
  return {
    id: row.id,
    userContent: row.user_content,
    assistantContent: row.assistant_content,
    status: row.status,
    errorMessage: row.error_message,
    feedback: row.feedback ?? null,
    usage: row.total_tokens === null
      ? { inputTokens: null, outputTokens: null, totalTokens: null }
      : { inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens), totalTokens: Number(row.total_tokens) },
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function createHttpApp(params: {
  database: Database;
  model: string;
  dida365McpUrl: string;
  production?: boolean;
  corsOrigins?: string[];
  mcpManager?: UserMcpManager;
  runTurn?: RunTurn;
  ready?: () => boolean;
}) {
  const app = express();
  const mcp = params.mcpManager ?? new UserMcpManager(params.model, params.dida365McpUrl);
  const chat = new ChatService(params.database, params.model, mcp, params.runTurn);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));

  const allowedOrigins = new Set(params.corsOrigins ?? []);
  app.use((req, res, next) => {
    const origin = req.header("origin");
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get("/health", async (_req, res) => {
    const db = await databaseReady(params.database);
    const ready = db && (params.ready?.() ?? true);
    res.status(ready ? 200 : 503).json({ status: ready ? "ok" : "not_ready", database: db ? "ready" : "not_ready" });
  });

  const authenticated = async (req: Request, res: Response): Promise<UserRecord | null> => {
    const user = await userFromBearer(params.database, req.header("authorization"));
    if (!user) sendError(res, 401, "UNAUTHORIZED", "请先登录。");
    return user;
  };

  app.post("/v1/auth/register", async (req, res) => {
    const body = bodyOf(req);
    const email = normalizeEmail(textField(body, "email", { max: 254 })!);
    const password = textField(body, "password", { min: 8, max: 128 })!;
    const displayName = textField(body, "displayName", { min: 1, max: 80 })!;
    try {
      const result = await params.database.query<UserRecord>(`INSERT INTO users(email, display_name, password_hash)
        VALUES ($1, $2, $3) RETURNING *`, [email, displayName, await hashPassword(password)]);
      const session = await createSession(params.database, result.rows[0]!.id);
      res.status(201).json({
        user: publicUser(result.rows[0]!),
        token: session.token,
        expiresAt: session.expiresAt.toISOString(),
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return sendError(res, 409, "EMAIL_CONFLICT", "该邮箱已注册。");
      throw error;
    }
  });

  app.post("/v1/auth/login", async (req, res) => {
    const body = bodyOf(req);
    const email = normalizeEmail(textField(body, "email", { max: 254 })!);
    const password = textField(body, "password", { min: 1, max: 128 })!;
    const result = await params.database.query<UserRecord>("SELECT * FROM users WHERE email = $1", [email]);
    const user = result.rows[0];
    if (!user || !await verifyPassword(password, user.password_hash)) return sendError(res, 401, "INVALID_CREDENTIALS", "邮箱或密码错误。");
    const session = await createSession(params.database, user.id);
    res.json({
      user: publicUser(user),
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
    });
  });

  app.post("/v1/auth/logout", async (req, res) => {
    const token = readBearerToken(req.header("authorization"));
    if (token) await deleteSessionByToken(params.database, token);
    res.status(204).end();
  });

  app.get("/v1/me", async (req, res) => {
    const user = await authenticated(req, res); if (!user) return;
    res.json({ user: publicUser(user) });
  });

  app.patch("/v1/me", async (req, res) => {
    const user = await authenticated(req, res); if (!user) return;
    const body = bodyOf(req);
    const emailValue = textField(body, "email", { optional: true, max: 254 });
    const displayName = textField(body, "displayName", { optional: true, min: 1, max: 80 });
    if (!emailValue && !displayName) return sendError(res, 400, "INVALID_REQUEST", "至少提供一个需要修改的字段。");
    try {
      const result = await params.database.query<UserRecord>(`UPDATE users SET email = COALESCE($2, email),
        display_name = COALESCE($3, display_name), updated_at = now() WHERE id = $1 RETURNING *`,
        [user.id, emailValue ? normalizeEmail(emailValue) : null, displayName ?? null]);
      res.json({ user: publicUser(result.rows[0]!) });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return sendError(res, 409, "EMAIL_CONFLICT", "该邮箱已被使用。");
      throw error;
    }
  });

  app.put("/v1/me/password", async (req, res) => {
    const user = await authenticated(req, res); if (!user) return;
    const body = bodyOf(req);
    const current = textField(body, "currentPassword", { min: 1, max: 128 })!;
    const next = textField(body, "newPassword", { min: 8, max: 128 })!;
    if (!await verifyPassword(current, user.password_hash)) return sendError(res, 401, "INVALID_CREDENTIALS", "当前密码错误。");
    await params.database.query("UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1", [user.id, await hashPassword(next)]);
    res.status(204).end();
  });

  app.put("/v1/me/dida-token", async (req, res) => {
    const user = await authenticated(req, res); if (!user) return;
    const token = textField(bodyOf(req), "token", { min: 8, max: 4096 })!;
    try {
      await mcp.validate(token);
    } catch {
      return sendError(res, 400, "DIDA_TOKEN_INVALID", "Dida MCP Token 无效或服务暂时不可用。");
    }
    await mcp.invalidate(user.id);
    const result = await params.database.query<UserRecord>("UPDATE users SET dida_mcp_token = $2, updated_at = now() WHERE id = $1 RETURNING *", [user.id, token]);
    res.json({ user: publicUser(result.rows[0]!) });
  });

  app.delete("/v1/me", async (req, res) => {
    const user = await authenticated(req, res); if (!user) return;
    const password = textField(bodyOf(req), "password", { min: 1, max: 128 })!;
    if (!await verifyPassword(password, user.password_hash)) return sendError(res, 401, "INVALID_CREDENTIALS", "密码错误。");
    await mcp.invalidate(user.id);
    await params.database.query("DELETE FROM users WHERE id = $1", [user.id]);
    res.status(204).end();
  });

  app.get("/v1/conversations", async (req, res) => {
    const user = await authenticated(req, res); if (!user) return;
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 50);
    let cursorDate: string | null = null; let cursorId: string | null = null;
    if (typeof req.query.cursor === "string") {
      try { [cursorDate, cursorId] = Buffer.from(req.query.cursor, "base64url").toString().split("|") as [string, string]; } catch { return sendError(res, 400, "INVALID_REQUEST", "cursor 无效。"); }
    }
    const result = await params.database.query(`SELECT * FROM conversations WHERE user_id = $1 AND hidden_at IS NULL
      AND ($2::timestamptz IS NULL OR (updated_at, id) < ($2::timestamptz, $3::uuid))
      ORDER BY updated_at DESC, id DESC LIMIT $4`, [user.id, cursorDate, cursorId, limit + 1]);
    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    const last = rows.at(-1);
    res.json({ conversations: rows.map(conversationJson), nextCursor: hasMore && last ? Buffer.from(`${new Date(last.updated_at).toISOString()}|${last.id}`).toString("base64url") : null });
  });

  app.post("/v1/conversations", async (req, res) => {
    const user = await authenticated(req, res); if (!user) return;
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? bodyOf(req) : {};
    const title = textField(body, "title", { optional: true, min: 1, max: 100 });
    const result = await params.database.query(`INSERT INTO conversations(user_id, title, title_is_custom)
      VALUES ($1, $2, $3) RETURNING *`, [user.id, title ?? "新对话", Boolean(title)]);
    res.status(201).json({ conversation: conversationJson(result.rows[0]) });
  });

  app.delete("/v1/conversations", async (req, res) => {
    const user = await authenticated(req, res); if (!user) return;
    await params.database.query(
      "UPDATE conversations SET hidden_at = now() WHERE user_id = $1 AND hidden_at IS NULL",
      [user.id],
    );
    res.status(204).end();
  });

  app.get("/v1/conversations/:id", async (req, res) => {
    const user = await authenticated(req, res); if (!user) return;
    const conversation = await params.database.query("SELECT * FROM conversations WHERE id = $1 AND user_id = $2 AND hidden_at IS NULL", [req.params.id, user.id]);
    if (!conversation.rowCount) return sendError(res, 404, "NOT_FOUND", "会话不存在。");
    const turns = await params.database.query(`SELECT * FROM chat_turns WHERE conversation_id = $1 ORDER BY created_at, id`, [req.params.id]);
    res.json({ conversation: conversationJson(conversation.rows[0]), turns: turns.rows.map(turnJson) });
  });

  app.put("/v1/conversations/:id/turns/:turnId/feedback", async (req, res) => {
    const user = await authenticated(req, res); if (!user) return;
    const body = bodyOf(req);
    if (!("feedback" in body)) return sendError(res, 400, "INVALID_REQUEST", "必须提供 feedback 字段。");
    const feedback = body.feedback;
    if (feedback !== null && feedback !== "like" && feedback !== "dislike") {
      return sendError(res, 400, "INVALID_REQUEST", "feedback 必须是 like、dislike 或 null。");
    }
    const conversation = await params.database.query("SELECT id FROM conversations WHERE id = $1 AND user_id = $2 AND hidden_at IS NULL", [req.params.id, user.id]);
    if (!conversation.rowCount) return sendError(res, 404, "NOT_FOUND", "会话不存在。");
    const result = await params.database.query(
      `UPDATE chat_turns SET feedback = $3, feedback_at = CASE WHEN $3::text IS NULL THEN NULL ELSE now() END
       WHERE id = $1 AND conversation_id = $2 AND status = 'succeeded' RETURNING *`,
      [req.params.turnId, req.params.id, feedback],
    );
    if (!result.rowCount) return sendError(res, 404, "NOT_FOUND", "回复不存在或尚未成功完成。");
    res.json({ turn: turnJson(result.rows[0]!) });
  });

  app.patch("/v1/conversations/:id", async (req, res) => {
    const user = await authenticated(req, res); if (!user) return;
    const title = textField(bodyOf(req), "title", { min: 1, max: 100 })!;
    const result = await params.database.query(`UPDATE conversations SET title = $3, title_is_custom = true, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND hidden_at IS NULL RETURNING *`, [req.params.id, user.id, title]);
    if (!result.rowCount) return sendError(res, 404, "NOT_FOUND", "会话不存在。");
    res.json({ conversation: conversationJson(result.rows[0]) });
  });

  app.delete("/v1/conversations/:id", async (req, res) => {
    const user = await authenticated(req, res); if (!user) return;
    const result = await params.database.query(
      "UPDATE conversations SET hidden_at = now() WHERE id = $1 AND user_id = $2 AND hidden_at IS NULL RETURNING id",
      [req.params.id, user.id],
    );
    if (!result.rowCount) return sendError(res, 404, "NOT_FOUND", "会话不存在。");
    res.status(204).end();
  });

  app.post("/v1/conversations/:id/messages", async (req, res) => {
    const user = await authenticated(req, res); if (!user) return;
    if (!user.dida_mcp_token) return sendError(res, 409, "DIDA_TOKEN_REQUIRED", "请先配置 Dida MCP Token。");
    const body = bodyOf(req);
    const message = textField(body, "message", { min: 1, max: 4000 })!;
    if (body.allowDelete !== undefined && typeof body.allowDelete !== "boolean") return sendError(res, 400, "INVALID_REQUEST", "allowDelete 必须是布尔值。");
    if (body.debug !== undefined && typeof body.debug !== "boolean") return sendError(res, 400, "INVALID_REQUEST", "debug 必须是布尔值。");
    const debug = body.debug === true;
    const stream = req.header("accept")?.split(",").some((value) => value.trim().split(";")[0] === "application/x-ndjson") === true;
    if (!stream) {
      const turn = await chat.send({ userId: user.id, didaToken: user.dida_mcp_token, conversationId: req.params.id!, message, allowDelete: body.allowDelete === true });
      return res.json({ turn });
    }

    const write = (event: unknown) => {
      if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`);
    };
    try {
      const turn = await chat.send({
        userId: user.id, didaToken: user.dida_mcp_token, conversationId: req.params.id!, message,
        allowDelete: body.allowDelete === true,
        onStart: (pendingTurn) => {
          res.status(200).set({
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
          });
          res.flushHeaders();
          write({ type: "start", turn: pendingTurn });
        },
        onDelta: (delta, reset) => write({ type: "delta", delta, reset: reset === true }),
        onDebug: debug ? (event) => write({ type: "debug", event }) : undefined,
      });
      write({ type: "done", turn });
    } catch (error) {
      const details = error as { message?: string; code?: string };
      if (!res.headersSent) throw error;
      write({ type: "error", error: serializeDebugError(error, details.code ?? "AGENT_ERROR", debug) });
    } finally {
      if (!res.writableEnded) res.end();
    }
  });

  if (params.production) {
    const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web/dist");
    app.all("/v1/{*path}", (_req, res) => sendError(res, 404, "NOT_FOUND", "接口不存在。"));
    app.use(express.static(webRoot));
    app.get("/{*path}", (_req, res) => res.sendFile(path.join(webRoot, "index.html")));
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const details = error as { status?: number; code?: ErrorCode; message?: string };
    if (error instanceof SyntaxError || details.status === 400 && !details.code) return sendError(res, 400, "INVALID_REQUEST", "请求体不是有效的 JSON。");
    if ((error as { code?: string }).code === "22P02") return sendError(res, 400, "INVALID_REQUEST", "资源 ID 或游标格式无效。");
    if (details.status && details.code) return sendError(res, details.status, details.code, details.message ?? "请求失败。");
    console.error(error);
    sendError(res, 500, "INTERNAL_ERROR", "服务发生内部错误。");
  });
  return app;
}
