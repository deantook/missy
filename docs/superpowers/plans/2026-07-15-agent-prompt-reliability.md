# Agent Prompt Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hard-filter habit/tag MCP tools, add B1 parent-task structure verification in the agent runtime, and lightly update system prompt rules 9/11/14 to match.

**Architecture:** Pure `tool-policy.ts` filters tools at MCP connect; `conversation.ts` detects missing `parentId` after multi-task creates (mirroring project verification); `agent-runtime.ts` retries up to 2 times then throws; `prompts.ts` C2 wording only.

**Tech Stack:** TypeScript, Vitest, existing Deep Agents / LangGraph message shapes

**Spec:** `docs/superpowers/specs/2026-07-15-agent-prompt-reliability-design.md`

## Global Constraints

- Do not dynamically re-enable habit/tag tools
- Do not implement B2 strong (≥3 flat tasks) verification
- Do not change choice_prompt examples or rules 1–8, 10, 12, 13
- Reuse existing `verify` debug phase for parent-task retries (same as project verification)
- Prefer filtering inside `connectDida365Mcp` so CLI and HTTP share one path

---

## File structure

| Path | Responsibility |
|------|----------------|
| `src/tool-policy.ts` | `isBlockedToolName`, `filterAgentTools`, `blockedToolNames` |
| `src/mcp.ts` | Apply `filterAgentTools` after `getTools()` |
| `src/index.ts` | Log filtered tool names on CLI startup |
| `src/conversation.ts` | Parent-task verification helpers + args parsing |
| `src/agent-runtime.ts` | Parent-task retry loop after project verification |
| `src/prompts.ts` | Rules 9, 11, 14 C2 wording |
| `tests/tool-policy.test.ts` | Filter unit tests |
| `tests/parent-task-verify.test.ts` | B1 heuristic unit tests |
| `tests/prompts.test.ts` | Assert new prompt phrases |

---

### Task 1: Tool policy filter

**Files:**
- Create: `src/tool-policy.ts`
- Create: `tests/tool-policy.test.ts`
- Modify: `src/mcp.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces: `isBlockedToolName(name: string): boolean`, `filterAgentTools<T extends { name?: string }>(tools: readonly T[]): T[]`, `blockedToolNames(tools: readonly { name?: string }[]): string[]`
- Also extends `McpHandle` with `filteredToolNames: string[]`

- [ ] **Step 1: Write the failing test**

Create `tests/tool-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { blockedToolNames, filterAgentTools, isBlockedToolName } from "../src/tool-policy.ts";

