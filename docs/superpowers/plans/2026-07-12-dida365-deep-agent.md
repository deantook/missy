# Dida365 Deep Agent CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个 TypeScript 终端 CLI，用 Deep Agents 连接 `mcp.dida365.com`，通过自然语言管理滴答清单全量能力，删除操作需人工确认。

**Architecture:** `config` 校验 env → `mcp` 用 Bearer Token 拉全量 tools → `agent` 组装 `createDeepAgent`（`MemorySaver` + `delete_*` 的 `interruptOn`）→ `cli` REPL 处理对话与确认 → `index` 启动并优雅退出。

**Tech Stack:** TypeScript, `tsx`, `deepagents`, `langchain`, `@langchain/mcp-adapters`, `@langchain/langgraph` (`MemorySaver`/`Command`), `dotenv`, Node `node:readline/promises`, `vitest`

**Spec:** `docs/superpowers/specs/2026-07-12-dida365-deep-agent-design.md`

---

## File structure

| Path | Responsibility |
|------|----------------|
| `package.json` | scripts / deps |
| `tsconfig.json` | Strict ESM TypeScript |
| `.env.example` | Env template |
| `.gitignore` | Ignore `node_modules`, `.env`, dist |
| `src/config.ts` | Load + validate env |
| `src/prompts.ts` | System prompt string |
| `src/mcp.ts` | MCP client factory + tools |
| `src/agent.ts` | `createDeepAgent` + delete interrupt map |
| `src/cli.ts` | REPL + HITL approve/reject |
| `src/index.ts` | Entrypoint |
| `tests/config.test.ts` | Config validation tests |
| `tests/agent-interrupt.test.ts` | `buildDeleteInterruptOn` tests |
| `README.md` | Setup + usage |

---

### Task 1: Scaffold project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "missy",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create `.gitignore`**

```gitignore
node_modules/
dist/
.env
*.log
.DS_Store
```

- [ ] **Step 4: Create `.env.example`**

```env
# LangChain model string, e.g. anthropic:claude-sonnet-4-5 or openai:gpt-4.1
MODEL=anthropic:claude-sonnet-4-5

# Set the key that matches your MODEL provider
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# Dida365 MCP Bearer token
DIDA365_TOKEN=

# Optional; default https://mcp.dida365.com
DIDA365_MCP_URL=https://mcp.dida365.com
```

- [ ] **Step 5: Install dependencies**

Run:

```bash
npm install deepagents langchain @langchain/core @langchain/langgraph @langchain/mcp-adapters dotenv
npm install -D typescript tsx vitest @types/node
```

Expected: `package-lock.json` created; no install errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore .env.example
git commit -m "chore: scaffold TypeScript project for Dida365 Deep Agent CLI"
```

---

### Task 2: Config loader (TDD)

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/config.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, ConfigError } from "../src/config.ts";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("loadConfig", () => {
  it("loads required fields from env", () => {
    process.env.MODEL = "openai:gpt-4.1";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.DIDA365_TOKEN = "token-abc";
    delete process.env.DIDA365_MCP_URL;

    const config = loadConfig();
    expect(config.model).toBe("openai:gpt-4.1");
    expect(config.dida365Token).toBe("token-abc");
    expect(config.dida365McpUrl).toBe("https://mcp.dida365.com");
  });

  it("throws when MODEL is missing", () => {
    delete process.env.MODEL;
    process.env.DIDA365_TOKEN = "token-abc";
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("throws when DIDA365_TOKEN is missing", () => {
    process.env.MODEL = "anthropic:claude-sonnet-4-5";
    delete process.env.DIDA365_TOKEN;
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("throws when Anthropic model has no ANTHROPIC_API_KEY", () => {
    process.env.MODEL = "anthropic:claude-sonnet-4-5";
    process.env.DIDA365_TOKEN = "token-abc";
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("throws when OpenAI model has no OPENAI_API_KEY", () => {
    process.env.MODEL = "openai:gpt-4.1";
    process.env.DIDA365_TOKEN = "token-abc";
    delete process.env.OPENAI_API_KEY;
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("allows custom DIDA365_MCP_URL", () => {
    process.env.MODEL = "openai:gpt-4.1";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.DIDA365_TOKEN = "token-abc";
    process.env.DIDA365_MCP_URL = "https://example.com/mcp";
    expect(loadConfig().dida365McpUrl).toBe("https://example.com/mcp");
  });
});
```

- [ ] **Step 2: Run tests — expect fail**

Run: `npm test -- tests/config.test.ts`

Expected: FAIL (cannot resolve `../src/config.ts` or `loadConfig` undefined)

- [ ] **Step 3: Implement `src/config.ts`**

