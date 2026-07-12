# Missy — 多用户滴答清单 AI 助手

基于 Deep Agents、Dida365 MCP、Express、Vite 和 PostgreSQL 的多用户任务助手。每个用户拥有独立的 Dida MCP Token、会话历史与模型 Token 用量统计。

## 功能

- 邮箱密码注册、登录、退出、资料修改、改密与账户注销
- 用户级 Dida MCP Token 验证和隔离（按产品要求明文存于 `users` 表，API 仅返回脱敏尾号）
- PostgreSQL 持久化会话和每轮成功/失败记录
- 汇总每轮全部模型调用的输入、输出与总 Token，并维护会话累计值
- 历史会话打开、自动命名、手动改名和删除
- 删除类 MCP 操作单次授权
- 生产环境由 Express 直接托管前端产物

## 本地启动

要求 Node.js 20+ 和 PostgreSQL。默认数据库连接为：

```text
postgresql://dean:postgres@localhost:5432/missy
```

安装并配置：

```bash
npm install
cp .env.example .env
# 配置 MODEL 和对应的 Provider API Key
npm run db:migrate
```

开发时分别启动后端和前端：

```bash
npm run serve
npm run web
```

访问 `http://127.0.0.1:5173`。注册后在账户设置中填写自己的 Dida MCP Token。

生产运行：

```bash
npm run web:build
NODE_ENV=production npm run serve
```

访问 `http://127.0.0.1:3000`。

## 桌面端（Tauri）

与 Web 共用 `web/` 前端。桌面壳不内嵌后端，连接远程（或本地）HTTP API。

要求：Node 20+、Rust（[rustup](https://rustup.rs)）、各平台 Tauri 系统依赖见 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)。

开发（另开终端先启动 API）：

```bash
npm run serve
npm run desktop:dev
```

打包（将 API 地址写入前端构建）：

```bash
VITE_API_BASE=https://your-api.example.com npm run desktop:build
```

生产 API 需配置 `CORS_ORIGINS`，包含 Tauri WebView Origin（常见为 `tauri://localhost`、`https://tauri.localhost`）。

## 配置

| 变量 | 必填 | 说明 |
|---|---|---|
| `MODEL` | 是 | 例如 `anthropic:claude-sonnet-4-5` 或 `openai:gpt-4.1` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | 按模型 | 模型 Provider 密钥 |
| `DATABASE_URL` | 否 | PostgreSQL 连接，默认使用本地 `missy` 数据库 |
| `DIDA365_MCP_URL` | 否 | 默认 `https://mcp.dida365.com` |
| `HTTP_HOST` / `HTTP_PORT` | 否 | 默认 `127.0.0.1:3000` |
| `NODE_ENV` | 否 | `production` 时托管 `web/dist` |
| `CORS_ORIGINS` | 否 | 逗号分隔的跨域 Origin；开发未设置时默认包含 Vite 与 Tauri；生产若桌面或独立 Web 源调用 API 需显式配置 |
| `DIDA365_TOKEN` | CLI 必填 | 仅 `npm start` 的单用户 CLI 使用 |

鉴权已改为 Bearer Token：浏览器与桌面端均在请求头携带 `Authorization: Bearer <token>`。旧版 Cookie 会话已失效，需重新登录。

## 验证

```bash
npm test
npm run typecheck
npm run web:build
```

测试默认使用本地 `missy` 数据库，也可通过 `TEST_DATABASE_URL` 指定测试库。测试数据使用唯一邮箱并在结束后清理。
