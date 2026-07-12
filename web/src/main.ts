import "./style.css";
import DOMPurify from "dompurify";
import { marked } from "marked";

type Usage = { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
type User = { id: string; email: string; displayName: string; didaTokenConfigured: boolean; didaTokenHint: string | null };
type Conversation = { id: string; title: string; usage: Usage; createdAt: string; updatedAt: string };
type Turn = { id: string; userContent: string; assistantContent: string | null; status: "pending" | "succeeded" | "failed"; errorMessage?: string | null; usage: Usage; createdAt: string };

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("找不到应用挂载点");

let user: User | null = null;
let conversations: Conversation[] = [];
let active: Conversation | null = null;
let turns: Turn[] = [];
let pending = false;
let authMode: "login" | "register" = "login";

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

function renderMarkdown(value: string): string {
  return DOMPurify.sanitize(marked.parse(value, { async: false, breaks: true }) as string, {
    USE_PROFILES: { html: true },
  });
}

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: options.body ? { "Content-Type": "application/json", ...options.headers } : options.headers,
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message || `请求失败（${response.status}）`);
  return data;
}

function usageText(usage: Usage): string {
  return usage.totalTokens === null ? "Token 暂不可用" : `${usage.totalTokens.toLocaleString()} tokens`;
}

function showToast(message: string, error = false): void {
  document.querySelector(".toast")?.remove();
  root.insertAdjacentHTML("beforeend", `<div class="toast ${error ? "error" : ""}">${escapeHtml(message)}</div>`);
  setTimeout(() => document.querySelector(".toast")?.remove(), 3200);
}

function renderAuth(): void {
  const registering = authMode === "register";
  root.innerHTML = `<main class="auth-page">
    <section class="auth-brand"><div class="brand-mark">✦</div><p class="eyebrow">DIDA365 · DEEP AGENT</p><h1>让计划，真正<br>开始行动。</h1><p>连接你的滴答清单，用自然语言安排、查询和完成每一天。</p></section>
    <section class="auth-card">
      <div><p class="eyebrow">${registering ? "CREATE ACCOUNT" : "WELCOME BACK"}</p><h2>${registering ? "创建你的账户" : "登录 Missy"}</h2><p>${registering ? "几秒钟即可开始使用。" : "继续管理你的清单与日程。"}</p></div>
      <form id="auth-form">
        ${registering ? '<label>显示名称<input name="displayName" maxlength="80" autocomplete="name" placeholder="怎么称呼你" required></label>' : ""}
        <label>邮箱<input name="email" type="email" maxlength="254" autocomplete="email" placeholder="you@example.com" required></label>
        <label>密码<input name="password" type="password" minlength="${registering ? 8 : 1}" maxlength="128" autocomplete="${registering ? "new-password" : "current-password"}" placeholder="${registering ? "至少 8 位" : "输入密码"}" required></label>
        <p id="auth-error" class="form-error"></p><button class="primary wide" type="submit">${registering ? "注册并登录" : "登录"}</button>
      </form>
      <p class="auth-switch">${registering ? "已有账户？" : "还没有账户？"}<button id="switch-auth" type="button">${registering ? "直接登录" : "创建账户"}</button></p>
    </section></main>`;
  document.querySelector("#switch-auth")!.addEventListener("click", () => { authMode = registering ? "login" : "register"; renderAuth(); });
  document.querySelector<HTMLFormElement>("#auth-form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    const data = Object.fromEntries(new FormData(form));
    button.disabled = true;
    try {
      const result = await api<{ user: User }>(`/v1/auth/${registering ? "register" : "login"}`, { method: "POST", body: JSON.stringify(data) });
      user = result.user; await loadConversations(); renderApp();
    } catch (error) {
      document.querySelector("#auth-error")!.textContent = error instanceof Error ? error.message : String(error);
    } finally { button.disabled = false; }
  });
}