```ts
import { config as loadDotenv } from "dotenv";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface AppConfig {
  model: string;
  dida365Token: string;
  dida365McpUrl: string;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ConfigError(
      `缺少环境变量 ${name}。请复制 .env.example 为 .env 并填入配置。`,
    );
  }
  return value;
}

function assertProviderKey(model: string): void {
  const lower = model.toLowerCase();
  if (lower.startsWith("anthropic:") || lower.includes("claude")) {
    if (!process.env.ANTHROPIC_API_KEY?.trim()) {
      throw new ConfigError(
        `模型 ${model} 需要 ANTHROPIC_API_KEY。请在 .env 中配置。`,
      );
    }
    return;
  }
  if (lower.startsWith("openai:") || lower.includes("gpt-")) {
    if (!process.env.OPENAI_API_KEY?.trim()) {
      throw new ConfigError(
        `模型 ${model} 需要 OPENAI_API_KEY。请在 .env 中配置。`,
      );
    }
    return;
  }
  // Other providers: rely on their own env vars; do not hard-fail here.
}

export function loadConfig(): AppConfig {
  loadDotenv();

  const model = requireEnv("MODEL");
  const dida365Token = requireEnv("DIDA365_TOKEN");
  assertProviderKey(model);

  const dida365McpUrl =
    process.env.DIDA365_MCP_URL?.trim() || "https://mcp.dida365.com";

  return { model, dida365Token, dida365McpUrl };
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npm test -- tests/config.test.ts`

Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add env config loader with validation"
```

---

### Task 3: System prompt

**Files:**
- Create: `src/prompts.ts`

- [ ] **Step 1: Create `src/prompts.ts`**

```ts
export const SYSTEM_PROMPT = `你是滴答清单（Dida365）任务管理助手。通过 MCP 工具操作用户的真实账号数据。

规则：
1. 始终使用简体中文回复。
2. 先理解用户意图，再调用最小必要的工具；不要无意义连环调用。
3. 日期与时间默认按 Asia/Shanghai（东八区）理解；需要绝对时间时使用 ISO 8601。
4. 操作完成后用简短自然语言复述结果（标题、项目、截止时间等关键字段），不要堆砌原始 JSON。
5. 查询类请求优先用已有筛选工具（按日期、时间查询、搜索等），而不是拉全量后再本地过滤。
6. 删除类操作可能需要用户确认；若用户拒绝，不要重试同一删除，除非用户再次明确要求。
7. 不确定项目/任务 ID 时，先用列表或搜索工具定位，再执行写操作。`;
```

- [ ] **Step 2: Commit**

```bash
git add src/prompts.ts
git commit -m "feat: add Chinese system prompt for task assistant"
```

---

### Task 4: MCP client module

**Files:**
- Create: `src/mcp.ts`

- [ ] **Step 1: Implement `src/mcp.ts`**

```ts
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { AppConfig } from "./config.ts";

export type McpHandle = {
  client: MultiServerMCPClient;
  tools: Awaited<ReturnType<MultiServerMCPClient["getTools"]>>;
};

