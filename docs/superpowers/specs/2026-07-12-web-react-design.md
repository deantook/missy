# Web → React（web-react）迁移 — 设计文档

**日期：** 2026-07-12  
**状态：** 已批准（待实现）

## 目标

在保留现有 `web/`（Vanilla + Vite）的前提下，新增功能对等的 React 前端 `web-react/`，并用 CSS Modules 做组件级样式。桌面端 Tauri 切换为加载 `web-react`；浏览器默认入口 `npm run web` 仍指向 vanilla，直到后续显式切换。

## 决策摘要

| 项 | 选择 |
|----|------|
| 与 `web/` 关系 | 并行保留（方案 A）；独立脚本 `web:react` / `web:react:build` |
| 功能范围 | 功能对等：落地页、鉴权、聊天流式、会话管理、设置、Choice、主题、Debug |
| 样式 | CSS Modules + `tokens.css` 变量（不做 Tailwind / 全局大 CSS 原样拷贝） |
| 纯逻辑 | 复制进 `web-react/src/lib/`（choice-prompt、debug-timeline），不建 monorepo 共享包 |
| 技术栈 | Vite + React + TypeScript；不加 react-router / UI 组件库 / SSR |
| Tauri | `frontendDist`、`beforeDevCommand`、`beforeBuildCommand`、`devUrl` 全部指向 `web-react`（端口 5174） |

## 架构

```text
浏览器（可选）
  npm run web          → web/        :5173   （vanilla，保持不变）
  npm run web:react    → web-react/  :5174   （React）

Tauri 桌面
  desktop:dev/build    → web-react/dist（或 Vite :5174）
        │  Authorization: Bearer <token>
        ▼
   Express API (/v1/*) :3000
```

开发时：

```text
Vite web-react :5174  ──proxy /v1,/health──►  Express :3000
Tauri beforeDevCommand = npm run web:react
Tauri devUrl = http://127.0.0.1:5174
```

生产时：

```text
Tauri 安装包内嵌 web-react/dist  ──HTTPS──►  生产 API（VITE_API_BASE）
Express 仍可继续托管 web/dist 给浏览器用户（本阶段不强制切换）
```

## 目录结构

```text
web-react/
  index.html
  vite.config.ts
  src/
    main.tsx
    App.tsx
    api/                 # api()、streamApi()、auth headers、API_BASE
    lib/                 # choice-prompt.ts、debug-timeline.ts（自 web 复制）
    styles/tokens.css    # 颜色、字体、间距等 CSS 变量；暗色主题变量
    pages/               # Landing、Auth、Chat、Settings
    components/          # AppShell、Sidebar、MessageList、Composer、
                         # ChoiceDialog、ConfirmDialog、Toast、DebugPane、Markdown…
    hooks/               # useAuth、useTheme、useRouter、chat 相关
    *.module.css         # 与组件同目录或就近放置
```

根 `package.json` 新增：

- 依赖：`react`、`react-dom`；dev：`@types/react`、`@types/react-dom`、`@vitejs/plugin-react`
- 脚本：`web:react`、`web:react:build`、`web:react:preview`
- 现有 `web` / `web:build` / `web:preview` 不变

`src-tauri/tauri.conf.json` 变更：

| 字段 | 原值 | 新值 |
|------|------|------|
| `beforeDevCommand` | `npm run web` | `npm run web:react` |
| `devUrl` | `http://127.0.0.1:5173` | `http://127.0.0.1:5174` |
| `beforeBuildCommand` | `npm run web:build` | `npm run web:react:build` |
| `frontendDist` | `../web/dist` | `../web-react/dist` |

## 路由与状态

### 路由

不引入 react-router。使用 `history.pushState` + `popstate`，路径与现网一致：

- `/` — 未登录落地页；已登录聊天
- `/login`、`/register` — 鉴权
- `/settings` — 账户设置
- 桌面壳（`__TAURI__` / `__TAURI_INTERNALS__`）未登录时落到 `/login`，不展示落地页返回首页控件（与现网一致）

### 状态边界

