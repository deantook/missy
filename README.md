# mssiy — 滴答清单 Deep Agent 助手

基于 [Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/overview) 的终端任务助手，通过 MCP 连接 [mcp.dida365.com](https://mcp.dida365.com)。

## 要求

- Node.js >= 20
- 滴答清单 MCP Bearer Token
- Anthropic 或 OpenAI（或其他已配置的 LangChain provider）API Key

## 安装

```bash
npm install
cp .env.example .env
# 编辑 .env：填入 MODEL、对应 API Key、DIDA365_TOKEN
```

## 启动

```bash
npm start
```

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

```bash
npm test
npm run typecheck
```

## 验收说明

完整功能验收（查询今日待办、创建/完成任务、删除确认流程）需要配置真实凭据的 `.env` 文件。请勿将 `.env` 提交到版本库。
