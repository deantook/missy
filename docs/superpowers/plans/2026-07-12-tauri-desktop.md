# Tauri Desktop Thin Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将鉴权改为 Bearer Token，前端支持可配置 API base，并增加 Tauri 纯壳桌面端，与 Web 共用同一套 UI。

**Architecture:** 服务端复用 `auth_sessions`，登录返回明文 token；客户端 `localStorage` 存 token 并带 `Authorization`；`VITE_API_BASE` 构建注入；`src-tauri/` 仅加载 `web/dist`，不内嵌后端。

**Tech Stack:** TypeScript, Express, Vite, Tauri 2, vitest + supertest

**Spec:** `docs/superpowers/specs/2026-07-12-tauri-desktop-design.md`

---

## File structure

| Path | Responsibility |
|------|----------------|
| `src/auth.ts` | Bearer 解析；按 token 查/删会话；移除 Cookie API |
| `src/config.ts` | `CORS_ORIGINS` → `corsOrigins: string[]` |
| `src/http.ts` | CORS 中间件；登录返回 token；`authenticated` 读 Bearer |
| `src/server.ts` | 把 `corsOrigins` 传入 `createHttpApp` |
| `web/src/main.ts` | token 存取、`API_BASE`、请求头、401 清会话 |
| `web/src/vite-env.d.ts` | `VITE_API_BASE` 类型 |
| `src-tauri/*` | Tauri 2 壳（窗口 + 打包） |
| `package.json` | `@tauri-apps/cli`、`desktop:dev` / `desktop:build` |
| `tests/auth.test.ts` | Bearer 解析与会话查找单测 |
| `tests/http.test.ts` | 全部改为 `Authorization`，断言返回 `token` |
| `tests/config.test.ts` | `corsOrigins` 解析 |
| `.env.example` / `README.md` | `CORS_ORIGINS`、桌面构建说明 |

---

### Task 1: Auth 层改为 Bearer

**Files:**
- Modify: `src/auth.ts`
- Create: `tests/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/auth.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createSession,
  deleteSessionByToken,
  readBearerToken,
  userFromBearer,
} from "../src/auth.ts";
import { createDatabase, migrate, type Database } from "../src/db.ts";

let database: Database;
const email = `auth-${Date.now()}@example.com`;
let userId: string;

beforeAll(async () => {
  database = createDatabase(process.env.TEST_DATABASE_URL || "postgresql://dean:postgres@localhost:5432/missy");
  await migrate(database);
  const inserted = await database.query<{ id: string }>(
    `INSERT INTO users(email, display_name, password_hash)
     VALUES ($1, 'Auth', 'scrypt:x:x') RETURNING id`,
    [email],
  );
  userId = inserted.rows[0]!.id;
});

afterAll(async () => {
  await database.query("DELETE FROM users WHERE email = $1", [email]);
  await database.end();
});

describe("Bearer auth helpers", () => {
  it("parses Authorization Bearer tokens", () => {
    expect(readBearerToken("Bearer abc.def")).toBe("abc.def");
    expect(readBearerToken("bearer abc")).toBe("abc");
    expect(readBearerToken("Basic abc")).toBeNull();
    expect(readBearerToken(undefined)).toBeNull();
  });

  it("resolves and deletes sessions by token", async () => {
    const session = await createSession(database, userId);
    const user = await userFromBearer(database, `Bearer ${session.token}`);
    expect(user?.id).toBe(userId);
    expect(await userFromBearer(database, "Bearer deadbeef")).toBeNull();
    await deleteSessionByToken(database, session.token);
    expect(await userFromBearer(database, `Bearer ${session.token}`)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/auth.test.ts`

Expected: FAIL（导出符号不存在或旧 API）

- [ ] **Step 3: Rewrite `src/auth.ts`**

替换 Cookie 相关 API 为 Bearer。保留 `hashPassword` / `verifyPassword` / `createSession` / `publicUser` / `tokenHash`。完整目标文件：

```ts
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Database } from "./db.ts";

const scrypt = promisify(scryptCallback);
const SESSION_DAYS = 30;

export type UserRecord = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  dida_mcp_token: string | null;
  created_at: Date;
  updated_at: Date;
};

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64) as Buffer;
  return `scrypt:${salt.toString("base64")}:${key.toString("base64")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltValue, keyValue] = encoded.split(":");
  if (algorithm !== "scrypt" || !saltValue || !keyValue) return false;
  const expected = Buffer.from(keyValue, "base64");
  const actual = await scrypt(password, Buffer.from(saltValue, "base64"), expected.length) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function readBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

