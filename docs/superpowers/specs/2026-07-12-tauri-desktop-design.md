# Tauri 桌面端（与 Web 一致体验）— 设计文档

**日期：** 2026-07-12  
**状态：** 已批准（待实现）

## 目标

在现有 `server + web` 之上提供 Tauri 桌面客户端，与浏览器端共用同一套前端与业务体验。桌面端为纯壳：不内嵌 Node/Agent/数据库，只连接已部署的远程 API。

## 决策摘要

| 项 | 选择 |
|----|------|
| 桌面形态 | 纯壳客户端（方案 A） |
| 前端复用 | 保留 `web/`，旁挂 `src-tauri/`（方案 1） |
| 鉴权 | Web + 桌面全面切到 Bearer Token，去掉 Cookie 会话 |
| API 地址 | 构建时 `VITE_API_BASE` 写死 |
| 首版原生能力 | 仅窗口 + 本地静态资源；不做托盘/通知/自动更新/sidecar |

## 架构

```text
浏览器 / Tauri WebView
        │  同一套 web/ 前端
        │  Authorization: Bearer <token>
        ▼
   远程 Express API (/v1/*)
        │
        ├─ PostgreSQL（用户、会话、auth_sessions）
        └─ Agent + Dida MCP（按用户）
```

开发时：

```text
Vite :5173  ──proxy /v1──►  Express :3000
Tauri dev 可加载 Vite；浏览器亦可直接访问 Vite
```

生产时：

```text
Tauri 安装包内嵌 web/dist  ──HTTPS──►  生产 API（VITE_API_BASE）
浏览器访问 Express 托管的 web/dist（同域相对路径，VITE_API_BASE 为空亦可）
```

## 鉴权变更

### 现状

- `auth_sessions` 存 `token_hash` + 过期时间
- 登录/注册通过 `Set-Cookie: missy_session=...`
- 受保护接口用 Cookie 还原用户

### 目标

- **库表不变**，继续用 `auth_sessions`
- 登录 / 注册响应体返回 `{ user, token, expiresAt }`，不再写 Cookie
- 客户端请求头：`Authorization: Bearer <token>`
- 服务端：从 Authorization 取出 token → 与现有相同的 `tokenHash` 查找会话
- 登出 / 注销：按 Bearer token 删除当前会话；移除 `setSessionCookie` / `clearSessionCookie` 路径
- **不做 Cookie 双轨**；旧 Cookie 会话自然失效，用户重新登录

### 客户端存储

- `localStorage` 键名：`missy.authToken`（可选另存 `missy.authExpiresAt` 仅作展示，鉴权以服务端为准）
- 登录/注册成功写入；登出、注销、`/v1/me` 返回 401 时清除
- 启动：有 token 则请求 `/v1/me`；失败则清 token 并进入未登录态

## 前端与 API base

### 请求层

- `api()` / `streamApi()`：
  - URL = `(import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "") + path`
  - 有 token 时设置 `Authorization: Bearer …`
  - 去掉 `credentials: "same-origin"`
- 业务 UI（路由、聊天流式、设置、debug 面板）逻辑不变

### `VITE_API_BASE`

| 场景 | 值 | 行为 |
|------|-----|------|
| 本地 `npm run web` | 空 | 相对路径 `/v1`，Vite 代理到 `:3000` |
| 生产 Express 托管前端 | 空（同域）或同主机 API | 相对路径即可 |
| Tauri / 跨域前端构建 | 完整 API 根，如 `https://api.example.com` | 绝对 URL |

### CORS

- Express 需允许跨域请求携带 `Authorization`（桌面 WebView origin 与可选的独立前端域名）
- 不再依赖 Cookie / `Access-Control-Allow-Credentials` 作为主路径
- 允许的 Origin 可通过环境变量配置（如 `CORS_ORIGINS`，逗号分隔）；开发默认可放宽到 Vite 与 Tauri 常用 origin

## Tauri 壳

### 目录与职责

```text
missy/
├── web/              # 共用前端（Vite）
├── src/              # Express + Agent
├── src-tauri/        # Tauri 2：窗口、打包配置
└── package.json      # 增加 desktop:dev / desktop:build
```

- `frontendDist` → `../web/dist`
- 壳内不跑 Agent、不连 Postgres、不启 sidecar
- 首版不做：系统托盘、原生通知、深链、自动更新

### 脚本与开发流

- `desktop:dev`：Tauri 开发模式加载 Vite（或文档约定先 `serve` + `web`）
- `desktop:build`：先以目标 `VITE_API_BASE` 构建 `web/dist`，再 `tauri build`
- README 补充：Rust toolchain 与平台依赖要求

### 平台

- 配置支持 macOS / Windows / Linux；首版可只验证维护者常用平台，其余随 CI/打包补齐

## 服务端其它改动

- `createHttpApp` / `auth.ts`：鉴权入口改为 Bearer；删除 Cookie 读写对外行为
- 生产环境仍可 `express.static(web/dist)` 服务浏览器用户
- 可选：`CORS_ORIGINS` 配置

## 错误处理

| 情况 | 行为 |
|------|------|
| 无 token 访问受保护 API | 401 `UNAUTHORIZED` |
| 过期 / 无效 token | 401；客户端清 localStorage，回登录 |
| API 不可达 | 前端现有错误展示路径提示网络错误 |
| 流式请求中途 401 | 中止流、清 token、回登录 |

## 测试与验证

- 单元/集成：登录返回 `token`；带 `Authorization` 访问 `/v1/me` 与会话接口；登出后 token 失效
- 移除或改写依赖 Cookie 的断言
- 手动：浏览器开发流；Tauri `desktop:dev` 连本地 API；用生产 `VITE_API_BASE` 打一版桌面包做冒烟

## 非目标（本规格明确不做）

- 本地一体机（内嵌 Node / 本地 Postgres）
- 运行时用户可改 API 地址的设置页
- Cookie 与 Bearer 双轨兼容
- 桌面原生能力增强（托盘、通知、自动更新）

## 实现顺序建议

1. 服务端 Bearer 鉴权 + CORS + 测试更新  
2. 前端 token 存储与 `api()` / `streamApi()` 改造  
3. 初始化 `src-tauri/` 与 npm 脚本  
4. README / 构建说明与冒烟验证  
