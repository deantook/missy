# Debug Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本地 `npm run web -- --debug` 启用请求级调试流，前端侧栏实时展示思考 / MCP / 工具调用，错误返回 stack 与 cause。

**Architecture:** Vite `--debug` 注入 `VITE_DEBUG`；前端发消息带 `debug: true`；后端在 NDJSON 上追加 `{ type: "debug", event }`，失败时增强 `error`；轨迹仅内存、不落库。

**Tech Stack:** TypeScript, Express NDJSON, LangGraph agent stream, Vite `define`, vanilla web frontend, vitest + supertest

**Spec:** `docs/superpowers/specs/2026-07-12-debug-mode-design.md`

---

## File structure

| Path | Responsibility |
|------|----------------|
| `src/debug-events.ts` | `DebugEvent` 类型、preview 截断、从 stream message 提取 debug 事件、错误序列化 |
| `src/agent-runtime.ts` | `onDebug` 回调；MCP / agent 阶段发事件；`AgentRunError` 保留 stack/cause |
| `src/chat-service.ts` | 透传 `debug` / `onDebug` |
| `src/http.ts` | 校验 `debug`；写 NDJSON debug 事件；增强 error |
| `web/vite.config.ts` | 解析 `--debug`，`define` `VITE_DEBUG` |
| `web/src/vite-env.d.ts` | `ImportMetaEnv.VITE_DEBUG` |
| `web/src/debug-panel.ts` | 时间线状态（清空 / 追加 / 渲染 HTML） |
| `web/src/main.ts` | 调试侧栏 UI、请求 `debug: true`、消费 debug/error 事件 |
| `web/src/style.css` | 侧栏 / DEBUG 角标样式 |
| `tests/debug-events.test.ts` | 提取与截断单测 |
| `tests/http.test.ts` | debug 流与错误 stack 集成测 |

---

### Task 1: `DebugEvent` 类型与纯函数

**Files:**
- Create: `src/debug-events.ts`
- Create: `tests/debug-events.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/debug-events.test.ts
import { describe, expect, it } from "vitest";
import {
  previewText,
  serializeDebugError,
  debugEventsFromStreamMessage,
} from "../src/debug-events.ts";

describe("debug-events", () => {
  it("truncates preview to 2048 chars with ellipsis", () => {
    const long = "x".repeat(3000);
    const preview = previewText(long);
    expect(preview.length).toBe(2048 + 1); // 2048 + "…"
    expect(preview.endsWith("…")).toBe(true);
  });

  it("serializes stack and cause only for debug payloads", () => {
    const err = new Error("boom");
    err.cause = new Error("root");
    const full = serializeDebugError(err, "AGENT_ERROR", true);
    expect(full).toMatchObject({ code: "AGENT_ERROR", message: "boom" });
    expect(full.stack).toContain("Error: boom");
    expect(full.cause).toContain("root");
    const slim = serializeDebugError(err, "AGENT_ERROR", false);
    expect(slim).toEqual({ code: "AGENT_ERROR", message: "boom" });
    expect(slim).not.toHaveProperty("stack");
  });

  it("extracts thinking, tool_call and tool_result from stream messages", () => {
    const thinking = debugEventsFromStreamMessage({
      getType: () => "ai",
      content: [{ type: "reasoning", reasoning: "先查清单" }],
    });
    expect(thinking).toEqual([{ kind: "thinking", delta: "先查清单" }]);

    const call = debugEventsFromStreamMessage({
      getType: () => "ai",
      tool_calls: [{ id: "c1", name: "list_tasks", args: { date: "today" } }],
    });
    expect(call).toEqual([{
      kind: "tool_call", name: "list_tasks", args: { date: "today" }, id: "c1",
    }]);

    const result = debugEventsFromStreamMessage({
      getType: () => "tool",
      name: "list_tasks",
      tool_call_id: "c1",
      status: "success",
      content: "ok-payload",
    });
    expect(result).toEqual([{
      kind: "tool_result", name: "list_tasks", ok: true, preview: "ok-payload", id: "c1",
    }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/debug-events.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement `src/debug-events.ts`**

```ts
export type DebugEvent =
  | {
      kind: "phase";
      phase: "mcp_connect" | "agent_run" | "interrupt" | "verify";
      status: "start" | "done" | "error";
      detail?: string;
    }
  | { kind: "thinking"; delta: string }
  | { kind: "tool_call"; name: string; args?: unknown; id?: string }
  | { kind: "tool_result"; name: string; ok: boolean; preview: string; id?: string }
  | { kind: "mcp"; action: "cache_hit" | "connect" | "invalidate"; detail?: string }
  | { kind: "note"; message: string };