export async function createSession(database: Database, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await database.query(
    "INSERT INTO auth_sessions(user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [userId, tokenHash(token), expiresAt],
  );
  return { token, expiresAt };
}

export async function userFromBearer(
  database: Database,
  authorization: string | undefined,
): Promise<UserRecord | null> {
  const token = readBearerToken(authorization);
  if (!token) return null;
  const result = await database.query<UserRecord>(
    `UPDATE auth_sessions s SET last_seen_at = now()
     FROM users u WHERE s.token_hash = $1 AND s.expires_at > now() AND u.id = s.user_id
     RETURNING u.*`,
    [tokenHash(token)],
  );
  return result.rows[0] ?? null;
}

export async function deleteSessionByToken(database: Database, token: string): Promise<void> {
  await database.query("DELETE FROM auth_sessions WHERE token_hash = $1", [tokenHash(token)]);
}

export function publicUser(user: UserRecord) {
  const token = user.dida_mcp_token;
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    didaTokenConfigured: Boolean(token),
    didaTokenHint: token ? `••••${token.slice(-4)}` : null,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}
```

删除：`SESSION_COOKIE`、`readCookies`、`setSessionCookie`、`clearSessionCookie`、`userFromSession`、`deleteCurrentSession`，以及 `express` 的 `Response` 导入。

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/auth.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts tests/auth.test.ts
git commit -m "feat(auth): replace cookie sessions with Bearer helpers"
```

---

### Task 2: Config 增加 CORS_ORIGINS

**Files:**
- Modify: `src/config.ts`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Extend `ServerConfig` and `loadHttpConfig`**

在 `ServerConfig` 增加：

```ts
corsOrigins: string[];
```

在 `loadHttpConfig` 末尾、`return` 前：

```ts
const defaultDevOrigins = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
];
const nodeEnv = process.env.NODE_ENV?.trim() || "development";
const rawCors = process.env.CORS_ORIGINS?.trim();
const corsOrigins = rawCors
  ? rawCors.split(",").map((origin) => origin.trim()).filter(Boolean)
  : nodeEnv === "production"
    ? []
    : defaultDevOrigins;
```

`return` 中加入 `corsOrigins`，并用上面的 `nodeEnv` 变量（勿重复读）。

- [ ] **Step 2: Add config tests**

在 `tests/config.test.ts` 的 HTTP 相关 describe/用例中追加：

```ts
it("parses CORS_ORIGINS and defaults for development", () => {
  process.env.MODEL = "openai:gpt-4.1";
  process.env.OPENAI_API_KEY = "sk-test";
  delete process.env.CORS_ORIGINS;
  process.env.NODE_ENV = "development";
  const dev = loadHttpConfig({ loadDotenv: false });
  expect(dev.corsOrigins).toContain("http://127.0.0.1:5173");
  expect(dev.corsOrigins).toContain("tauri://localhost");

  process.env.NODE_ENV = "production";
  expect(loadHttpConfig({ loadDotenv: false }).corsOrigins).toEqual([]);

  process.env.CORS_ORIGINS = "https://app.example.com, https://api.example.com ";
  expect(loadHttpConfig({ loadDotenv: false }).corsOrigins).toEqual([
    "https://app.example.com",
    "https://api.example.com",
  ]);
});
```

- [ ] **Step 3: Run tests**

Run: `npm test -- tests/config.test.ts`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat(config): add CORS_ORIGINS for desktop and Vite origins"
```

---

### Task 3: HTTP 层 Bearer + CORS

**Files:**
- Modify: `src/http.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Update `createHttpApp` signature and imports**

`src/http.ts` 导入改为：

```ts
import {
  createSession, deleteSessionByToken, hashPassword, publicUser,
  readBearerToken, userFromBearer, verifyPassword, type UserRecord,
} from "./auth.ts";
```

`createHttpApp` 参数增加 `corsOrigins?: string[]`。删除对 `secure` 仅用于 Cookie 的依赖时：保留 `params.production` 用于静态托管；可删除局部 `const secure = ...`（若已无引用）。

- [ ] **Step 2: Add CORS middleware after `express.json`**

```ts
const allowedOrigins = new Set(params.corsOrigins ?? []);
app.use((req, res, next) => {
  const origin = req.header("origin");
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});
```

- [ ] **Step 3: Switch auth endpoints**

`authenticated`：

```ts
const authenticated = async (req: Request, res: Response): Promise<UserRecord | null> => {
  const user = await userFromBearer(params.database, req.header("authorization"));
  if (!user) sendError(res, 401, "UNAUTHORIZED", "请先登录。");
  return user;
};
```

