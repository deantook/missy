import { describe, expect, it } from "vitest";
import request from "supertest";
import { createHttpApp } from "../src/http.ts";
import type { TaskAgent } from "../src/conversation.ts";

function fakeAgent(invoke: (input: unknown, config: unknown) => Promise<unknown>): TaskAgent {
  return { invoke } as unknown as TaskAgent;
}

describe("HTTP API", () => {
  it("reports health without authentication", async () => {
    const app = createHttpApp({ agent: fakeAgent(async () => ({})), apiKey: "secret" });
    await request(app).get("/health").expect(200, { status: "ok", mcp: "ready" });
  });

  it("rejects missing or invalid authorization", async () => {
    const app = createHttpApp({ agent: fakeAgent(async () => ({})), apiKey: "secret" });
    await request(app).post("/v1/chat").send({ message: "hi" }).expect(401);
    await request(app).post("/v1/chat").set("Authorization", "Bearer wrong").send({ message: "hi" }).expect(401);
  });

  it("validates the request body", async () => {
    const app = createHttpApp({ agent: fakeAgent(async () => ({})), apiKey: "secret" });
    const call = () => request(app).post("/v1/chat").set("Authorization", "Bearer secret");
    await call().send({}).expect(400);
    await call().send({ message: " " }).expect(400);
    await call().send({ message: "hi", allowDelete: "yes" }).expect(400);
    await call().send({ message: "hi", sessionId: "" }).expect(400);
    await call().set("Content-Type", "application/json").send("{").expect(400, {
      error: { code: "INVALID_REQUEST", message: "请求体不是有效的 JSON。" },
    });
  });

  it("returns a generated or supplied session id and assistant text", async () => {
    const agent = fakeAgent(async () => ({ messages: [{ content: [{ text: "完成" }] }] }));
    const app = createHttpApp({ agent, apiKey: "secret" });
    const generated = await request(app).post("/v1/chat").set("Authorization", "Bearer secret").send({ message: "hi" }).expect(200);
    expect(generated.body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(generated.body.message).toBe("完成");
    expect(generated.body.deleteAuthorized).toBe(false);
    const supplied = await request(app).post("/v1/chat").set("Authorization", "Bearer secret").send({ message: "hi", sessionId: "session-a" }).expect(200);
    expect(supplied.body.sessionId).toBe("session-a");
  });

  it.each([false, true])("resolves delete interrupts with allowDelete=%s", async (allowDelete) => {
    const resumes: unknown[] = [];
    let calls = 0;
    const agent = fakeAgent(async (input) => {
      calls++;
      if (calls === 1) return {
        messages: [],
        __interrupt__: [{ value: { actionRequests: [{ name: "delete_task", args: { id: "1" } }] } }],
      };
      resumes.push(input);
      return { messages: [{ content: allowDelete ? "已删除" : "未删除" }] };
    });
    const app = createHttpApp({ agent, apiKey: "secret" });
    const response = await request(app).post("/v1/chat").set("Authorization", "Bearer secret").send({ message: "delete", allowDelete }).expect(200);
    expect(response.body.deleteAuthorized).toBe(allowDelete);
    expect(JSON.stringify(resumes[0])).toContain(allowDelete ? "approve" : "reject");
  });

  it("serializes requests sharing a session", async () => {
    let active = 0;
    let maxActive = 0;
    const agent = fakeAgent(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
      return { messages: [{ content: "ok" }] };
    });
    const app = createHttpApp({ agent, apiKey: "secret" });
    const send = () => request(app).post("/v1/chat").set("Authorization", "Bearer secret").send({ message: "hi", sessionId: "same" });
    await Promise.all([send(), send()]);
    expect(maxActive).toBe(1);
  });
});
