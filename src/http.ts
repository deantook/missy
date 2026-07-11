import express, { type NextFunction, type Request, type Response } from "express";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { lastAssistantText, resolveInterrupts, type TaskAgent } from "./conversation.ts";

type ErrorCode = "INVALID_REQUEST" | "UNAUTHORIZED" | "INTERNAL_ERROR" | "NOT_READY";

function sendError(res: Response, status: number, code: ErrorCode, message: string) {
  res.status(status).json({ error: { code, message } });
}

function authorized(header: string | undefined, apiKey: string): boolean {
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) return false;
  const supplied = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(apiKey);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function createHttpApp(params: {
  agent: TaskAgent;
  apiKey: string;
  ready?: () => boolean;
}) {
  const app = express();
  const queues = new Map<string, Promise<void>>();
  app.use(express.json({ limit: "64kb" }));

  app.get("/health", (_req, res) => {
    const ready = params.ready?.() ?? true;
    res.status(ready ? 200 : 503).json({ status: ready ? "ok" : "not_ready", mcp: ready ? "ready" : "not_ready" });
  });

  app.post("/v1/chat", async (req, res) => {
    if (!authorized(req.header("authorization"), params.apiKey)) {
      return sendError(res, 401, "UNAUTHORIZED", "缺少或无效的 Bearer API Key。");
    }
    if (!(params.ready?.() ?? true)) {
      return sendError(res, 503, "NOT_READY", "服务尚未连接到 MCP。");
    }

    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return sendError(res, 400, "INVALID_REQUEST", "请求体必须是 JSON 对象。");
    }
    if (typeof body.message !== "string" || !body.message.trim()) {
      return sendError(res, 400, "INVALID_REQUEST", "message 必须是非空字符串。");
    }
    if (body.sessionId !== undefined && (typeof body.sessionId !== "string" || !body.sessionId.trim())) {
      return sendError(res, 400, "INVALID_REQUEST", "sessionId 必须是非空字符串。");
    }
    if (body.allowDelete !== undefined && typeof body.allowDelete !== "boolean") {
      return sendError(res, 400, "INVALID_REQUEST", "allowDelete 必须是布尔值。");
    }

    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : randomUUID();
    const message = body.message.trim();
    const allowDelete = body.allowDelete === true;
    const previous = queues.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.catch(() => undefined).then(() => gate);
    queues.set(sessionId, queued);

    await previous.catch(() => undefined);
    try {
      const config = { configurable: { thread_id: sessionId } };
      let result = await params.agent.invoke({ messages: [{ role: "user", content: message }] }, config);
      result = await resolveInterrupts(
        params.agent,
        result,
        config,
        async () => allowDelete ? "approve" : "reject",
      );
      res.json({ sessionId, message: lastAssistantText(result), deleteAuthorized: allowDelete });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendError(res, 500, "INTERNAL_ERROR", message);
    } finally {
      release();
      if (queues.get(sessionId) === queued) queues.delete(sessionId);
    }
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = error && typeof error === "object" && "status" in error
      ? Number((error as { status: unknown }).status)
      : undefined;
    if (error instanceof SyntaxError || status === 400 || status === 413) {
      return sendError(res, 400, "INVALID_REQUEST", "请求体不是有效的 JSON。");
    }
    sendError(res, 500, "INTERNAL_ERROR", "HTTP 服务发生内部错误。");
  });
  return app;
}