const PREVIEW_LIMIT = 2048;

export function previewText(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  if (text.length <= PREVIEW_LIMIT) return text;
  return `${text.slice(0, PREVIEW_LIMIT)}…`;
}

export function serializeDebugError(
  error: unknown,
  code: string,
  debug: boolean,
): { code: string; message: string; stack?: string; cause?: string } {
  const err = error instanceof Error ? error : new Error(String(error));
  const payload: { code: string; message: string; stack?: string; cause?: string } = {
    code,
    message: err.message || "请求失败。",
  };
  if (!debug) return payload;
  if (err.stack) payload.stack = err.stack;
  if (err.cause !== undefined) {
    payload.cause = err.cause instanceof Error
      ? (err.cause.stack ?? err.cause.message)
      : String(err.cause);
  }
  return payload;
}

type StreamMessage = {
  getType?: () => string;
  content?: unknown;
  tool_calls?: Array<{ id?: string; name?: string; args?: unknown }>;
  name?: string;
  tool_call_id?: string;
  status?: string;
};

function thinkingDelta(content: unknown): string {
  if (typeof content === "string") return "";
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (!part || typeof part !== "object") return "";
    const record = part as Record<string, unknown>;
    if (record.type === "reasoning" || record.type === "thinking") {
      return String(record.reasoning ?? record.thinking ?? record.text ?? "");
    }
    return "";
  }).join("");
}

export function debugEventsFromStreamMessage(message: StreamMessage): DebugEvent[] {
  const type = message.getType?.();
  const events: DebugEvent[] = [];
  if (type === "ai") {
    const delta = thinkingDelta(message.content);
    if (delta) events.push({ kind: "thinking", delta });
    for (const call of message.tool_calls ?? []) {
      if (!call.name) continue;
      events.push({ kind: "tool_call", name: call.name, args: call.args, id: call.id });
    }
  }
  if (type === "tool") {
    const name = message.name ?? "tool";
    events.push({
      kind: "tool_result",
      name,
      ok: message.status !== "error",
      preview: previewText(message.content ?? ""),
      id: message.tool_call_id,
    });
  }
  return events;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/debug-events.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/debug-events.ts tests/debug-events.test.ts
git commit -m "$(cat <<'EOF'
Add debug event types and stream message extractors.

EOF
)"
```

---

### Task 2: Agent runtime 与 MCP 发出 debug 事件

**Files:**
- Modify: `src/agent-runtime.ts`
- Modify: `src/chat-service.ts`（仅扩展 `RunTurn` / callbacks 类型签名，逻辑在 Task 3 接 http）

- [ ] **Step 1: Update `AgentRunError` to preserve cause**

在 `src/agent-runtime.ts` 将 `AgentRunError` 改为：

```ts
export class AgentRunError extends Error {
  constructor(message: string, readonly usage: TokenUsage, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AgentRunError";
  }
}
```

catch 处：

```ts
} catch (error) {
  throw new AgentRunError(
    error instanceof Error ? error.message : String(error),
    collector.value(),
    { cause: error },
  );
}
```

- [ ] **Step 2: Extend `runAgentTurn` and `UserMcpManager.toolsFor` signatures**

```ts
import {
  debugEventsFromStreamMessage,
  type DebugEvent,
} from "./debug-events.ts";

export type DebugSink = (event: DebugEvent) => void | Promise<void>;