注册成功（替换 `setSessionCookie` + 仅返回 user）：

```ts
const session = await createSession(params.database, result.rows[0]!.id);
res.status(201).json({
  user: publicUser(result.rows[0]!),
  token: session.token,
  expiresAt: session.expiresAt.toISOString(),
});
```

登录成功：

```ts
const session = await createSession(params.database, user.id);
res.json({
  user: publicUser(user),
  token: session.token,
  expiresAt: session.expiresAt.toISOString(),
});
```

登出：

```ts
app.post("/v1/auth/logout", async (req, res) => {
  const token = readBearerToken(req.header("authorization"));
  if (token) await deleteSessionByToken(params.database, token);
  res.status(204).end();
});
```

注销账户：删除 `clearSessionCookie` 调用，仅 `DELETE FROM users` 后 `204`（会话由 FK/级联或用户删除带走；若无 FK cascade，可先 `DELETE FROM auth_sessions WHERE user_id = $1`——与现有迁移一致即可，不额外发明行为）。

- [ ] **Step 4: Wire `corsOrigins` in `src/server.ts`**

```ts
const app = createHttpApp({
  database,
  model: config.model,
  dida365McpUrl: config.dida365McpUrl,
  production: config.nodeEnv === "production",
  corsOrigins: config.corsOrigins,
  mcpManager,
  ready: () => !closing,
});
```

- [ ] **Step 5: Commit**（测试在下一 Task 整体更新后再跑全绿）

```bash
git add src/http.ts src/server.ts
git commit -m "feat(http): authenticate with Bearer and enable CORS"
```

---

### Task 4: 更新 HTTP 集成测试为 Bearer

**Files:**
- Modify: `tests/http.test.ts`

- [ ] **Step 1: Replace `register` helper and cookie usage**

在文件顶部辅助函数改为：

```ts
type Authed = { token: string };

async function register(email: string): Promise<Authed> {
  const response = await request(app())
    .post("/v1/auth/register")
    .send({ email, displayName: "测试用户", password: "password123" })
    .expect(201);
  expect(response.body.token).toEqual(expect.any(String));
  expect(response.headers["set-cookie"]).toBeUndefined();
  return { token: response.body.token as string };
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
```

- [ ] **Step 2: Rewrite tests that used `request.agent` + Cookie**

模式：登录/注册拿到 `token`，之后 `.set(bearer(token))`。

示例——账户生命周期：

```ts
it("supports account lifecycle and hides the full Dida token", async () => {
  const { token: initial } = await register(emails[0]!);
  await request(app()).post("/v1/auth/register")
    .send({ email: emails[0], displayName: "重复", password: "password123" }).expect(409);
  await request(app()).put("/v1/me/dida-token").set(bearer(initial))
    .send({ token: "invalid-token" }).expect(400);
  const saved = await request(app()).put("/v1/me/dida-token").set(bearer(initial))
    .send({ token: "valid-token-1234" }).expect(200);
  expect(saved.body.user).toMatchObject({ didaTokenConfigured: true, didaTokenHint: "••••1234" });
  expect(JSON.stringify(saved.body)).not.toContain("valid-token-1234");
  await request(app()).put("/v1/me/password").set(bearer(initial))
    .send({ currentPassword: "bad", newPassword: "newpassword123" }).expect(401);
  await request(app()).put("/v1/me/password").set(bearer(initial))
    .send({ currentPassword: "password123", newPassword: "newpassword123" }).expect(204);
  await request(app()).post("/v1/auth/logout").set(bearer(initial)).expect(204);
  await request(app()).get("/v1/me").set(bearer(initial)).expect(401);
  const login = await request(app()).post("/v1/auth/login")
    .send({ email: emails[0], password: "newpassword123" }).expect(200);
  expect(login.body.token).toEqual(expect.any(String));
});
```

失败 agent / 流式 / debug 用例：用 `login.body.token` 替代 `login.headers["set-cookie"]`：

```ts
.set(bearer(login.body.token))
```

会话归属与其它用例同样改为显式 Bearer。删除所有 `request.agent` 与 `set-cookie` 断言（除「注册无 set-cookie」外）。

- [ ] **Step 3: Run full test suite**

Run: `npm test`

Expected: PASS（含 `tests/http.test.ts`、`tests/auth.test.ts`）

- [ ] **Step 4: Commit**

```bash
git add tests/http.test.ts
git commit -m "test(http): assert Bearer tokens instead of session cookies"
```