export async function connectDida365Mcp(config: AppConfig): Promise<McpHandle> {
  const client = new MultiServerMCPClient({
    dida365: {
      url: config.dida365McpUrl,
      headers: {
        Authorization: `Bearer ${config.dida365Token}`,
      },
    },
  });

  try {
    const tools = await client.getTools();
    if (!tools.length) {
      throw new Error(
        "已连接 MCP，但未获取到任何工具。请检查 DIDA365_TOKEN 与 DIDA365_MCP_URL。",
      );
    }
    return { client, tools };
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

Note: If the installed `@langchain/mcp-adapters` API uses `mcpServers` wrapper, adjust constructor to:

```ts
new MultiServerMCPClient({
  mcpServers: {
    dida365: {
      url: config.dida365McpUrl,
      headers: { Authorization: `Bearer ${config.dida365Token}` },
    },
  },
});
```

Check the package README / types after install and pick the form that typechecks.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: PASS for `src/mcp.ts` (other files may still be missing — only fail on real type errors in this file; if `index` missing, ignore until later or only compile `src/mcp.ts` mentally; full typecheck lands in Task 7).

- [ ] **Step 3: Commit**

```bash
git add src/mcp.ts
git commit -m "feat: connect to mcp.dida365.com via HTTP Bearer auth"
```

---

### Task 5: Agent factory + delete interrupt map (TDD)

**Files:**
- Create: `src/agent.ts`
- Create: `tests/agent-interrupt.test.ts`

- [ ] **Step 1: Write failing tests for interrupt map**

Create `tests/agent-interrupt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildDeleteInterruptOn } from "../src/agent.ts";

describe("buildDeleteInterruptOn", () => {
  it("maps tools whose names start with delete_", () => {
    const tools = [
      { name: "delete_task" },
      { name: "create_task" },
      { name: "delete_focus" },
      { name: "list_projects" },
    ];
    const map = buildDeleteInterruptOn(tools);
    expect(Object.keys(map).sort()).toEqual(["delete_focus", "delete_task"]);
    expect(map.delete_task).toEqual({ allowedDecisions: ["approve", "reject"] });
  });

  it("returns empty object when no delete tools", () => {
    expect(buildDeleteInterruptOn([{ name: "create_task" }])).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests — expect fail**

Run: `npm test -- tests/agent-interrupt.test.ts`

Expected: FAIL (module / export missing)

- [ ] **Step 3: Implement `src/agent.ts`**

```ts
import { createDeepAgent } from "deepagents";
import { MemorySaver } from "@langchain/langgraph";
import { SYSTEM_PROMPT } from "./prompts.ts";

export type NamedTool = { name?: string };

export function buildDeleteInterruptOn(
  tools: readonly NamedTool[],
): Record<string, { allowedDecisions: Array<"approve" | "reject"> }> {
  const interruptOn: Record<
    string,
    { allowedDecisions: Array<"approve" | "reject"> }
  > = {};

  for (const tool of tools) {
    const name = tool.name;
    if (typeof name === "string" && name.startsWith("delete_")) {
      interruptOn[name] = { allowedDecisions: ["approve", "reject"] };
    }
  }

  return interruptOn;
}

export function createTaskAgent(params: {
  model: string;
  tools: readonly NamedTool[];
}) {
  const interruptOn = buildDeleteInterruptOn(params.tools);
  const checkpointer = new MemorySaver();

  const agent = createDeepAgent({
    model: params.model,
    tools: params.tools as never[],
    systemPrompt: SYSTEM_PROMPT,
    interruptOn,
    checkpointer,
  });

  return { agent, checkpointer, interruptOn };
}
```

If `createDeepAgent` is async in the installed version, change to `export async function createTaskAgent` and `await createDeepAgent(...)`.

- [ ] **Step 4: Run tests — expect pass**

Run: `npm test -- tests/agent-interrupt.test.ts`

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/agent.ts tests/agent-interrupt.test.ts
git commit -m "feat: create Deep Agent with delete_* interruptOn"
```

---

### Task 6: CLI REPL with HITL

**Files:**
- Create: `src/cli.ts`

- [ ] **Step 1: Implement `src/cli.ts`**

```ts
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { randomUUID } from node:crypto;
import { Command } from "@langchain/langgraph";

type AgentLike = {
  invoke: (
    input: unknown,
    config?: { configurable: { thread_id: string } },
  ) => Promise<Record<string, unknown>>;
};

function lastAssistantText(result: Record<string, unknown>): string {
  const messages = result.messages as Array<{ content?: unknown }> | undefined;
  if (!messages?.length) return "(无回复)";
  const last = messages[messages.length - 1];
  const content = last?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text: unknown }).text);
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return String(content ?? "(无回复)");
}

async function promptConfirm(
  rl: readline.Interface,
  toolName: string,
  args: unknown,
): Promise<"approve" | "reject"> {
  output.write(`\n⚠️  需要确认删除操作\n`);
  output.write(`工具: ${toolName}\n`);
  output.write(`参数: ${JSON.stringify(args, null, 2)}\n`);
  const answer = (await rl.question("确认执行？[y/N] ")).trim().toLowerCase();
  if (answer === "y" || answer === "yes") return "approve";
  return "reject";
}

async function resolveInterrupts(
  rl: readline.Interface,
  agent: AgentLike,
  result: Record<string, unknown>,
  config: { configurable: { thread_id: string } },
): Promise<Record<string, unknown>> {
  let current = result;

  while (current.__interrupt__) {
    const interrupts = current.__interrupt__ as Array<{
      value: {
        actionRequests: Array<{ name: string; args: unknown }>;
      };
    }>;
    const actionRequests = interrupts[0]?.value?.actionRequests ?? [];
    const decisions = [];

    for (const action of actionRequests) {
      const decision = await promptConfirm(rl, action.name, action.args);
      if (decision === "approve") {
        decisions.push({ type: "approve" as const });
      } else {
        decisions.push({
          type: "reject" as const,
          message:
            "用户拒绝了该删除操作。不要重试同一删除，除非用户再次明确要求。",
        });
      }
    }

    current = await agent.invoke(
      new Command({ resume: { decisions } }),
      config,
    );
  }

  return current;
}

export async function runRepl(agent: AgentLike): Promise<void> {
  const rl = readline.createInterface({ input, output });
  const threadId = randomUUID();
  const config = { configurable: { thread_id: threadId } };

  output.write("滴答清单助手已启动。输入问题开始对话；输入 exit / quit 退出。\n");

  try {
    while (true) {
      const line = (await rl.question("\n你: ")).trim();
      if (!line) continue;
      if (line === "exit" || line === "quit") break;

      try {
        let result = await agent.invoke(
          { messages: [{ role: "user", content: line }] },
          config,
        );
        result = await resolveInterrupts(rl, agent, result, config);
        output.write(`\n助手: ${lastAssistantText(result)}\n`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        output.write(`\n错误: ${message}\n`);
      }
    }
  } finally {
    rl.close();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add REPL with delete confirmation HITL loop"
```

---

### Task 7: Entrypoint wiring

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement `src/index.ts`**

```ts
import { loadConfig, ConfigError } from "./config.ts";
import { connectDida365Mcp, closeMcp } from "./mcp.ts";
import { createTaskAgent } from "./agent.ts";
import { runRepl } from "./cli.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  const mcp = await connectDida365Mcp(config);

  const shutdown = async () => {
    await closeMcp(mcp);
  };

  process.on("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });

  try {
    const { agent, interruptOn } = createTaskAgent({
      model: config.model,
      tools: mcp.tools,
    });

    console.log(
      `已连接 MCP，工具数: ${mcp.tools.length}；删除确认: ${Object.keys(interruptOn).join(", ") || "(无)"}`,
    );

    await runRepl(agent);
  } finally {
    await shutdown();
  }
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

If `createTaskAgent` is async, `await` it.

- [ ] **Step 2: Typecheck + unit tests**

Run:

```bash
npm test
npx tsc --noEmit
```

Expected: all unit tests PASS; `tsc` exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire CLI entrypoint for Dida365 Deep Agent"
```

---

### Task 8: README + smoke checklist

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# missy — 滴答清单 Deep Agent 助手

基于 [Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/overview) 的终端任务助手，通过 MCP 连接 [mcp.dida365.com](https://mcp.dida365.com)。

## 要求

- Node.js >= 20
- 滴答清单 MCP Bearer Token
- Anthropic 或 OpenAI（或其他已配置的 LangChain provider）API Key

## 安装

\`\`\`bash
npm install
cp .env.example .env
# 编辑 .env：填入 MODEL、对应 API Key、DIDA365_TOKEN
\`\`\`

## 启动

\`\`\`bash
npm start
\`\`\`

输入 `exit` / `quit` 或 Ctrl+C 退出。

## 示例对话

- 「今天有哪些待办？」
- 「创建一个明天下午 3 点的任务：写周报」
- 「把刚才那个任务标为完成」
- 「删除任务 xxx」（会提示确认）

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `MODEL` | 是 | 如 `anthropic:claude-sonnet-4-5`、`openai:gpt-4.1` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | 按模型 | Provider key |
| `DIDA365_TOKEN` | 是 | MCP Bearer Token |
| `DIDA365_MCP_URL` | 否 | 默认 `https://mcp.dida365.com` |

## 测试

\`\`\`bash
npm test
npm run typecheck
\`\`\`
```

- [ ] **Step 2: Manual smoke (需要真实 `.env`)**

1. 配置 `.env`（勿提交）
2. `npm start`
3. 问：「今天有哪些待办？」— 应返回真实数据
4. 创建一条测试任务并完成
5. 尝试删除：应出现「确认执行？[y/N]」；输入 `n` 应取消

若无 token，跳过本步，在 README 注明需真实凭据验收。

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup and usage for Dida365 assistant"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| CLI REPL | Task 6–7 |
| Deep Agents + full MCP tools | Task 4–5 |
| Bearer token via env | Task 2, 4 |
| MODEL configurable via env | Task 2, 5, 7 |
| delete_* confirmation only | Task 5–6 |
| Chinese system prompt | Task 3 |
| Startup env / MCP errors | Task 2, 4, 7 |
| Graceful exit | Task 6–7 |
| README + acceptance | Task 8 |
| MemorySaver for HITL (session only; not durable history) | Task 5 |

## Notes for implementers

1. **Checkpointer:** Spec 说不做持久化历史；HITL 仍需要 `MemorySaver`（进程内）。不要引入 SQLite/文件 checkpointer。
2. **MCP constructor shape:** 以安装后的 `@langchain/mcp-adapters` 类型为准（顶层 server map vs `mcpServers`）。
3. **`createDeepAgent` sync/async:** 以安装版本导出为准。
4. **Do not commit `.env`。**
