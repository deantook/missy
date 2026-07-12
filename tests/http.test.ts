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

async function register(email: string) {
  const agent = request.agent(app());
  const response = await agent.post("/v1/auth/register").send({ email, displayName: "测试用户", password: "password123" }).expect(201);
  expect(response.headers["set-cookie"]?.[0]).toContain("missy_session=");
  return agent;
}

describe("multi-user HTTP API", () => {
  it("reports database health and requires authentication", async () => {
    await request(app()).get("/health").expect(200, { status: "ok", database: "ready" });
    await request(app()).get("/v1/me").expect(401);
  });

  it("supports account lifecycle and hides the full Dida token", async () => {
    const agent = await register(emails[0]!);
    await agent.post("/v1/auth/register").send({ email: emails[0], displayName: "重复", password: "password123" }).expect(409);
    await agent.put("/v1/me/dida-token").send({ token: "invalid-token" }).expect(400);
    const saved = await agent.put("/v1/me/dida-token").send({ token: "valid-token-1234" }).expect(200);
    expect(saved.body.user).toMatchObject({ didaTokenConfigured: true, didaTokenHint: "••••1234" });
    expect(JSON.stringify(saved.body)).not.toContain("valid-token-1234");
    await agent.put("/v1/me/password").send({ currentPassword: "bad", newPassword: "newpassword123" }).expect(401);
    await agent.put("/v1/me/password").send({ currentPassword: "password123", newPassword: "newpassword123" }).expect(204);
    await agent.post("/v1/auth/logout").expect(204);
    await agent.get("/v1/me").expect(401);
    await agent.post("/v1/auth/login").send({ email: emails[0], password: "newpassword123" }).expect(200);
  });

  it("persists conversations, usage, titles and enforces ownership", async () => {
    const first = request.agent(app());
    await first.post("/v1/auth/login").send({ email: emails[0], password: "newpassword123" }).expect(200);
    const created = await first.post("/v1/conversations").send({}).expect(201);
    const id = created.body.conversation.id as string;
    const sent = await first.post(`/v1/conversations/${id}/messages`).send({ message: "今天有什么任务？" }).expect(200);
    expect(sent.body.turn.usage).toEqual({ inputTokens: 12, outputTokens: 5, totalTokens: 17 });
    const loaded = await first.get(`/v1/conversations/${id}`).expect(200);
    expect(loaded.body.conversation.title).toBe("今天有什么任务？");
    expect(loaded.body.conversation.usage.totalTokens).toBe(17);
    expect(loaded.body.turns[0].assistantContent).toBe("完成：今天有什么任务？");
    expect(loaded.body.turns[0].feedback).toBeNull();

    const liked = await first.put(`/v1/conversations/${id}/turns/${sent.body.turn.id}/feedback`).send({ feedback: "like" }).expect(200);
    expect(liked.body.turn.feedback).toBe("like");
    const disliked = await first.put(`/v1/conversations/${id}/turns/${sent.body.turn.id}/feedback`).send({ feedback: "dislike" }).expect(200);
    expect(disliked.body.turn.feedback).toBe("dislike");
    const cleared = await first.put(`/v1/conversations/${id}/turns/${sent.body.turn.id}/feedback`).send({ feedback: null }).expect(200);
    expect(cleared.body.turn.feedback).toBeNull();
    await first.put(`/v1/conversations/${id}/turns/${sent.body.turn.id}/feedback`).send({ feedback: "meh" }).expect(400);

    const second = await register(emails[1]!);
    await second.get(`/v1/conversations/${id}`).expect(404);
    await second.put(`/v1/conversations/${id}/turns/${sent.body.turn.id}/feedback`).send({ feedback: "like" }).expect(404);
    await second.patch(`/v1/conversations/${id}`).send({ title: "越权" }).expect(404);
    await second.delete(`/v1/conversations/${id}`).expect(404);

    await first.patch(`/v1/conversations/${id}`).send({ title: "我的计划" }).expect(200);
    const list = await first.get("/v1/conversations?limit=1").expect(200);
    expect(list.body.conversations[0].title).toBe("我的计划");
    await first.delete(`/v1/conversations/${id}`).expect(204);
    await first.get(`/v1/conversations/${id}`).expect(404);
    const softDeleted = await database.query("SELECT hidden_at FROM conversations WHERE id = $1", [id]);
    expect(softDeleted.rows).toHaveLength(1);
    expect(softDeleted.rows[0].hidden_at).not.toBeNull();
  });

  it("persists token usage from failed agent turns", async () => {
    const agent = request.agent(app());
    const login = await agent.post("/v1/auth/login").send({ email: emails[0], password: "newpassword123" }).expect(200);
    const created = await agent.post("/v1/conversations").send({}).expect(201);
    const id = created.body.conversation.id as string;
    const failing: RunTurn = async () => { throw new AgentRunError("模型中断", { inputTokens: 9, outputTokens: 2, totalTokens: 11 }); };
    const failingApp = createHttpApp({ database, model: "test:model", dida365McpUrl: "https://example.test", mcpManager: mcp, runTurn: failing });
    const cookie = login.headers["set-cookie"]?.[0];
    const response = await request(failingApp).post(`/v1/conversations/${id}/messages`).set("Cookie", cookie).send({ message: "失败测试" }).expect(502);
    expect(response.body.error.code).toBe("AGENT_ERROR");
    const loaded = await agent.get(`/v1/conversations/${id}`).expect(200);
    expect(loaded.body.turns[0]).toMatchObject({ status: "failed", usage: { inputTokens: 9, outputTokens: 2, totalTokens: 11 } });
    expect(loaded.body.conversation.usage.totalTokens).toBe(11);
  });

  it("hides all conversations without deleting their stored data", async () => {
    const agent = request.agent(app());
    await agent.post("/v1/auth/login").send({ email: emails[0], password: "newpassword123" }).expect(200);
    const first = await agent.post("/v1/conversations").send({ title: "待隐藏一" }).expect(201);
    const second = await agent.post("/v1/conversations").send({ title: "待隐藏二" }).expect(201);

    await agent.delete("/v1/conversations").expect(204);
    const list = await agent.get("/v1/conversations").expect(200);
    expect(list.body.conversations).toEqual([]);
    await agent.get(`/v1/conversations/${first.body.conversation.id}`).expect(404);
    await agent.patch(`/v1/conversations/${first.body.conversation.id}`).send({ title: "不可修改" }).expect(404);
    await agent.post(`/v1/conversations/${first.body.conversation.id}/messages`).send({ message: "不可继续" }).expect(404);

    const stored = await database.query(
      "SELECT id, hidden_at FROM conversations WHERE id = ANY($1::uuid[]) ORDER BY id",
      [[first.body.conversation.id, second.body.conversation.id]],
    );
    expect(stored.rows).toHaveLength(2);
    expect(stored.rows.every((row) => row.hidden_at !== null)).toBe(true);

    const fresh = await agent.post("/v1/conversations").send({ title: "清除后新会话" }).expect(201);
    const refreshed = await agent.get("/v1/conversations").expect(200);
    expect(refreshed.body.conversations.map((conversation: { id: string }) => conversation.id)).toEqual([fresh.body.conversation.id]);
  });

  it("streams assistant deltas and persists the completed turn", async () => {
    const agent = request.agent(app());
    const login = await agent.post("/v1/auth/login").send({ email: emails[0], password: "newpassword123" }).expect(200);
    const created = await agent.post("/v1/conversations").send({}).expect(201);
    const id = created.body.conversation.id as string;
    const streamingRunner: RunTurn = async ({ message, onToken }) => {
      await onToken?.("流式");
      await onToken?.("完成");
      return { message: `流式完成：${message}`, usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 } };
    };
    const streamingApp = createHttpApp({ database, model: "test:model", dida365McpUrl: "https://example.test", mcpManager: mcp, runTurn: streamingRunner });
    const response = await request(streamingApp)
      .post(`/v1/conversations/${id}/messages`)
      .set("Cookie", login.headers["set-cookie"]?.[0])
      .set("Accept", "application/x-ndjson")
      .send({ message: "测试" })
      .expect(200)
      .expect("Content-Type", /application\/x-ndjson/);

    const events = response.text.trim().split("\n").map((line) => JSON.parse(line));
    expect(events.map((event) => event.type)).toEqual(["start", "delta", "delta", "done"]);
    expect(events.slice(1, 3).map((event) => event.delta).join("")).toBe("流式完成");
    expect(events.at(-1).turn).toMatchObject({ assistantContent: "流式完成：测试", status: "succeeded", usage: { totalTokens: 10 } });

    const loaded = await agent.get(`/v1/conversations/${id}`).expect(200);
    expect(loaded.body.turns[0]).toMatchObject({ assistantContent: "流式完成：测试", status: "succeeded" });
  });

  it("deletes an account and cascades its sessions", async () => {
    const agent = request.agent(app());
    await agent.post("/v1/auth/login").send({ email: emails[1], password: "password123" }).expect(200);
    await agent.delete("/v1/me").send({ password: "password123" }).expect(204);
    await agent.get("/v1/me").expect(401);
  });
});