describe("tool-policy", () => {
  it("blocks habit and tag tool names case-insensitively", () => {
    expect(isBlockedToolName("list_habits")).toBe(true);
    expect(isBlockedToolName("Create_Habit")).toBe(true);
    expect(isBlockedToolName("list_tags")).toBe(true);
    expect(isBlockedToolName("CREATE_TAG")).toBe(true);
    expect(isBlockedToolName("create_task")).toBe(false);
    expect(isBlockedToolName("list_projects")).toBe(false);
  });

  it("filters blocked tools and reports their names", () => {
    const tools = [
      { name: "create_task" },
      { name: "list_habits" },
      { name: "list_tags" },
      { name: "list_projects" },
      { name: "get_habit" },
    ];
    expect(filterAgentTools(tools).map((t) => t.name)).toEqual(["create_task", "list_projects"]);
    expect(blockedToolNames(tools).sort()).toEqual(["get_habit", "list_habits", "list_tags"]);
  });

  it("keeps tools without a name", () => {
    expect(filterAgentTools([{}])).toEqual([{}]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/tool-policy.test.ts`

Expected: FAIL — cannot find module `../src/tool-policy.ts`

- [ ] **Step 3: Implement `src/tool-policy.ts`**

```ts
export function isBlockedToolName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes("habit") || lower.includes("tag");
}

export function filterAgentTools<T extends { name?: string }>(tools: readonly T[]): T[] {
  return tools.filter((tool) => typeof tool.name !== "string" || !isBlockedToolName(tool.name));
}

export function blockedToolNames(tools: readonly { name?: string }[]): string[] {
  return tools
    .map((tool) => tool.name)
    .filter((name): name is string => typeof name === "string" && isBlockedToolName(name));
}
```

- [ ] **Step 4: Wire filter into MCP connect**

Update `src/mcp.ts`:

```ts
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { AppConfig } from "./config.ts";
import { blockedToolNames, filterAgentTools } from "./tool-policy.ts";

export type McpHandle = {
  client: MultiServerMCPClient;
  tools: Awaited<ReturnType<MultiServerMCPClient["getTools"]>>;
  filteredToolNames: string[];
};

export async function connectDida365Mcp(
  config: AppConfig,
): Promise<McpHandle> {
  const client = new MultiServerMCPClient({
    mcpServers: {
      dida365: {
        url: config.dida365McpUrl,
        headers: {
          Authorization: `Bearer ${config.dida365Token}`,
        },
        automaticSSEFallback: false,
      },
    },
  });

  try {
    const rawTools = await client.getTools();
    const filteredToolNames = blockedToolNames(rawTools);
    const tools = filterAgentTools(rawTools);
    if (!tools.length) {
      throw new Error(
        "已连接 MCP，但未获取到任何可用工具（或工具均被策略过滤）。请检查 DIDA365_TOKEN 与 DIDA365_MCP_URL。",
      );
    }
    return { client, tools, filteredToolNames };
  } catch (err) {
    await client.close().catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`无法连接滴答清单 MCP（${config.dida365McpUrl}）：${message}`);
  }
}

export async function closeMcp(handle: McpHandle): Promise<void> {
  await handle.client.close();
}
```

Update CLI log in `src/index.ts`:

```ts
console.log(
  `已连接 MCP，工具数: ${mcp.tools.length}` +
    (mcp.filteredToolNames.length ? `；已过滤: ${mcp.filteredToolNames.join(", ")}` : "") +
    `；删除确认: ${Object.keys(interruptOn).join(", ") || "(无)"}`,
);
```

HTTP path needs no extra filter call: `UserMcpManager` returns `handle.tools` which is already filtered.

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/tool-policy.test.ts`

Expected: PASS

Also run typecheck if any test mocks construct `McpHandle` without `filteredToolNames` — fix those mocks to include `filteredToolNames: []`.

- [ ] **Step 6: Commit**

```bash
git add src/tool-policy.ts tests/tool-policy.test.ts src/mcp.ts src/index.ts
git commit -m "$(cat <<'EOF'
feat: hard-filter habit and tag MCP tools

Keep habit/tag tools out of the agent tool list so the model
cannot call capabilities the product intentionally disables.
EOF
)"
```

---

### Task 2: Parent-task verification helpers

**Files:**
- Create: `tests/parent-task-verify.test.ts`
- Modify: `src/conversation.ts`

**Interfaces:**
- Produces: `parentTaskCreationNeedsVerification(result: { messages?: unknown }): boolean`, `latestCreatedParentTaskId(result: { messages?: unknown }): string | undefined`
- Consumes: existing LangGraph tool message shapes used by `successfulToolNames` / `latestCreatedProjectId`

- [ ] **Step 1: Write the failing tests**

Create `tests/parent-task-verify.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  latestCreatedParentTaskId,
  parentTaskCreationNeedsVerification,
} from "../src/conversation.ts";

const ai = (calls: Array<{ id: string; name: string; args?: Record<string, unknown> }>) => ({
  tool_calls: calls,
  getType: () => "ai",
});
const tool = (id: string, status: "success" | "error" = "success", content?: unknown) => ({
  tool_call_id: id,
  status,
  content,
  getType: () => "tool",
});

describe("parentTaskCreationNeedsVerification", () => {
  it("does not trigger on a single create_task", () => {
    const result = {
      messages: [
        ai([{ id: "t1", name: "create_task", args: { title: "alone" } }]),
        tool("t1", "success", '{"id":"task-1"}'),
      ],
    };
    expect(parentTaskCreationNeedsVerification(result)).toBe(false);
  });

  it("does not trigger on batch_add_tasks alone (flat batch)", () => {
    const result = {
      messages: [
        ai([{
          id: "b1",
          name: "batch_add_tasks",
          args: { tasks: [{ title: "A" }, { title: "B" }] },
        }]),
        tool("b1"),
      ],
    };
    expect(parentTaskCreationNeedsVerification(result)).toBe(false);
  });

  it("triggers when parent create_task is followed by child creates without parentId", () => {
    const result = {
      messages: [
        ai([{ id: "p1", name: "create_task", args: { title: "父" } }]),
        tool("p1", "success", '{"id":"parent-1"}'),
        ai([
          { id: "c1", name: "create_task", args: { title: "子1" } },
          { id: "c2", name: "create_task", args: { title: "子2" } },
        ]),
        tool("c1"),
        tool("c2"),
      ],
    };
    expect(parentTaskCreationNeedsVerification(result)).toBe(true);
    expect(latestCreatedParentTaskId(result)).toBe("parent-1");
  });

  it("triggers when parent create_task is followed by batch_add_tasks missing parentId", () => {
    const result = {
      messages: [
        ai([{ id: "p1", name: "create_task", args: { title: "父" } }]),
        tool("p1", "success", { id: "parent-9" }),
        ai([{
          id: "b1",
          name: "batch_add_tasks",
          args: { items: [{ title: "子1" }, { title: "子2", parentId: "parent-9" }] },
        }]),
        tool("b1"),
      ],
    };
    expect(parentTaskCreationNeedsVerification(result)).toBe(true);
  });

  it("passes when subsequent writes include parentId", () => {
    const result = {
      messages: [
        ai([{ id: "p1", name: "create_task", args: { title: "父" } }]),
        tool("p1", "success", '{"id":"parent-1"}'),
        ai([
          { id: "c1", name: "create_task", args: { title: "子1", parentId: "parent-1", sortOrder: 1 } },
          { id: "c2", name: "create_task", args: { title: "子2", parentId: "parent-1", sortOrder: 2 } },
        ]),
        tool("c1"),
        tool("c2"),
      ],
    };
    expect(parentTaskCreationNeedsVerification(result)).toBe(false);
  });

  it("ignores failed child tool calls", () => {
    const result = {
      messages: [
        ai([{ id: "p1", name: "create_task", args: { title: "父" } }]),
        tool("p1", "success", '{"id":"parent-1"}'),
        ai([{ id: "c1", name: "create_task", args: { title: "子1" } }]),
        tool("c1", "error"),
      ],
    };
    expect(parentTaskCreationNeedsVerification(result)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/parent-task-verify.test.ts`

Expected: FAIL — `parentTaskCreationNeedsVerification` is not exported

- [ ] **Step 3: Implement helpers in `src/conversation.ts`**

1. Extend `ToolCall`:

```ts
type ToolCall = {
  id?: string;
  name?: string;
  args?: unknown;
  arguments?: unknown;
};
```

2. Add the following helpers after `latestCreatedProjectId` / `findProjectId` (do not remove existing exports):

```ts
type SuccessfulTaskWrite = {
  callId: string;
  name: "create_task" | "batch_add_tasks";
  args: Record<string, unknown>;
};

function parseArgs(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

function nonEmptyParentId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function createTaskParentId(args: Record<string, unknown>): string | undefined {
  return nonEmptyParentId(args.parentId);
}

function batchItems(args: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of ["tasks", "items"]) {
    const value = args[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is Record<string, unknown> =>
        !!item && typeof item === "object" && !Array.isArray(item));
    }
  }
  return [];
}

function batchMissingParentId(args: Record<string, unknown>): boolean {
  const items = batchItems(args);
  if (!items.length) return true;
  return items.some((item) => !nonEmptyParentId(item.parentId));
}

function successfulTaskWrites(result: { messages?: unknown }): SuccessfulTaskWrite[] {
  if (!Array.isArray(result.messages)) return [];
  const calls = new Map<string, { name: "create_task" | "batch_add_tasks"; args: Record<string, unknown> }>();
  for (const raw of result.messages) {
    const message = raw as AgentMessage;
    for (const call of message.tool_calls ?? []) {
      if (!call.id || (call.name !== "create_task" && call.name !== "batch_add_tasks")) continue;
      calls.set(call.id, {
        name: call.name,
        args: parseArgs(call.args ?? call.arguments),
      });
    }
  }
  const writes: SuccessfulTaskWrite[] = [];
  for (const raw of result.messages) {
    const message = raw as AgentMessage;
    if (message.getType?.() !== "tool" || message.status === "error" || !message.tool_call_id) continue;
    const call = calls.get(message.tool_call_id);
    if (!call) continue;
    writes.push({ callId: message.tool_call_id, name: call.name, args: call.args });
  }
  return writes;
}

export function latestCreatedParentTaskId(result: { messages?: unknown }): string | undefined {
  if (!Array.isArray(result.messages)) return undefined;
  const writes = successfulTaskWrites(result);
  const parentCalls = writes.filter((w) => w.name === "create_task" && !createTaskParentId(w.args));
  if (!parentCalls.length) return undefined;
  const parentCallIds = new Set(parentCalls.map((w) => w.callId));
  let taskId: string | undefined;
  for (const raw of result.messages) {
    const message = raw as AgentMessage & { content?: unknown };
    if (message.getType?.() !== "tool" || message.status === "error") continue;
    if (!message.tool_call_id || !parentCallIds.has(message.tool_call_id)) continue;
    taskId = findProjectId(message.content) ?? taskId;
  }
  return taskId;
}

export function parentTaskCreationNeedsVerification(result: { messages?: unknown }): boolean {
  const writes = successfulTaskWrites(result);
  const createCount = writes.filter((w) => w.name === "create_task").length;
  const hasBatch = writes.some((w) => w.name === "batch_add_tasks");
  const multiWrite = createCount >= 2 || (createCount >= 1 && hasBatch);
  if (!multiWrite) return false;

  const parentIndex = writes.findIndex((w) => w.name === "create_task" && !createTaskParentId(w.args));
  if (parentIndex < 0) return false;

  const after = writes.slice(parentIndex + 1);
  if (!after.length) return false;

  return after.some((w) => {
    if (w.name === "create_task") return !createTaskParentId(w.args);
    return batchMissingParentId(w.args);
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/parent-task-verify.test.ts tests/agent-interrupt.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/conversation.ts tests/parent-task-verify.test.ts
git commit -m "$(cat <<'EOF'
feat: detect parent-task creates missing parentId

Add heuristic verification helpers for multi-step task
breakdowns that forgot to wire child parentId fields.
EOF
)"
```

---

### Task 3: Runtime retry loop

**Files:**
- Modify: `src/agent-runtime.ts`

**Interfaces:**
- Consumes: `parentTaskCreationNeedsVerification`, `latestCreatedParentTaskId` from `conversation.ts`

- [ ] **Step 1: Update imports in `src/agent-runtime.ts`**

```ts
import {
  lastAssistantText,
  latestCreatedParentTaskId,
  latestCreatedProjectId,
  needsStructuredClarification,
  parentTaskCreationNeedsVerification,
  projectCreationNeedsVerification,
  resolveInterruptsWith,
  type AgentResult,
} from "./conversation.ts";
```

- [ ] **Step 2: Insert retry loop after project verification throws-check, before choice_prompt rewrite**

Place this block immediately after:

```ts
    if (projectCreationNeedsVerification(result)) {
      throw new Error("清单任务写入或回查验证未完成；系统已阻止返回错误的成功结果，请重试。");
    }
```

and before the `needsStructuredClarification` loop:

```ts
    let didParentVerify = false;
    for (let attempt = 0; attempt < 2 && parentTaskCreationNeedsVerification(result); attempt += 1) {
      didParentVerify = true;
      await params.onDebug?.({ kind: "note", message: "父子任务结构校验重试" });
      await params.onDebug?.({ kind: "phase", phase: "verify", status: "start" });
      const parentId = latestCreatedParentTaskId(result);
      const parentHint = parentId
        ? `刚才作为父任务的 create_task 返回的真实任务 ID 是 ${JSON.stringify(parentId)}。`
        : "请从此前无 parentId 的 create_task 工具结果读取真实父任务 ID。";
      result = await stream({ messages: [{
        role: "user" as const,
        content: `系统一致性检查：多步骤拆解的父子任务结构尚未完整。不要重复创建父任务，也不要向用户提问。${parentHint} 为应作为子步骤的任务补建或修正时，必须填入 parentId（驼峰，值为父任务 ID）以及递增的 sortOrder；同清单时带同一 projectId。禁止把步骤建成同级平铺。只有父子结构正确后才能报告成功。`,
      }] });
    }
    if (didParentVerify) {
      await params.onDebug?.({ kind: "phase", phase: "verify", status: "done" });
    }
    if (parentTaskCreationNeedsVerification(result)) {
      throw new Error("父子任务结构验证未完成；系统已阻止返回错误的成功结果，请重试。");
    }
```

- [ ] **Step 3: Run unit tests**

Run: `npm test -- tests/parent-task-verify.test.ts tests/agent-interrupt.test.ts tests/tool-policy.test.ts`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/agent-runtime.ts
git commit -m "$(cat <<'EOF'
feat: retry parent-task structure when parentId is missing

Mirror project verification: up to two consistency passes,
then block false success for broken task breakdowns.
EOF
)"
```

---

### Task 4: Prompt C2 wording

**Files:**
- Modify: `src/prompts.ts`
- Modify: `tests/prompts.test.ts`

- [ ] **Step 1: Update `tests/prompts.test.ts`**

Inside the existing `it("injects the current Shanghai date and next year", ...)`, add:

```ts
    expect(prompt).toContain("当前会话未开放标签工具");
    expect(prompt).toContain("当前会话未开放习惯工具");
    expect(prompt).toContain("运行时会校验父子结构");
    expect(prompt).not.toContain("创建后必须回查确认所有子任务的 parentId 与顺序正确，只有确认后才能向用户报告成功");
    expect(prompt).not.toContain("除非用户声明，否则不主动创建和使用标签功能");
    expect(prompt).not.toContain("不使用习惯功能。");
```

Keep all existing assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/prompts.test.ts`

Expected: FAIL on new contains / not.contains

- [ ] **Step 3: Edit rules 9, 11, 14 in `src/prompts.ts`**

Set rule 9 to:

```text
9. 当前会话未开放标签工具，不要尝试调用。
```

Set rule 11 to:

```text
11. 拆解多步骤事项时必须用父子任务，禁止把本该挂在同一父任务下的步骤建成同级平铺任务。触发条件：可独立完成的步骤 ≥3，或跨多天/多阶段；不足则可以平级。禁止只用 content 或 checklist items（kind=CHECKLIST 的 items）代替真正子任务。创建必须严格串行：先 create_task 建父任务，等待并读取返回的真实任务 ID；再创建子任务，每条子任务必须填 parentId（驼峰，值为父任务 ID）以及递增的 sortOrder，同清单时还要带同一 projectId。禁止在拿到父任务 ID 前并行创建子任务，禁止漏填 parentId。运行时会校验父子结构；若缺 parentId 会被要求补建，勿向用户提前报成功。
```

Set rule 14 to:

```text
14. 当前会话未开放习惯工具，不要尝试调用。
```

Do not modify rules 1–8, 10, 12, 13 or `buildSystemPrompt`.

- [ ] **Step 4: Run prompt tests**

Run: `npm test -- tests/prompts.test.ts`

Expected: PASS

- [ ] **Step 5: Full regression**

Run: `npm test`

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/prompts.ts tests/prompts.test.ts
git commit -m "$(cat <<'EOF'
docs: align system prompt with tool filter and parent checks

Clarify that habit/tag tools are unavailable and that parent
structure is enforced at runtime instead of prompt-only verify.
EOF
)"
```

---

## Spec coverage

| Spec requirement | Task |
|------------------|------|
| tool-policy API + habit/tag filter | Task 1 |
| Filter at MCP connect (CLI + HTTP) | Task 1 |
| Startup log filtered names | Task 1 |
| parentTaskCreationNeedsVerification B1 | Task 2 |
| latestCreatedParentTaskId | Task 2 |
| Runtime retry ×2 + throw | Task 3 |
| Reuse verify debug phase | Task 3 |
| Prompt rules 9/11/14 C2 | Task 4 |
| Unit tests | Tasks 1, 2, 4 |

## Plan self-review

- No TBD / placeholder steps
- `McpHandle.filteredToolNames` always set (possibly `[]`)
- Pass path for parent verification = children no longer missing `parentId` (B1); wrong-ID matching is out of scope
- Batch args accept both `tasks` and `items`