function renderApp(): void {
  if (!user) return renderAuth();
  root.innerHTML = `<div class="app-shell">
    <aside class="sidebar">
      <div class="logo"><span>✦</span><strong>Missy</strong></div>
      <button id="new-chat" class="new-chat" type="button"><span>＋</span> 新建对话</button>
      <nav class="history"><p>最近对话</p><div id="conversation-list"></div></nav>
      <button id="profile-button" class="profile" type="button"><span>${escapeHtml(user.displayName.slice(0, 1).toUpperCase())}</span><div><strong>${escapeHtml(user.displayName)}</strong><small>${escapeHtml(user.email)}</small></div><b>•••</b></button>
    </aside>
    <main class="chat-pane">
      <header class="chat-header"><button id="mobile-menu" class="icon-button" type="button">☰</button><div><h2>${escapeHtml(active?.title ?? "新对话")}</h2></div><div class="header-actions"><span class="online-dot"></span></div></header>
      <section id="messages" class="messages">${renderMessages()}</section>
      <div class="composer-wrap">
        ${!user.didaTokenConfigured ? '<button id="configure-token" class="token-banner"><span>!</span><div><strong>连接滴答清单</strong><small>配置 Dida MCP Token 后即可开始对话</small></div><b>去设置 →</b></button>' : ""}
        <form id="composer" class="composer"><textarea id="message-input" maxlength="4000" rows="1" placeholder="给 Missy 发送消息…" ${!user.didaTokenConfigured || pending ? "disabled" : ""}></textarea><div class="composer-footer"><label><input id="allow-delete" type="checkbox"> 允许本次删除</label><button class="send" type="submit" ${!user.didaTokenConfigured || pending ? "disabled" : ""}>↑</button></div></form>
        <p class="hint">Enter 发送 · Shift + Enter 换行 · 删除授权仅对本次请求生效</p>
      </div>
    </main></div>`;
  renderConversationList();
  bindAppEvents();
  requestAnimationFrame(() => {
    const messages = document.querySelector<HTMLElement>("#messages");
    if (messages) messages.scrollTop = messages.scrollHeight;
  });
}

function renderMessages(): string {
  if (!turns.length) return `<div class="welcome"><div class="brand-mark">✦</div><h1>今天想安排什么？</h1><p>查询待办、创建任务、调整日程，或者完成你的清单。</p><div class="suggestions"><button>今天有哪些待办？</button><button>创建一个明天下午三点写周报的任务</button><button>列出最近七天已完成的任务</button></div></div>`;
  return turns.map((turn) => `<div class="turn">
    <article class="message user"><div class="avatar">你</div><div><p>你</p><div class="bubble">${escapeHtml(turn.userContent).replace(/\n/g, "<br>")}</div></div></article>
    <article class="message assistant"><div class="avatar">✦</div><div class="message-content"><p>Missy</p><div class="bubble markdown ${turn.status === "failed" ? "failed" : ""}">${turn.status === "pending" ? '<span class="typing"><i></i><i></i><i></i></span>' : renderMarkdown(turn.assistantContent || `请求失败：${turn.errorMessage ?? "未知错误"}`)}</div>${turn.status !== "pending" ? `<small class="usage">输入 ${turn.usage.inputTokens ?? "—"} · 输出 ${turn.usage.outputTokens ?? "—"} · 总计 ${turn.usage.totalTokens ?? "—"} tokens</small>` : ""}</div></article>
  </div>`).join("");
}

function hideContextMenu(): void {
  document.querySelector(".context-menu")?.remove();
}

function showConversationMenu(event: MouseEvent, conversationId: string): void {
  event.preventDefault();
  hideContextMenu();
  const conversation = conversations.find((item) => item.id === conversationId);
  if (!conversation) return;
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.innerHTML = `<button type="button" data-action="rename">重命名</button><button type="button" data-action="delete" class="danger">删除</button>`;
  root.appendChild(menu);
  const pad = 8;
  const { width, height } = menu.getBoundingClientRect();
  const left = Math.min(event.clientX, window.innerWidth - width - pad);
  const top = Math.min(event.clientY, window.innerHeight - height - pad);
  menu.style.left = `${Math.max(pad, left)}px`;
  menu.style.top = `${Math.max(pad, top)}px`;
  menu.querySelector('[data-action="rename"]')!.addEventListener("click", () => { hideContextMenu(); void renameConversation(conversationId); });
  menu.querySelector('[data-action="delete"]')!.addEventListener("click", () => { hideContextMenu(); void deleteConversation(conversationId); });
}

