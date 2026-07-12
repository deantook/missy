# 滴答清单 Deep Agent 任务助手 — 设计文档

**日期：** 2026-07-12  
**状态：** 已批准（待实现）

## 目标

用 Deep Agents（TypeScript）实现一个终端交互式任务管理助手，通过 HTTP MCP 连接 `mcp.dida365.com`，覆盖滴答清单 MCP 提供的全量工具能力。

## 决策摘要

| 项 | 选择 |
|----|------|
| 交互方式 | 终端 CLI REPL |
| Agent 框架 | Deep Agents（`createDeepAgent`） |
| MCP 连接 | `@langchain/mcp-adapters` → HTTP `https://mcp.dida365.com` |
| 鉴权 | `DIDA365_TOKEN` Bearer Token（`.env`） |
| 模型 | 通过 `MODEL` 等环境变量自由配置 |
| 能力范围 | MCP 全量工具（任务、项目、标签、习惯、专注、倒计时等） |
| 人工确认 | 仅删除类工具需确认（方案 C） |
| 架构方案 | 单 Deep Agent + 全量 MCP tools（方案 1） |

## 架构

```text
用户 (终端)
    ↓
CLI REPL (readline)
    ↓
createDeepAgent (planning + tools + interruptOn)
    ↓
@langchain/mcp-adapters (MultiServerMCPClient)
    ↓
https://mcp.dida365.com  (Authorization: Bearer <token>)
```

启动流程：

1. 加载并校验 `.env`（`MODEL`、对应 provider API key、`DIDA365_TOKEN`）
2. 创建 `MultiServerMCPClient`，HTTP 连接滴答 MCP，拉取全量 tools
3. 用 `createDeepAgent` 组装助手（system prompt + tools + 删除类 `interruptOn`）
4. 进入 REPL：读入 → invoke/stream → 打印；遇 interrupt 则终端确认

## 目录与模块

```text
missy/
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
└── src/
    ├── index.ts      # 入口：加载 env、启动 REPL
    ├── config.ts     # 读取并校验环境变量
    ├── mcp.ts        # MCP 客户端与 tools
    ├── agent.ts      # createDeepAgent 组装
    ├── cli.ts        # REPL、确认提示、输出
    └── prompts.ts    # 系统提示词
```

| 模块 | 职责 | 依赖 |
|------|------|------|
| `config` | 解析 `MODEL`、API keys、`DIDA365_TOKEN`、`DIDA365_MCP_URL` | `dotenv` |
| `mcp` | 建客户端、`getTools()`、关闭连接 | `@langchain/mcp-adapters` |
| `agent` | Deep Agent + interruptOn | `deepagents` + tools |
| `cli` | REPL 与确认交互 | `agent` |
| `prompts` | 中文人设与工具使用指引 | 无 |

边界：业务逻辑不写在 CLI；MCP 连接细节封装在 `mcp.ts`。

## 配置

| 变量 | 必填 | 说明 |
|------|------|------|
| `MODEL` | 是 | LangChain 模型字符串，如 `anthropic:claude-sonnet-4-5`、`openai:gpt-4.1` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | 按模型 | 对应 provider 的 API key |
| `DIDA365_TOKEN` | 是 | Bearer Token |
| `DIDA365_MCP_URL` | 否 | 默认 `https://mcp.dida365.com` |

## 删除确认规则

对以下删除语义工具启用 `interruptOn`（名称以实际 MCP 工具名为准）：

- `delete_task`
- `delete_comment`
- `delete_focus`
- `delete_project_group`

终端提示「确认执行？[y/N]」：`y`/`yes` 继续，其他取消。创建、更新、完成等写操作不打断。

若 MCP 后续新增删除类工具，按名称前缀 `delete_` 匹配，避免硬编码遗漏。

## 系统提示词要点

- 使用中文回复
- 先理解意图，再选择最小必要工具集
- 全量工具可用，但不做无意义的连环调用
- 日期/时间默认按 `Asia/Shanghai` 理解
- 操作后简要复述结果，避免堆砌原始 JSON

## 错误处理

- 缺必填 env：启动失败，提示补全 `.env`
- MCP 连接/鉴权失败：可读错误后退出，不进入 REPL
- 工具调用失败：错误摘要回传模型，由助手用中文解释
- `exit` / `quit` / `Ctrl+C`：关闭 MCP 客户端后退出

## 验收标准

1. 配置 `.env` 后 `npm start` 可进入对话
2. 能通过自然语言查今日待办、创建任务、完成任务（真实调用滴答 MCP）
3. `delete_task` 等删除操作会先确认
4. 更换 `MODEL`（在已配置对应 API key 时）无需改代码
5. README 写清依赖、env、启动方式与示例对话

## 非目标（首版不做）

- HTTP API / Web UI
- 按域拆分子 Agent（可作为后续演进）
- OAuth 登录流程（用户自行提供 Bearer Token）
- 本地持久化对话历史（可不加 checkpointer；后续可加）

## 技术依赖（预期）

- `deepagents`
- `langchain` / `@langchain/core`
- `@langchain/mcp-adapters`
- `dotenv`
- TypeScript + `tsx`（或等价运行方式）

具体版本在实现计划阶段锁定。