---

### Task 5: 前端 API base + Bearer 存储

**Files:**
- Modify: `web/src/vite-env.d.ts`
- Modify: `web/src/main.ts`

- [ ] **Step 1: Extend Vite env types**

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEBUG: string;
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 2: Add token helpers and request URL near top of `main.ts`（在 `api` 之前）**

```ts
const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
const authTokenStorageKey = "missy.authToken";

function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

function readAuthToken(): string | null {
  try { return localStorage.getItem(authTokenStorageKey); }
  catch { return null; }
}

function writeAuthToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(authTokenStorageKey, token);
    else localStorage.removeItem(authTokenStorageKey);
  } catch { /* ignore quota / private mode */ }
}

function authHeaders(extra: HeadersInit = {}): HeadersInit {
  const headers = new Headers(extra);
  const token = readAuthToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

function clearSessionState(): void {
  writeAuthToken(null);
  user = null;
  conversations = [];
  active = null;
  turns = [];
}
```

- [ ] **Step 3: Replace `api` and `streamApi`**

```ts
async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(url), {
    ...options,
    headers: authHeaders(
      options.body
        ? { "Content-Type": "application/json", ...options.headers }
        : options.headers,
    ),
  });
  if (response.status === 401) {
    clearSessionState();
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message || `请求失败（${response.status}）`);
  return data;
}

async function streamApi(url: string, body: unknown, onEvent: (event: StreamEvent) => void): Promise<void> {
  const response = await fetch(apiUrl(url), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json", Accept: "application/x-ndjson" }),
    body: JSON.stringify(body),
  });
  if (response.status === 401) {
    clearSessionState();
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(data.error?.message || `请求失败（${response.status}）`);
  }
  if (!response.body) throw new Error("浏览器不支持流式响应。");
  // ... keep existing reader loop unchanged ...
}
```

注意：`streamApi` 仅替换 `fetch` 调用头部与 URL；reader 循环保持原样。

- [ ] **Step 4: Wire login / logout / delete / bootstrap**

登录成功（`renderAuth` submit）：

```ts
const result = await api<{ user: User; token: string }>(
  `/v1/auth/${registering ? "register" : "login"}`,
  { method: "POST", body: JSON.stringify(data) },
);
writeAuthToken(result.token);
user = result.user;
```

登出：

```ts
document.querySelector("#logout")!.addEventListener("click", async () => {
  try { await api<void>("/v1/auth/logout", { method: "POST" }); }
  catch { /* still clear local */ }
  clearSessionState();
  history.replaceState(null, "", "/");
  renderHome();
});
```

注销成功后：`clearSessionState()` 替代手动 `user = null; ...`。

`bootstrap`：若无 token，直接 `user = null; route(); return;`；有 token 再请求 `/v1/me`。401 时 `clearSessionState` 已在 `api` 内处理，catch 里 `route()`。

```ts
async function bootstrap(): Promise<void> {
  // ... existing event listeners ...
  root.innerHTML = '<div class="boot"><div class="brand-mark">✦</div><p>正在载入 Missy…</p></div>';
  if (!readAuthToken()) {
    user = null;
    route();
    return;
  }
  try {
    user = (await api<{ user: User }>("/v1/me")).user;
    await loadConversations();
    if (currentPath() === "/settings") renderSettingsPage();
    else if (conversations[0]) await openConversation(conversations[0].id);
    else renderApp();
  } catch {
    clearSessionState();
    route();
  }
}
```

流式请求若 401：`api`/`streamApi` 已清 token；调用方现有 `catch` 应在聊天失败时若 `!readAuthToken()` 则 `history.replaceState` + `renderHome()`（在 `sendMessage` 的 catch 中加）：

```ts
} catch (error) {
  if (!readAuthToken()) {
    history.replaceState(null, "", "/");
    renderHome();
    return;
  }
  // existing error UI ...
}
```

（在 `sendMessage` / 发消息的 catch 中按现有结构插入；若已有 toast，保留并加未登录跳转。）

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`

Expected: PASS

```bash
git add web/src/main.ts web/src/vite-env.d.ts
git commit -m "feat(web): store Bearer token and honor VITE_API_BASE"
```

---

### Task 6: 初始化 Tauri 2 壳

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/capabilities/default.json`
- Create: `src-tauri/.gitignore`
- Modify: `package.json`

- [ ] **Step 1: Install CLI**

Run:

```bash
npm install -D @tauri-apps/cli@2
```

- [ ] **Step 2: Create Rust / Tauri files**

