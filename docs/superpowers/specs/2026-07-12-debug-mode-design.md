# 前端调试启动模式设计

日期：2026-07-12  
状态：已确认

## 目标

为本地开发增加可选调试模式，便于观察：

1. 模型思考过程、MCP 调用、工具调用等运行轨迹
2. 报错的详细原因（含 stack / cause）
3. 后端为此提供请求级调试事件流

非调试启动与现有行为完全一致。

## 决策摘要

| 项 | 选择 |
|---|---|
| 启动方式 | `npm run web` 正常；`npm run web -- --debug` 调试 |
| UI | 主聊天区旁可折叠侧栏，流式实时展示 |
| 持久化 | 仅本轮内存；刷新 / 切会话清空，不落库 |
| 错误详情 | debug 请求下返回 message、code、cause、stack |
| 协议方案 | 请求体 `debug: true`，在现有 NDJSON 上追加 `debug` 事件 |

## 架构

```
Vite (--debug) → VITE_DEBUG=true
       ↓
前端侧栏 + POST messages { debug: true }
       ↓
http → ChatService → runAgentTurn / UserMcpManager
       ↓
NDJSON: start | delta | debug* | done | error
```

- 仅当请求 `debug === true` 时启用 `onDebug` 回调并增强 `error`
- `web:build` 不注入 `VITE_DEBUG`；正式包无调试入口与侧栏
- 调试轨迹不写入 `chat_turns` 或其它表

## 启动与前端开关

1. 扩展 `web/vite.config.ts`：解析 CLI `--debug`，通过 `define` 或 `env` 注入 `VITE_DEBUG="true"`
2. `package.json` 的 `web` 脚本保持不变；用法为 `npm run web -- --debug`
3. 前端以 `import.meta.env.VITE_DEBUG === "true"` 判定调试模式
4. 调试模式下：
   - 渲染 DEBUG 角标与可折叠侧栏
   - `streamApi` 请求体自动附带 `debug: true`
   - 消费 `type: "debug"` 事件写入侧栏时间线
5. 侧栏折叠偏好可存 `localStorage`；调试事件内容不持久化

## NDJSON 协议

### 现有事件（不变）

- `{ type: "start", turn }`
- `{ type: "delta", delta, reset? }`
- `{ type: "done", turn }`
- `{ type: "error", error: { code, message } }`（非 debug）

### 新增：debug 包装

```ts
{ type: "debug", event: DebugEvent }
```

### DebugEvent

```ts
type DebugEvent =
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
```

### 错误增强（仅 debug 请求）

```ts
{
  type: "error",
  error: {
    code: string;
    message: string;
    stack?: string;
    cause?: string;
  }
}
```

非 debug 请求的 `error` 形状保持现状（仅 `code` + `message`），不返回 stack。

## 后端改动

### `UserMcpManager`

- `toolsFor` 在 cache hit / 新建连接 / invalidate 时，若存在 `onDebug`，发出 `mcp` 事件
- 不把 token 写入任何 debug payload

### `runAgentTurn`

- 新增可选 `onDebug?: (event: DebugEvent) => void | Promise<void>`
- 从 LangGraph `streamMode: ["messages", "values"]` 的 messages 流中识别：
  - AI reasoning / 思考增量 → `thinking`
  - tool call → `tool_call`（含 name、args、id）
  - tool message → `tool_result`（`preview` 截断，默认约 2KB；`ok` 由 status 推断）
- 阶段节点发出 `phase` / `note`（例如 interrupt 决议、清单校验重试、choice_prompt 重写）
- 模型无 reasoning 时可不发 `thinking`，其它事件照常

### `ChatService`

- `send` / `execute` 接受 `debug?: boolean` 与 `onDebug`
- 将 `onDebug` 传入 runner / MCP；失败时在 debug 模式下保留原始 Error 供上层序列化 stack/cause
- `error_message` 落库仍只用简洁 `message`，不存 stack

### `http.ts`（`POST .../messages`）

- 校验 `debug`：缺省或 boolean；非 boolean 返回 400
- 流式路径：`debug === true` 时 `write({ type: "debug", event })`
- catch：若 headers 已发送且为 debug 请求，`error` 附带 `stack` / `cause`（`cause` 取 `error.cause` 字符串化）

## 前端 UI

### 布局

- 主聊天区右侧可折叠侧栏；窄屏可用底部抽屉等价实现
- 默认展开；折叠状态键名建议 `missy.debugPanelCollapsed`
- 标题栏：`调试`、清空、折叠；页面角标 `DEBUG`

### 时间线

- 本轮 `start` 时清空侧栏条目
- 按时间追加，最新在下；按 `kind` 分标签展示
- `thinking` 增量拼接为可滚动块
- `tool_call` / `tool_result` 显示 name，args / preview 默认可展开
- 收到增强 `error` 时在侧栏显著展示 message、code、stack、cause

### 非 debug 构建

- 无侧栏、无角标、请求不带 `debug` 字段

## 安全与边界

- 不做：落库、历史回放、生产包调试入口
- 工具结果只发截断 preview
- 禁止在 debug 事件中回传 dida token、session cookie、密码哈希等密钥
- stack 仅在该次请求显式 `debug: true` 时返回

## 测试计划

1. HTTP：带 `debug: true` 的 NDJSON 流包含 `type: "debug"`；不带则不含
2. HTTP：debug 失败响应的 `error` 含 `stack`；非 debug 不含
3. Agent runtime：模拟 messages 流，断言 `tool_call` / `tool_result` /（若有）`thinking` 回调
4. 可选：抽出 debug 时间线纯函数，单测追加与 start 清空
5. 手工验收：
   - `npm run web`：无 DEBUG UI
   - `npm run web -- --debug`：侧栏可见 phase / mcp / tool；失败可见 stack
   - 非 debug 流式对话回归通过

## 非目标

- 独立 Debug WebSocket / SSE 通道
- 后端 `NODE_ENV` 全局强制吐调试事件
- 调试轨迹数据库持久化
