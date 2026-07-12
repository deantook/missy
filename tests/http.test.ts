import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createDatabase, migrate, type Database } from "../src/db.ts";
import { createHttpApp } from "../src/http.ts";
import { AgentRunError, type UserMcpManager } from "../src/agent-runtime.ts";
import type { RunTurn } from "../src/chat-service.ts";

let database: Database;
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const emails = [`one-${suffix}@example.com`, `two-${suffix}@example.com`];

const mcp = {
  validate: async (token: string) => { if (token === "invalid-token") throw new Error("invalid"); },
  toolsFor: async () => [],
  invalidate: async () => undefined,
  close: async () => undefined,
} as unknown as UserMcpManager;

const runTurn: RunTurn = async ({ message }) => ({
  message: `完成：${message}`,
  usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
});

beforeAll(async () => {
  database = createDatabase(process.env.TEST_DATABASE_URL || "postgresql://dean:postgres@localhost:5432/missy");
  await migrate(database);
});

afterAll(async () => {
  await database.query("DELETE FROM users WHERE email = ANY($1)", [emails]);
  await database.end();
});

function app() {
  return createHttpApp({ database, model: "test:model", dida365McpUrl: "https://example.test", mcpManager: mcp, runTurn });
}

type Authed = { token: string };

async function register(email: string): Promise<Authed> {
  const response = await request(app())
    .post("/v1/auth/register")
    .send({ email, displayName: "测试用户", password: "password123" })
    .expect(201);
  expect(response.body.token).toEqual(expect.any(String));
  expect(response.headers["set-cookie"]).toBeUndefined();
  return { token: response.body.token as string };
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe("multi-user HTTP API", () => {
  it("reports database health and requires authentication", async () => {
    await request(app()).get("/health").expect(200, { status: "ok", database: "ready" });
    await request(app()).get("/v1/me").expect(401);
  });

  it("supports account lifecycle and hides the full Dida token", async () => {
    const { token: initial } = await register(emails[0]!);
    await request(app()).post("/v1/auth/register")
      .send({ email: emails[0], displayName: "重复", password: "password123" }).expect(409);
    await request(app()).put("/v1/me/dida-token").set(bearer(initial))
      .send({ token: "invalid-token" }).expect(400);
    const saved = await request(app()).put("/v1/me/dida-token").set(bearer(initial))
      .send({ token: "valid-token-1234" }).expect(200);
    expect(saved.body.user).toMatchObject({ didaTokenConfigured: true, didaTokenHint: "••••1234" });
    expect(JSON.stringify(saved.body)).not.toContain("valid-token-1234");
    await request(app()).put("/v1/me/password").set(bearer(initial))
      .send({ currentPassword: "bad", newPassword: "newpassword123" }).expect(401);
    await request(app()).put("/v1/me/password").set(bearer(initial))
      .send({ currentPassword: "password123", newPassword: "newpassword123" }).expect(204);
    await request(app()).post("/v1/auth/logout").set(bearer(initial)).expect(204);
    await request(app()).get("/v1/me").set(bearer(initial)).expect(401);
    const login = await request(app()).post("/v1/auth/login")
      .send({ email: emails[0], password: "newpassword123" }).expect(200);
    expect(login.body.token).toEqual(expect.any(String));
  });

  it("persists conversations, usage, titles and enforces ownership", async () => {
    const login = await request(app()).post("/v1/auth/login")
      .send({ email: emails[0], password: "newpassword123" }).expect(200);
    const firstToken = login.body.token as string;
    const created = await request(app()).post("/v1/conversations").set(bearer(firstToken)).send({}).expect(201);
    const id = created.body.conversation.id as string;
    const sent = await request(app()).post(`/v1/conversations/${id}/messages`).set(bearer(firstToken))
      .send({ message: "今天有什么任务？" }).expect(200);
    expect(sent.body.turn.usage).toEqual({ inputTokens: 12, outputTokens: 5, totalTokens: 17 });
    const loaded = await request(app()).get(`/v1/conversations/${id}`).set(bearer(firstToken)).expect(200);
    expect(loaded.body.conversation.title).toBe("今天有什么任务？");
    expect(loaded.body.conversation.usage.totalTokens).toBe(17);
    expect(loaded.body.turns[0].assistantContent).toBe("完成：今天有什么任务？");
    expect(loaded.body.turns[0].feedback).toBeNull();

    const liked = await request(app()).put(`/v1/conversations/${id}/turns/${sent.body.turn.id}/feedback`).set(bearer(firstToken))
      .send({ feedback: "like" }).expect(200);
    expect(liked.body.turn.feedback).toBe("like");
    const disliked = await request(app()).put(`/v1/conversations/${id}/turns/${sent.body.turn.id}/feedback`).set(bearer(firstToken))
      .send({ feedback: "dislike" }).expect(200);
    expect(disliked.body.turn.feedback).toBe("dislike");
    const cleared = await request(app()).put(`/v1/conversations/${id}/turns/${sent.body.turn.id}/feedback`).set(bearer(firstToken))
      .send({ feedback: null }).expect(200);
    expect(cleared.body.turn.feedback).toBeNull();
    await request(app()).put(`/v1/conversations/${id}/turns/${sent.body.turn.id}/feedback`).set(bearer(firstToken))
      .send({ feedback: "meh" }).expect(400);

    const second = await register(emails[1]!);
    await request(app()).get(`/v1/conversations/${id}`).set(bearer(second.token)).expect(404);
    await request(app()).put(`/v1/conversations/${id}/turns/${sent.body.turn.id}/feedback`).set(bearer(second.token))
      .send({ feedback: "like" }).expect(404);
    await request(app()).patch(`/v1/conversations/${id}`).set(bearer(second.token))
      .send({ title: "越权" }).expect(404);
    await request(app()).delete(`/v1/conversations/${id}`).set(bearer(second.token)).expect(404);

    await request(app()).patch(`/v1/conversations/${id}`).set(bearer(firstToken))
      .send({ title: "我的计划" }).expect(200);
    const list = await request(app()).get("/v1/conversations?limit=1").set(bearer(firstToken)).expect(200);
    expect(list.body.conversations[0].title).toBe("我的计划");
    await request(app()).delete(`/v1/conversations/${id}`).set(bearer(firstToken)).expect(204);
    await request(app()).get(`/v1/conversations/${id}`).set(bearer(firstToken)).expect(404);
    const softDeleted = await database.query("SELECT hidden_at FROM conversations WHERE id = $1", [id]);
    expect(softDeleted.rows).toHaveLength(1);
    expect(softDeleted.rows[0].hidden_at).not.toBeNull();
  });

  it("persists token usage from failed agent turns", async () => {
    const login = await request(app()).post("/v1/auth/login")
      .send({ email: emails[0], password: "newpassword123" }).expect(200);
    const token = login.body.token as string;
    const created = await request(app()).post("/v1/conversations").set(bearer(token)).send({}).expect(201);
    const id = created.body.conversation.id as string;
    const failing: RunTurn = async () => { throw new AgentRunError("模型中断", { inputTokens: 9, outputTokens: 2, totalTokens: 11 }); };
    const failingApp = createHttpApp({ database, model: "test:model", dida365McpUrl: "https://example.test", mcpManager: mcp, runTurn: failing });
    const response = await request(failingApp).post(`/v1/conversations/${id}/messages`).set(bearer(token))
      .send({ message: "失败测试" }).expect(502);
    expect(response.body.error.code).toBe("AGENT_ERROR");
    const loaded = await request(app()).get(`/v1/conversations/${id}`).set(bearer(token)).expect(200);
    expect(loaded.body.turns[0]).toMatchObject({ status: "failed", usage: { inputTokens: 9, outputTokens: 2, totalTokens: 11 } });
    expect(loaded.body.conversation.usage.totalTokens).toBe(11);
  });

  it("hides all conversations without deleting their stored data", async () => {
    const login = await request(app()).post("/v1/auth/login")
      .send({ email: emails[0], password: "newpassword123" }).expect(200);
    const token = login.body.token as string;
    const first = await request(app()).post("/v1/conversations").set(bearer(token))
      .send({ title: "待隐藏一" }).expect(201);
    const second = await request(app()).post("/v1/conversations").set(bearer(token))
      .send({ title: "待隐藏二" }).expect(201);

    await request(app()).delete("/v1/conversations").set(bearer(token)).expect(204);
    const list = await request(app()).get("/v1/conversations").set(bearer(token)).expect(200);
    expect(list.body.conversations).toEqual([]);
    await request(app()).get(`/v1/conversations/${first.body.conversation.id}`).set(bearer(token)).expect(404);
    await request(app()).patch(`/v1/conversations/${first.body.conversation.id}`).set(bearer(token))
      .send({ title: "不可修改" }).expect(404);
    await request(app()).post(`/v1/conversations/${first.body.conversation.id}/messages`).set(bearer(token))
      .send({ message: "不可继续" }).expect(404);

    const stored = await database.query(
      "SELECT id, hidden_at FROM conversations WHERE id = ANY($1::uuid[]) ORDER BY id",
      [[first.body.conversation.id, second.body.conversation.id]],
    );
    expect(stored.rows).toHaveLength(2);
    expect(stored.rows.every((row) => row.hidden_at !== null)).toBe(true);

    const fresh = await request(app()).post("/v1/conversations").set(bearer(token))
      .send({ title: "清除后新会话" }).expect(201);
    const refreshed = await request(app()).get("/v1/conversations").set(bearer(token)).expect(200);
    expect(refreshed.body.conversations.map((conversation: { id: string }) => conversation.id)).toEqual([fresh.body.conversation.id]);
  });

  it("streams assistant deltas and persists the completed turn", async () => {
    const login = await request(app()).post("/v1/auth/login")
      .send({ email: emails[0], password: "newpassword123" }).expect(200);
    const token = login.body.token as string;
    const created = await request(app()).post("/v1/conversations").set(bearer(token)).send({}).expect(201);
    const id = created.body.conversation.id as string;
    const streamingRunner: RunTurn = async ({ message, onToken }) => {
      await onToken?.("流式");
      await onToken?.("完成");
      return { message: `流式完成：${message}`, usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 } };
    };
    const streamingApp = createHttpApp({ database, model: "test:model", dida365McpUrl: "https://example.test", mcpManager: mcp, runTurn: streamingRunner });
    const response = await request(streamingApp)
      .post(`/v1/conversations/${id}/messages`)
      .set(bearer(token))
      .set("Accept", "application/x-ndjson")
      .send({ message: "测试" })
      .expect(200)
      .expect("Content-Type", /application\/x-ndjson/);

    const events = response.text.trim().split("\n").map((line) => JSON.parse(line));
    expect(events.map((event) => event.type)).toEqual(["start", "delta", "delta", "done"]);
    expect(events.slice(1, 3).map((event) => event.delta).join("")).toBe("流式完成");
    expect(events.at(-1).turn).toMatchObject({ assistantContent: "流式完成：测试", status: "succeeded", usage: { totalTokens: 10 } });

    const loaded = await request(app()).get(`/v1/conversations/${id}`).set(bearer(token)).expect(200);
    expect(loaded.body.turns[0]).toMatchObject({ assistantContent: "流式完成：测试", status: "succeeded" });
  });

  it("streams debug events when debug is true and omits them otherwise", async () => {
    const login = await request(app()).post("/v1/auth/login")
      .send({ email: emails[0], password: "newpassword123" }).expect(200);
    const token = login.body.token as string;
    const created = await request(app()).post("/v1/conversations").set(bearer(token)).send({}).expect(201);
    const id = created.body.conversation.id as string;

    const debugRunner: RunTurn = async ({ message, onToken, onDebug }) => {
      await onDebug?.({ kind: "mcp", action: "cache_hit" });
      await onDebug?.({ kind: "tool_call", name: "list_tasks", args: { q: "1" }, id: "t1" });
      await onToken?.("ok");
      return { message: `dbg:${message}`, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    };
    const debugApp = createHttpApp({
      database, model: "test:model", dida365McpUrl: "https://example.test", mcpManager: mcp, runTurn: debugRunner,
    });

    const withDebug = await request(debugApp)
      .post(`/v1/conversations/${id}/messages`)
      .set(bearer(token))
      .set("Accept", "application/x-ndjson")
      .send({ message: "带调试", debug: true })
      .expect(200);
    const debugTypes = withDebug.text.trim().split("\n").map((line) => JSON.parse(line).type);
    expect(debugTypes).toContain("debug");
    expect(withDebug.text).toContain('"kind":"tool_call"');

    const created2 = await request(app()).post("/v1/conversations").set(bearer(token)).send({}).expect(201);
    const without = await request(debugApp)
      .post(`/v1/conversations/${created2.body.conversation.id}/messages`)
      .set(bearer(token))
      .set("Accept", "application/x-ndjson")
      .send({ message: "不调试" })
      .expect(200);
    expect(without.text).not.toContain('"type":"debug"');
  });

  it("includes stack on streamed errors only when debug is true", async () => {
    const login = await request(app()).post("/v1/auth/login")
      .send({ email: emails[0], password: "newpassword123" }).expect(200);
    const token = login.body.token as string;
    const created = await request(app()).post("/v1/conversations").set(bearer(token)).send({}).expect(201);
    const id = created.body.conversation.id as string;

    const failing: RunTurn = async ({ onDebug }) => {
      await onDebug?.({ kind: "note", message: "即将失败" });
      throw new AgentRunError("模型中断", { inputTokens: 1, outputTokens: 0, totalTokens: 1 }, {
        cause: new Error("upstream"),
      });
    };
    const failingApp = createHttpApp({
      database, model: "test:model", dida365McpUrl: "https://example.test", mcpManager: mcp, runTurn: failing,
    });

    const debugFail = await request(failingApp)
      .post(`/v1/conversations/${id}/messages`)
      .set(bearer(token))
      .set("Accept", "application/x-ndjson")
      .send({ message: "失败", debug: true })
      .expect(200);
    const debugError = debugFail.text.trim().split("\n").map((line) => JSON.parse(line)).find((e) => e.type === "error");
    expect(debugError.error.stack).toContain("AgentRunError");
    expect(debugError.error.cause).toContain("upstream");

    const created2 = await request(app()).post("/v1/conversations").set(bearer(token)).send({}).expect(201);
    const plainFail = await request(failingApp)
      .post(`/v1/conversations/${created2.body.conversation.id}/messages`)
      .set(bearer(token))
      .set("Accept", "application/x-ndjson")
      .send({ message: "失败2" })
      .expect(200);
    const plainError = plainFail.text.trim().split("\n").map((line) => JSON.parse(line)).find((e) => e.type === "error");
    expect(plainError.error).toEqual({ code: "AGENT_ERROR", message: "模型中断" });
  });

  it("rejects non-boolean debug field", async () => {
    const login = await request(app()).post("/v1/auth/login")
      .send({ email: emails[0], password: "newpassword123" }).expect(200);
    const token = login.body.token as string;
    await request(app()).put("/v1/me/dida-token").set(bearer(token))
      .send({ token: "valid-token-1234" }).expect(200);
    const created = await request(app()).post("/v1/conversations").set(bearer(token)).send({}).expect(201);
    await request(app()).post(`/v1/conversations/${created.body.conversation.id}/messages`).set(bearer(token))
      .send({ message: "x", debug: "yes" })
      .expect(400);
  });

  it("deletes an account and cascades its sessions", async () => {
    const login = await request(app()).post("/v1/auth/login")
      .send({ email: emails[1], password: "password123" }).expect(200);
    const token = login.body.token as string;
    await request(app()).delete("/v1/me").set(bearer(token))
      .send({ password: "password123" }).expect(204);
    await request(app()).get("/v1/me").set(bearer(token)).expect(401);
  });
});