`src-tauri/Cargo.toml`：

```toml
[package]
name = "missy"
version = "0.1.0"
description = "Missy desktop shell"
authors = ["Missy"]
edition = "2021"

[lib]
name = "missy_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

`src-tauri/build.rs`：

```rust
fn main() {
    tauri_build::build()
}
```

`src-tauri/src/lib.rs`：

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running Missy");
}
```

`src-tauri/src/main.rs`：

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    missy_lib::run();
}
```

`src-tauri/capabilities/default.json`：

```json
{
  "$schema": "https://schemas.tauri.app/config/2/capability.json",
  "identifier": "default",
  "description": "Default Missy desktop capability",
  "windows": ["main"],
  "permissions": ["core:default", "shell:allow-open"]
}
```

`src-tauri/tauri.conf.json`：

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Missy",
  "version": "0.1.0",
  "identifier": "app.missy.desktop",
  "build": {
    "beforeDevCommand": "npm run web",
    "devUrl": "http://127.0.0.1:5173",
    "beforeBuildCommand": "npm run web:build",
    "frontendDist": "../web/dist"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Missy",
        "width": 1200,
        "height": 800,
        "resizable": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

`src-tauri/.gitignore`：

```
/target
/gen/schemas
```

- [ ] **Step 3: Generate default icons**

Run（需本机已装 Rust；若 `cargo` 不可用，先安装 [rustup](https://rustup.rs)）：

```bash
npm exec tauri icon -- ./web/public/favicon.svg 2>/dev/null || npm exec tauri icon
```

若项目无合适源图：从 Tauri 默认图标集复制——运行：

```bash
mkdir -p src-tauri/icons
curl -fsSL -o /tmp/tauri-icon.png https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-cli/templates/app/icons/128x128.png
npm exec -- tauri icon /tmp/tauri-icon.png
```

确认 `src-tauri/icons/` 下存在 conf 中列出的文件。

- [ ] **Step 4: Add npm scripts**

在 `package.json` `scripts` 中增加：

```json
"desktop:dev": "tauri dev",
"desktop:build": "tauri build"
```

桌面生产 API 地址通过环境变量在构建前注入，例如：

```bash
VITE_API_BASE=https://your-api.example.com npm run desktop:build
```

`beforeBuildCommand` 已是 `npm run web:build`，会继承当前 shell 的 `VITE_API_BASE`。

- [ ] **Step 5: Smoke `tauri dev`（需本机 Rust + 另开 `npm run serve`）**

Run:

```bash
npm run serve &
npm run desktop:dev
```

Expected: 打开桌面窗口，加载 Vite；登录流程可用（开发 `VITE_API_BASE` 为空，走代理）。

若环境无 Rust，记下阻塞并跳过运行态验证，但文件与脚本必须就位；在 README 标明依赖。

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src-tauri
git commit -m "feat(desktop): add Tauri 2 shell for shared web UI"
```

---

### Task 7: 文档与环境变量示例

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Update `.env.example`**

追加：

```bash
# Comma-separated browser/desktop Origins allowed to call the API cross-origin.
# Development defaults include Vite and Tauri origins when unset.
# Production: set explicitly if the desktop app or a separate web origin calls the API.
# CORS_ORIGINS=https://app.example.com,tauri://localhost,https://tauri.localhost
```

- [ ] **Step 2: Update README**

在「本地启动」后增加「桌面端」小节：

```markdown
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
```

在配置表增加 `CORS_ORIGINS` 一行。说明：鉴权已改为 Bearer，浏览器与桌面均使用 `Authorization`；旧 Cookie 会话失效需重新登录。

- [ ] **Step 3: Final verification**

Run:

```bash
npm test
npm run typecheck
npm run web:build
```

Expected: 全部成功。

- [ ] **Step 4: Commit**

```bash
git add .env.example README.md
git commit -m "docs: document Tauri desktop workflow and CORS_ORIGINS"
```

---

## Spec coverage checklist

| Spec 项 | Task |
|---------|------|
| Bearer 登录返回 token，去掉 Cookie | 1, 3, 4 |
| `Authorization` 鉴权 / 登出删会话 | 1, 3 |
| `VITE_API_BASE` + 前端请求层 | 5 |
| `localStorage` `missy.authToken`、401 清理 | 5 |
| CORS / `CORS_ORIGINS` | 2, 3, 7 |
| `src-tauri/` 纯壳 + scripts | 6 |
| README / 构建说明 | 7 |
| 不做托盘/通知/sidecar/可改 API | 未列入任务（有意） |