function renderConversationList(): void {
  const list = document.querySelector("#conversation-list");
  if (!list) return;
  list.innerHTML = conversations.length ? conversations.map((conversation) => `<button class="conversation-item ${active?.id === conversation.id ? "active" : ""}" data-id="${conversation.id}"><span>${escapeHtml(conversation.title)}</span><small>${usageText(conversation.usage)}</small></button>`).join("") : '<p class="empty-list">还没有历史对话</p>';
  list.querySelectorAll<HTMLButtonElement>("[data-id]").forEach((button) => {
    button.addEventListener("click", () => void openConversation(button.dataset.id!));
    button.addEventListener("contextmenu", (event) => showConversationMenu(event, button.dataset.id!));
  });
}

function bindAppEvents(): void {
  hideContextMenu();
  document.querySelector("#new-chat")!.addEventListener("click", () => void createConversation());
  document.querySelector("#profile-button")!.addEventListener("click", renderSettings);
  document.querySelector("#configure-token")?.addEventListener("click", renderSettings);
  document.querySelector("#mobile-menu")!.addEventListener("click", () => document.querySelector(".sidebar")!.classList.toggle("open"));
  document.querySelectorAll<HTMLButtonElement>(".suggestions button").forEach((button) => button.addEventListener("click", () => void sendMessage(button.textContent ?? "")));
  const form = document.querySelector<HTMLFormElement>("#composer")!;
  const input = document.querySelector<HTMLTextAreaElement>("#message-input")!;
  form.addEventListener("submit", (event) => { event.preventDefault(); const message = input.value.trim(); if (message) { input.value = ""; void sendMessage(message); } });
  input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } });
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 160)}px`; });
}

async function loadConversations(): Promise<void> {
  const result = await api<{ conversations: Conversation[] }>("/v1/conversations");
  conversations = result.conversations;
}

async function createConversation(): Promise<void> {
  try {
    const result = await api<{ conversation: Conversation }>("/v1/conversations", { method: "POST", body: "{}" });
    conversations.unshift(result.conversation); active = result.conversation; turns = []; renderApp();
  } catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
}

async function openConversation(id: string): Promise<void> {
  try {
    const result = await api<{ conversation: Conversation; turns: Turn[] }>(`/v1/conversations/${id}`);
    active = result.conversation; turns = result.turns; renderApp(); setTimeout(() => { const el = document.querySelector("#messages"); if (el) el.scrollTop = el.scrollHeight; });
  } catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
}

async function sendMessage(message: string): Promise<void> {
  if (!user?.didaTokenConfigured || pending) return;
  if (!active) await createConversation();
  if (!active) return;
  const conversationId = active.id;
  const allowDelete = document.querySelector<HTMLInputElement>("#allow-delete")?.checked === true;
  const optimistic: Turn = { id: "pending", userContent: message, assistantContent: null, status: "pending", usage: { inputTokens: null, outputTokens: null, totalTokens: null }, createdAt: new Date().toISOString() };
  turns.push(optimistic); pending = true; renderApp();
  try {
    const result = await api<{ turn: Turn }>(`/v1/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ message, allowDelete }) });
    turns[turns.length - 1] = result.turn;
    await loadConversations(); active = conversations.find((item) => item.id === conversationId) ?? active;
  } catch (error) {
    optimistic.status = "failed"; optimistic.errorMessage = error instanceof Error ? error.message : String(error);
  } finally { pending = false; renderApp(); }
}