| Provider / 范围 | 职责 |
|-----------------|------|
| `AuthProvider` | user、token 读写、login/register/logout、401 清会话 |
| `ChatProvider` | conversations、active、turns、pending、CRUD、sendMessage 流式 |
| `ThemeProvider` | light/dark、`localStorage`、`document.documentElement.dataset.theme` |
| 页面 / 组件本地 | sidebar 折叠、debug 折叠、Choice dismiss、Toast、Confirm |

## 流式聊天

- 请求：`POST /v1/conversations/:id/messages`，`Accept: application/x-ndjson`
- 事件：`start` / `delta` / `done` / `debug` / `error`（与现网协议一致）
- React 侧：`delta` 只更新当前 turn 的 `assistantContent`；消息气泡组件细粒度更新，避免整页重渲导致打字卡顿
- debug 构建：`vite --debug` → `VITE_DEBUG=true`（与 `web/vite.config.ts` 相同 argv 过滤方式）

## 样式策略

1. 从现有 `web/src/style.css` 抽出设计 token 到 `styles/tokens.css`（含 `html[data-theme="dark"]` 变量覆盖）。
2. 各页面/组件使用 `*.module.css`，用 CSS 变量引用 token，不依赖全局 class 名耦合。
3. Markdown 渲染区域可保留一组 scoped 的 prose 样式（module 或 `Markdown.module.css`）。
4. 不要求与 vanilla 像素级一致；布局、交互、信息架构必须对等。

## 错误处理

- HTTP `401`（`UNAUTHORIZED` 或无 code）：清除 token 与本地会话状态，进入登录/落地路由。
- 流式意外结束：当前 turn `status=failed`，Toast 提示；debug 模式下写入 debug error 块。
- 表单校验：登录/设置沿用现有文案与规则（密码长度、邮箱、Token 长度等），Toast 或行内错误。
- `ConfirmDialog` / `ChoiceDialog`：Escape 关闭；关闭后焦点回到触发前元素。

## 测试与类型检查

- 将 `tests/choice-prompt.test.ts`、`tests/debug-panel.test.ts` 的导入改为（或新增并行测）`web-react/src/lib/...`；vanilla 原测可保留指向 `web/`。
- 首版不做全量 React Testing Library UI 套件。
- `npm run typecheck` 需能覆盖 `web-react`（扩展 `tsconfig` 或独立 `web-react/tsconfig` 并被根脚本引用）。

## 验收标准

- [ ] `npm run web` 仍启动 vanilla `web/`
- [ ] `npm run web:react` 在 `:5174` 启动 React 应用，代理 API 正常
- [ ] 功能对等：落地页、登录/注册、会话列表/新建/重命名/删除、流式回复、点赞点踩、Choice 弹窗、设置全表单、主题切换、sidebar、Debug（`--debug`）
- [ ] `npm run desktop:dev` / `desktop:build` 使用 `web-react`
- [ ] Bearer、`VITE_API_BASE`、主题防闪烁脚本行为与现网一致

## 模块化硬约束

禁止复刻 `web/src/main.ts` 式庞大单文件：

- `main.tsx` 仅挂载（目标 ≤30 行）
- `App.tsx` 仅 Providers + 路由出口（目标 ≤100 行）
- 任意单个 `.ts` / `.tsx` 软上限 200 行；超过 250 行必须再拆
- 页面只编排；业务进 `hooks` / `api` / `lib` / `context`

## 明确不做（本阶段）

- 删除或停用 `web/`
- 将 Express 静态托管默认切到 `web-react/dist`
- 引入 react-router、Redux、UI 组件库、Tailwind、SSR
- 建立 `packages/web-shared` monorepo
- 像素级视觉回归自动化

## 实现顺序建议

1. 脚手架：`web-react` Vite React + 脚本 + tokens + Tauri 指向切换  
2. api / auth / theme / router hooks + lib 复制  
3. Auth + Landing  
4. Chat 壳 + 流式消息  
5. Choice / Confirm / Toast  
6. Settings  
7. Debug 面板  
8. 对等手工验收 + typecheck / 相关单测  