// UserMcpManager.toolsFor
async toolsFor(userId: string, token: string, onDebug?: DebugSink): Promise<readonly NamedTool[]> {
  const fingerprint = this.fingerprint(token);
  const cached = this.cache.get(userId);
  if (cached?.fingerprint === fingerprint) {
    cached.lastUsed = Date.now();
    await onDebug?.({ kind: "mcp", action: "cache_hit" });
    return cached.handle.tools;
  }
  if (cached) await this.invalidate(userId, onDebug);
  await onDebug?.({ kind: "phase", phase: "mcp_connect", status: "start" });
  try {
    const handle = await connectDida365Mcp({ model: this.model, dida365McpUrl: this.url, dida365Token: token });
    this.cache.set(userId, { handle, fingerprint, lastUsed: Date.now() });
    await onDebug?.({ kind: "mcp", action: "connect" });
    await onDebug?.({ kind: "phase", phase: "mcp_connect", status: "done" });
    return handle.tools;
  } catch (error) {
    await onDebug?.({
      kind: "phase",
      phase: "mcp_connect",
      status: "error",
      detail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async invalidate(userId: string, onDebug?: DebugSink): Promise<void> {
  const entry = this.cache.get(userId);
  this.cache.delete(userId);
  if (entry) {
    await onDebug?.({ kind: "mcp", action: "invalidate" });
    await closeMcp(entry.handle).catch(() => undefined);
  }
}
```

`runAgentTurn` 增加 `onDebug?: DebugSink`，在 stream 循环中：

```ts
// 在 messages 分支，解析 AI/tool 后：
for (const event of debugEventsFromStreamMessage(message)) {
  await params.onDebug?.(event);
}
```

并在关键阶段发 phase/note：

```ts
await params.onDebug?.({ kind: "phase", phase: "agent_run", status: "start" });
// ... main stream ...
// before resolveInterruptsWith:
await params.onDebug?.({ kind: "phase", phase: "interrupt", status: "start" });
// after:
await params.onDebug?.({ kind: "phase", phase: "interrupt", status: "done" });
// verification / clarification loops:
await params.onDebug?.({ kind: "note", message: "清单创建回查校验重试" });
await params.onDebug?.({ kind: "phase", phase: "verify", status: "start" });
// on success end:
await params.onDebug?.({ kind: "phase", phase: "agent_run", status: "done" });
```

注意：普通文本 token 仍只走 `onToken`；`thinking` 走 `onDebug`，不要重复塞进 `delta`。

- [ ] **Step 3: Extend `RunTurn` / `StreamCallbacks` in `chat-service.ts`**

```ts
import type { DebugSink } from "./agent-runtime.ts";

type StreamCallbacks = {
  onStart?: (turn: PendingTurn) => void | Promise<void>;
  onDelta?: (delta: string, reset?: boolean) => void | Promise<void>;
  onDebug?: DebugSink;
};

// send/execute params 增加 debug?: boolean（供后续 http 使用；本任务先把 onDebug 传到 mcp + runner）
const tools = await this.mcp.toolsFor(params.userId, params.didaToken, params.onDebug);
const result = await this.runner({
  model: this.model, tools, history, message: params.message,
  conversationId: params.conversationId, allowDelete: params.allowDelete,
  onToken: params.onDelta,
  onDebug: params.onDebug,
});
```

同步更新 `export type RunTurn = typeof runAgentTurn`（因签名变化自动跟随）。

- [ ] **Step 4: Run existing tests**

Run: `npx vitest run tests/agent-interrupt.test.ts tests/http.test.ts tests/debug-events.test.ts`

Expected: PASS（http mock runner 未使用新字段，应兼容）

- [ ] **Step 5: Commit**

```bash
git add src/agent-runtime.ts src/chat-service.ts
git commit -m "$(cat <<'EOF'
Emit debug events from MCP and agent runtime streams.

EOF
)"
```

---

### Task 3: HTTP 层透传 debug 与增强 error

**Files:**
- Modify: `src/http.ts`
- Modify: `tests/http.test.ts`

- [ ] **Step 1: Write failing HTTP tests**

在 `tests/http.test.ts` 的 `describe` 内追加：

```ts
it("streams debug events when debug is true and omits them otherwise", async () => {
  const agent = request.agent(app());
  const login = await agent.post("/v1/auth/login").send({ email: emails[0], password: "newpassword123" }).expect(200);
  const created = await agent.post("/v1/conversations").send({}).expect(201);
  const id = created.body.conversation.id as string;
  const cookie = login.headers["set-cookie"]?.[0];

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
    .set("Cookie", cookie)
    .set("Accept", "application/x-ndjson")
    .send({ message: "带调试", debug: true })
    .expect(200);
  const debugTypes = withDebug.text.trim().split("\n").map((line) => JSON.parse(line).type);
  expect(debugTypes).toContain("debug");
  expect(withDebug.text).toContain('"kind":"tool_call"');

  const created2 = await agent.post("/v1/conversations").send({}).expect(201);
  const without = await request(debugApp)
    .post(`/v1/conversations/${created2.body.conversation.id}/messages`)
    .set("Cookie", cookie)
    .set("Accept", "application/x-ndjson")
    .send({ message: "不调试" })
    .expect(200);
  expect(without.text).not.toContain('"type":"debug"');
});

it("includes stack on streamed errors only when debug is true", async () => {
  const agent = request.agent(app());
  const login = await agent.post("/v1/auth/login").send({ email: emails[0], password: "newpassword123" }).expect(200);
  const created = await agent.post("/v1/conversations").send({}).expect(201);
  const id = created.body.conversation.id as string;
  const cookie = login.headers["set-cookie"]?.[0];

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
    .set("Cookie", cookie)
    .set("Accept", "application/x-ndjson")
    .send({ message: "失败", debug: true })
    .expect(200);
  const debugError = debugFail.text.trim().split("\n").map((line) => JSON.parse(line)).find((e) => e.type === "error");
  expect(debugError.error.stack).toContain("AgentRunError");
  expect(debugError.error.cause).toContain("upstream");

  const created2 = await agent.post("/v1/conversations").send({}).expect(201);
  const plainFail = await request(failingApp)
    .post(`/v1/conversations/${created2.body.conversation.id}/messages`)
    .set("Cookie", cookie)
    .set("Accept", "application/x-ndjson")
    .send({ message: "失败2" })
    .expect(200);
  const plainError = plainFail.text.trim().split("\n").map((line) => JSON.parse(line)).find((e) => e.type === "error");
  expect(plainError.error).toEqual({ code: "AGENT_ERROR", message: "模型中断" });
});

it("rejects non-boolean debug field", async () => {
  const agent = request.agent(app());
  await agent.post("/v1/auth/login").send({ email: emails[0], password: "newpassword123" }).expect(200);
  await agent.put("/v1/me/dida-token").send({ token: "valid-token-1234" }).expect(200);
  const created = await agent.post("/v1/conversations").send({}).expect(201);
  await agent.post(`/v1/conversations/${created.body.conversation.id}/messages`)
    .send({ message: "x", debug: "yes" })
    .expect(400);
});
```

说明：若测试用户尚未配置 dida token，先按现有用例 `put /v1/me/dida-token`；沿用文件内已登录用户状态时注意顺序。

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/http.test.ts -t "debug"`

Expected: FAIL（尚未接受 `debug` / `onDebug`）

- [ ] **Step 3: Implement HTTP wiring**

在 `src/http.ts` 顶部导入：

```ts
import { serializeDebugError } from "./debug-events.ts";
```

在 `POST /v1/conversations/:id/messages`：

```ts
if (body.debug !== undefined && typeof body.debug !== "boolean") {
  return sendError(res, 400, "INVALID_REQUEST", "debug 必须是布尔值。");
}
const debug = body.debug === true;

// non-stream 分支保持原样（可不传 onDebug）

// stream 分支：
const turn = await chat.send({
  userId: user.id,
  didaToken: user.dida_mcp_token,
  conversationId: req.params.id!,
  message,
  allowDelete: body.allowDelete === true,
  debug,
  onStart: (pendingTurn) => { /* 现有 flushHeaders + start */ },
  onDelta: (delta, reset) => write({ type: "delta", delta, reset: reset === true }),
  onDebug: debug ? (event) => write({ type: "debug", event }) : undefined,
});
write({ type: "done", turn });
} catch (error) {
  const details = error as { message?: string; code?: string };
  if (!res.headersSent) throw error;
  write({
    type: "error",
    error: serializeDebugError(error, details.code ?? "AGENT_ERROR", debug),
  });
}
```

确保 `debug` 在 try 外声明，catch 可访问。

- [ ] **Step 4: Run HTTP tests**

Run: `npx vitest run tests/http.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/http.ts tests/http.test.ts
git commit -m "$(cat <<'EOF'
Stream debug NDJSON events and enrich debug errors.

EOF
)"
```

---

### Task 4: Vite `--debug` 注入 `VITE_DEBUG`

**Files:**
- Modify: `web/vite.config.ts`
- Create: `web/src/vite-env.d.ts`

- [ ] **Step 1: Update Vite config**

```ts
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

const debug = process.argv.includes("--debug");
if (debug) {
  process.argv = process.argv.filter((arg) => arg !== "--debug");
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  define: {
    "import.meta.env.VITE_DEBUG": JSON.stringify(debug ? "true" : "false"),
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/health": "http://127.0.0.1:3000",
      "/v1": "http://127.0.0.1:3000",
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
```

- [ ] **Step 2: Add env types**

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEBUG: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 3: Smoke-check config loads**

Run: `node -e "import('./web/vite.config.ts').then((m)=>console.log('ok', typeof m.default))"`

若 ESM/tsx 不便，改为：`npx vite --config web/vite.config.ts --version`（应成功退出，不因未知 `--debug` 失败）。再跑：`npx vite --config web/vite.config.ts --debug --version`（先确认过滤后 Vite 不报 unknown option）。

- [ ] **Step 4: Commit**

```bash
git add web/vite.config.ts web/src/vite-env.d.ts
git commit -m "$(cat <<'EOF'
Inject VITE_DEBUG from Vite --debug flag.

EOF
)"
```

---

### Task 5: 前端 debug 时间线模块

**Files:**
- Create: `web/src/debug-panel.ts`
- Create: `tests/debug-panel.test.ts`（若 vitest 已能解析 `web/`；否则放 `tests/debug-panel.test.ts` 并只测纯函数）

- [ ] **Step 1: Write failing tests**

```ts
// tests/debug-panel.test.ts
import { describe, expect, it } from "vitest";
import { DebugTimeline, type ClientDebugEvent } from "../web/src/debug-panel.ts";

describe("DebugTimeline", () => {
  it("clears on start and appends events", () => {
    const timeline = new DebugTimeline();
    timeline.append({ kind: "note", message: "old" });
    timeline.clear();
    expect(timeline.entries).toEqual([]);
    timeline.append({ kind: "mcp", action: "connect" });
    timeline.append({ kind: "thinking", delta: "a" });
    timeline.append({ kind: "thinking", delta: "b" });
    expect(timeline.entries).toHaveLength(2);
    expect(timeline.entries[1]).toMatchObject({ kind: "thinking", text: "ab" });
  });

  it("stores error details", () => {
    const timeline = new DebugTimeline();
    timeline.setError({ code: "AGENT_ERROR", message: "x", stack: "stack" });
    expect(timeline.error?.stack).toBe("stack");
    timeline.clear();
    expect(timeline.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/debug-panel.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement `web/src/debug-panel.ts`**

```ts
export type ClientDebugEvent =
  | { kind: "phase"; phase: string; status: string; detail?: string }
  | { kind: "thinking"; delta: string }
  | { kind: "tool_call"; name: string; args?: unknown; id?: string }
  | { kind: "tool_result"; name: string; ok: boolean; preview: string; id?: string }
  | { kind: "mcp"; action: string; detail?: string }
  | { kind: "note"; message: string };

export type TimelineEntry =
  | { kind: "phase"; phase: string; status: string; detail?: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_call"; name: string; args?: unknown; id?: string }
  | { kind: "tool_result"; name: string; ok: boolean; preview: string; id?: string }
  | { kind: "mcp"; action: string; detail?: string }
  | { kind: "note"; message: string };

export type DebugError = { code: string; message: string; stack?: string; cause?: string };

export class DebugTimeline {
  entries: TimelineEntry[] = [];
  error: DebugError | null = null;

  clear(): void {
    this.entries = [];
    this.error = null;
  }

  append(event: ClientDebugEvent): void {
    if (event.kind === "thinking") {
      const last = this.entries.at(-1);
      if (last?.kind === "thinking") {
        last.text += event.delta;
        return;
      }
      this.entries.push({ kind: "thinking", text: event.delta });
      return;
    }
    this.entries.push(event);
  }

  setError(error: DebugError): void {
    this.error = error;
  }

  renderHtml(escapeHtml: (value: unknown) => string): string {
    const errorBlock = this.error
      ? `<div class="debug-error"><div class="debug-tag">error</div><pre>${escapeHtml(this.error.message)}
code: ${escapeHtml(this.error.code)}
${this.error.cause ? `cause:\n${escapeHtml(this.error.cause)}\n` : ""}${this.error.stack ? `stack:\n${escapeHtml(this.error.stack)}` : ""}</pre></div>`
      : "";
    const items = this.entries.map((entry) => {
      if (entry.kind === "thinking") {
        return `<div class="debug-item thinking"><div class="debug-tag">thinking</div><pre>${escapeHtml(entry.text)}</pre></div>`;
      }
      if (entry.kind === "tool_call") {
        return `<div class="debug-item tool"><div class="debug-tag">tool_call</div><strong>${escapeHtml(entry.name)}</strong><pre>${escapeHtml(JSON.stringify(entry.args ?? {}, null, 2))}</pre></div>`;
      }
      if (entry.kind === "tool_result") {
        return `<div class="debug-item tool ${entry.ok ? "ok" : "bad"}"><div class="debug-tag">tool_result</div><strong>${escapeHtml(entry.name)}</strong><pre>${escapeHtml(entry.preview)}</pre></div>`;
      }
      if (entry.kind === "mcp") {
        return `<div class="debug-item mcp"><div class="debug-tag">mcp</div><span>${escapeHtml(entry.action)}${entry.detail ? ` · ${escapeHtml(entry.detail)}` : ""}</span></div>`;
      }
      if (entry.kind === "phase") {
        return `<div class="debug-item phase"><div class="debug-tag">phase</div><span>${escapeHtml(entry.phase)} · ${escapeHtml(entry.status)}${entry.detail ? ` · ${escapeHtml(entry.detail)}` : ""}</span></div>`;
      }
      return `<div class="debug-item note"><div class="debug-tag">note</div><span>${escapeHtml(entry.message)}</span></div>`;
    }).join("");
    return `${errorBlock}${items || '<p class="debug-empty">等待本轮调试事件…</p>'}`;
  }
}

export const isDebugBuild = (): boolean => import.meta.env.VITE_DEBUG === "true";
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/debug-panel.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/debug-panel.ts tests/debug-panel.test.ts
git commit -m "$(cat <<'EOF'
Add client debug timeline helper for the side panel.

EOF
)"
```

---

### Task 6: 接入主 UI 与样式

**Files:**
- Modify: `web/src/main.ts`
- Modify: `web/src/style.css`

- [ ] **Step 1: Wire state and StreamEvent types in `main.ts`**

```ts
import { DebugTimeline, isDebugBuild, type ClientDebugEvent } from "./debug-panel.ts";

const debugEnabled = isDebugBuild();
const debugTimeline = new DebugTimeline();
const debugPanelStorageKey = "missy.debugPanelCollapsed";
let debugPanelCollapsed = (() => {
  try { return localStorage.getItem(debugPanelStorageKey) === "true"; }
  catch { return false; }
})();

type StreamEvent =
  | { type: "start"; turn: Turn }
  | { type: "delta"; delta: string; reset?: boolean }
  | { type: "debug"; event: ClientDebugEvent }
  | { type: "done"; turn: Turn }
  | { type: "error"; error: { code?: string; message?: string; stack?: string; cause?: string } };
```

- [ ] **Step 2: Update `streamApi` body + `sendMessage` handlers**

发送时：

```ts
await streamApi(
  `/v1/conversations/${conversationId}/messages`,
  { message, allowDelete: false, ...(debugEnabled ? { debug: true } : {}) },
  (event) => {
    if (event.type === "start") {
      Object.assign(optimistic, event.turn);
      if (debugEnabled) {
        debugTimeline.clear();
        renderDebugPanel();
      }
    } else if (event.type === "debug") {
      debugTimeline.append(event.event);
      renderDebugPanel();
    } else if (event.type === "delta") {
      // existing
    } else if (event.type === "done") {
      turns[turns.length - 1] = event.turn;
    } else {
      if (debugEnabled) {
        debugTimeline.setError({
          code: event.error.code ?? "AGENT_ERROR",
          message: event.error.message || "请求失败。",
          stack: event.error.stack,
          cause: event.error.cause,
        });
        renderDebugPanel();
      }
      throw new Error(event.error.message || "请求失败。");
    }
  },
);
```

切换会话 `openConversation` 时：`debugTimeline.clear();`（若 debugEnabled）。

- [ ] **Step 3: Render panel inside `renderApp`**

在 `.app-shell` 结构中，当 `debugEnabled` 时让主区域变为 `chat-pane + debug-pane`：

```ts
function renderDebugPanel(): void {
  const mount = document.querySelector("#debug-timeline");
  if (!mount) return;
  mount.innerHTML = debugTimeline.renderHtml(escapeHtml);
  mount.scrollTop = mount.scrollHeight;
}

function bindDebugPanel(): void {
  if (!debugEnabled) return;
  document.querySelector("#debug-clear")?.addEventListener("click", () => {
    debugTimeline.clear();
    renderDebugPanel();
  });
  document.querySelector("#debug-toggle")?.addEventListener("click", () => {
    debugPanelCollapsed = !debugPanelCollapsed;
    try { localStorage.setItem(debugPanelStorageKey, String(debugPanelCollapsed)); } catch { /* ignore */ }
    document.querySelector(".app-shell")?.classList.toggle("debug-collapsed", debugPanelCollapsed);
  });
  renderDebugPanel();
}
```

HTML 片段（插在 chat-pane 之后）：

```html
${debugEnabled ? `<aside class="debug-pane" aria-label="调试面板">
  <header class="debug-header">
    <strong>调试</strong>
    <span class="debug-badge">DEBUG</span>
    <div class="debug-actions">
      <button id="debug-clear" type="button">清空</button>
      <button id="debug-toggle" type="button">${debugPanelCollapsed ? "展开" : "折叠"}</button>
    </div>
  </header>
  <div id="debug-timeline" class="debug-timeline"></div>
</aside>` : ""}
```

`app-shell` class：`${debugEnabled ? "has-debug" : ""} ${debugPanelCollapsed ? "debug-collapsed" : ""}`；页面角标可放在 `chat-header`：`${debugEnabled ? '<span class="debug-corner">DEBUG</span>' : ""}`。

在 `bindAppEvents` 末尾调用 `bindDebugPanel()`。

- [ ] **Step 4: Add CSS**

追加到 `web/src/style.css`：

```css
.app-shell.has-debug{grid-template-columns:270px 1fr 320px}
.app-shell.has-debug.debug-collapsed{grid-template-columns:270px 1fr 0}
.app-shell.has-debug.sidebar-collapsed{grid-template-columns:0 1fr 320px}
.app-shell.has-debug.sidebar-collapsed.debug-collapsed{grid-template-columns:0 1fr 0}
.debug-pane{display:flex;min-width:0;flex-direction:column;border-left:1px solid #deddd6;background:#1f201e;color:#e8e7e1;overflow:hidden}
.app-shell.debug-collapsed .debug-pane{opacity:0;pointer-events:none}
.debug-header{display:flex;align-items:center;gap:8px;height:67px;padding:0 14px;border-bottom:1px solid #32332f}
.debug-header strong{font-size:13px}
.debug-badge,.debug-corner{padding:2px 7px;border-radius:999px;background:#df604c;color:#fff;font-size:10px;font-weight:700;letter-spacing:.08em}
.debug-corner{margin-left:8px}
.debug-actions{margin-left:auto;display:flex;gap:6px}
.debug-actions button{border:1px solid #3c3d39;border-radius:8px;background:#2a2b28;color:#d0cfc8;font-size:11px;padding:5px 8px}
.debug-timeline{min-height:0;flex:1;overflow:auto;padding:12px;font-size:12px;line-height:1.5}
.debug-empty{color:#8b8c86}
.debug-item{margin:0 0 10px;padding:8px 9px;border:1px solid #33342f;border-radius:8px;background:#262723}
.debug-tag{display:inline-block;margin-bottom:4px;color:#df604c;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}
.debug-item pre{margin:6px 0 0;white-space:pre-wrap;word-break:break-word;color:#cfcfc7;font-family:"SFMono-Regular",Consolas,monospace;font-size:11px}
.debug-error{margin:0 0 12px;padding:10px;border:1px solid #7a3a30;border-radius:8px;background:#3a221e}
.debug-error .debug-tag{color:#ff8f7a}
@media(max-width:960px){
  .app-shell.has-debug{grid-template-columns:270px 1fr}
  .debug-pane{position:fixed;z-index:12;left:0;right:0;bottom:0;height:42vh;border-left:0;border-top:1px solid #333}
  .app-shell.debug-collapsed .debug-pane{transform:translateY(105%)}
}
```

（实现时可按现有 sidebar 折叠 class 微调 grid，保证与 `#sidebar-open` 不冲突。）

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/main.ts web/src/style.css
git commit -m "$(cat <<'EOF'
Show live debug side panel when Vite starts with --debug.

EOF
)"
```

---

### Task 7: 手工验收与回归

**Files:** none（验证）

- [ ] **Step 1: Run full automated suite**

Run: `npm test && npm run typecheck`

Expected: all PASS

- [ ] **Step 2: Manual — normal web**

1. 终端 A：`npm run serve`（或现有后端启动方式）
2. 终端 B：`npm run web`
3. 打开聊天页：无 `DEBUG` 角标、无调试侧栏
4. 发一条消息：Network 请求 body 无 `debug: true`；NDJSON 无 `type:"debug"`

- [ ] **Step 3: Manual — debug web**

1. `npm run web -- --debug`
2. 可见 DEBUG 角标与侧栏
3. 发消息：侧栏出现 `mcp` / `phase` / `tool_*`（视实际工具调用）；思考块在模型支持时出现
4. 人为制造失败（如临时无效 token 或 mock）：侧栏错误区可见 stack/cause
5. 刷新页面：侧栏内容清空；折叠偏好保留

- [ ] **Step 4: Final commit if CSS/UI tweaks were needed**

```bash
git add -A
git status
# only commit intentional fixes
git commit -m "$(cat <<'EOF'
Polish debug panel layout after manual verification.

EOF
)"
```

---

## Spec coverage checklist

| Spec 要求 | Task |
|-----------|------|
| `npm run web` / `npm run web -- --debug` | 4, 6, 7 |
| `VITE_DEBUG` define | 4 |
| 请求 `debug: true` | 3, 6 |
| NDJSON `debug` 事件形状 | 1, 2, 3 |
| thinking / tool / mcp / phase / note | 1, 2 |
| error stack/cause 仅 debug | 1, 3, 6 |
| 不落库 | 2, 3（error_message 仍短消息） |
| 侧栏 UI + 折叠 localStorage | 5, 6 |
| preview 截断 / 无 token 泄露 | 1, 2 |
| 测试 | 1, 3, 5, 7 |

## Self-review notes

- 无 TBD / “similar to Task N” 占位
- `DebugSink` / `DebugEvent` / `ClientDebugEvent` 字段与 spec 一致
- `AgentRunError` 的 `cause` 选项在 Task 2 与 Task 3 测试中一致使用
- 窄屏用底部抽屉等价实现，写在 Task 6 CSS `@media`