async function renameConversation(id: string): Promise<void> {
  const conversation = conversations.find((item) => item.id === id);
  if (!conversation) return;
  const title = prompt("新的会话名称", conversation.title)?.trim(); if (!title) return;
  try {
    const result = await api<{ conversation: Conversation }>(`/v1/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ title }) });
    conversations = conversations.map((item) => item.id === id ? result.conversation : item);
    if (active?.id === id) active = result.conversation;
    renderApp();
  } catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
}

async function deleteConversation(id: string): Promise<void> {
  const conversation = conversations.find((item) => item.id === id);
  if (!conversation || !confirm(`确定删除“${conversation.title}”及全部记录吗？`)) return;
  try {
    await api<void>(`/v1/conversations/${id}`, { method: "DELETE" });
    if (active?.id === id) { active = null; turns = []; }
    await loadConversations();
    renderApp();
  } catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
}

function renderSettings(): void {
  if (!user) return;
  root.insertAdjacentHTML("beforeend", `<div class="modal-backdrop"><section class="settings-modal"><header><div><p class="eyebrow">ACCOUNT</p><h2>账户设置</h2></div><button id="close-settings" class="icon-button">×</button></header>
    <form id="profile-form" class="settings-section"><h3>个人资料</h3><div class="field-row"><label>显示名称<input name="displayName" value="${escapeHtml(user.displayName)}" required maxlength="80"></label><label>邮箱<input name="email" type="email" value="${escapeHtml(user.email)}" required></label></div><button class="secondary" type="submit">保存资料</button></form>
    <form id="token-form" class="settings-section"><h3>Dida MCP Token <span class="token-status ${user.didaTokenConfigured ? "ok" : ""}">${user.didaTokenConfigured ? `已连接 ${escapeHtml(user.didaTokenHint)}` : "未配置"}</span></h3><p>Token 将按账户独立保存，接口不会返回完整内容。</p><label>新 Token<input name="token" type="password" minlength="8" placeholder="粘贴 Dida MCP Token" required></label><button class="secondary" type="submit">验证并保存</button></form>
    <form id="password-form" class="settings-section"><h3>修改密码</h3><div class="field-row"><label>当前密码<input name="currentPassword" type="password" required></label><label>新密码<input name="newPassword" type="password" minlength="8" required></label></div><button class="secondary" type="submit">更新密码</button></form>
    <div class="settings-section danger-zone"><h3>账户操作</h3><div><button id="logout" class="secondary">退出登录</button><button id="delete-account" class="danger-button">注销账户</button></div></div>
  </section></div>`);
  document.querySelector("#close-settings")!.addEventListener("click", () => document.querySelector(".modal-backdrop")?.remove());
  document.querySelector(".modal-backdrop")!.addEventListener("click", (event) => { if (event.target === event.currentTarget) event.currentTarget.remove(); });
  bindSettingsForms();
}

function bindSettingsForms(): void {
  const submit = (selector: string, url: string, method: string, onSuccess: (result: unknown) => void) => document.querySelector<HTMLFormElement>(selector)!.addEventListener("submit", async (event) => {
    event.preventDefault(); const button = event.currentTarget.querySelector<HTMLButtonElement>("button")!; button.disabled = true;
    try { const result = await api<unknown>(url, { method, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); onSuccess(result); showToast("保存成功"); }
    catch (error) { showToast(error instanceof Error ? error.message : String(error), true); } finally { button.disabled = false; }
  });
  submit("#profile-form", "/v1/me", "PATCH", (result) => { user = (result as { user: User }).user; document.querySelector(".modal-backdrop")?.remove(); renderApp(); });
  submit("#token-form", "/v1/me/dida-token", "PUT", (result) => { user = (result as { user: User }).user; document.querySelector(".modal-backdrop")?.remove(); renderApp(); });
  submit("#password-form", "/v1/me/password", "PUT", () => { (document.querySelector("#password-form") as HTMLFormElement).reset(); });
  document.querySelector("#logout")!.addEventListener("click", async () => { await api<void>("/v1/auth/logout", { method: "POST" }); user = null; conversations = []; active = null; turns = []; renderAuth(); });
  document.querySelector("#delete-account")!.addEventListener("click", async () => {
    const password = prompt("注销会永久删除所有会话。请输入当前密码确认："); if (!password) return;
    try { await api<void>("/v1/me", { method: "DELETE", body: JSON.stringify({ password }) }); user = null; conversations = []; active = null; turns = []; renderAuth(); }
    catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
  });
}

async function bootstrap(): Promise<void> {
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest(".context-menu")) hideContextMenu();
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") hideContextMenu(); });
  window.addEventListener("blur", hideContextMenu);
  root.innerHTML = '<div class="boot"><div class="brand-mark">✦</div><p>正在载入 Missy…</p></div>';
  try { user = (await api<{ user: User }>("/v1/me")).user; await loadConversations(); if (conversations[0]) await openConversation(conversations[0].id); else renderApp(); }
  catch { user = null; renderAuth(); }
}

void bootstrap();
