import "./style.css";
import DOMPurify from "dompurify";
import { marked } from "marked";

type Usage = { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
type User = { id: string; email: string; displayName: string; didaTokenConfigured: boolean; didaTokenHint: string | null };
type Conversation = { id: string; title: string; usage: Usage; createdAt: string; updatedAt: string };
type Turn = { id: string; userContent: string; assistantContent: string | null; status: "pending" | "succeeded" | "failed"; errorMessage?: string | null; feedback?: "like" | "dislike" | null; usage: Usage; createdAt: string };

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("找不到应用挂载点");

let user: User | null = null;
let conversations: Conversation[] = [];
let active: Conversation | null = null;
let turns: Turn[] = [];
let pending = false;
let authMode: "login" | "register" = "login";
const sidebarStorageKey = "missy.sidebarCollapsed";
let sidebarCollapsed = (() => {
  try { return localStorage.getItem(sidebarStorageKey) === "true"; }
  catch { return false; }
})();

function currentPath(): string {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

function navigate(path: string): void {
  if (currentPath() === path) {
    route();
    return;
  }
  history.pushState(null, "", path);
  route();
}

function route(): void {
  if (!user) {
    if (currentPath() !== "/") history.replaceState(null, "", "/");
    renderAuth();
    return;
  }
  if (currentPath() === "/settings") {
    renderSettingsPage();
    return;
  }
  if (currentPath() !== "/") history.replaceState(null, "", "/");
  renderApp();
}

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
      user = result.user;
      await loadConversations();
      history.replaceState(null, "", "/");
      renderApp();
    } catch (error) {
      document.querySelector("#auth-error")!.textContent = error instanceof Error ? error.message : String(error);
    } finally { button.disabled = false; }
  });
}

function renderSidebar(): string {
  if (!user) return "";
  return `<aside class="sidebar">
    <div class="logo"><span>✦</span><strong>Missy</strong></div>
    <button id="new-chat" class="new-chat" type="button"><span>＋</span> 新建对话</button>
    <nav class="history"><p>最近对话</p><div id="conversation-list"></div></nav>
  </aside>`;
}

function appShellClass(): string {
  return `app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`;
}

function sidebarToggle(): string {
  return `<button id="sidebar-toggle" class="icon-button" type="button" title="显示或隐藏对话历史" aria-label="显示或隐藏对话历史" aria-pressed="${sidebarCollapsed}">☰</button>`;
}

function profileAvatar(active = false): string {
  if (!user) return "";
  const initial = escapeHtml(user.displayName.slice(0, 1).toUpperCase());
  return `<button id="profile-button" class="profile-avatar${active ? " active" : ""}" type="button" title="${escapeHtml(user.displayName)}" aria-label="账户设置">${initial}</button>`;
}

function bindSidebarToggle(): void {
  const setDesktopCollapsed = (collapsed: boolean) => {
    sidebarCollapsed = collapsed;
    document.querySelector(".app-shell")!.classList.toggle("sidebar-collapsed", collapsed);
    document.querySelector("#sidebar-toggle")!.setAttribute("aria-pressed", String(collapsed));
    try { localStorage.setItem(sidebarStorageKey, String(collapsed)); } catch { /* 状态记忆不可用时仍保留本次交互 */ }
  };
  document.querySelector("#sidebar-toggle")!.addEventListener("click", () => {
    const sidebar = document.querySelector(".sidebar")!;
    if (window.matchMedia("(max-width: 760px)").matches) {
      const open = sidebar.classList.toggle("open");
      document.querySelector("#sidebar-toggle")!.setAttribute("aria-expanded", String(open));
      return;
    }
    setDesktopCollapsed(!sidebarCollapsed);
  });
}

function renderApp(): void {
  if (!user) return renderAuth();
  root.innerHTML = `<div class="${appShellClass()}">
    ${renderSidebar()}
    <main class="chat-pane">
      <header class="chat-header">${sidebarToggle()}<div><h2>${escapeHtml(active?.title ?? "新对话")}</h2></div><div class="header-actions">${profileAvatar()}</div></header>
      <section id="messages" class="messages">${renderMessages()}</section>
      <div class="composer-wrap">
        ${!user.didaTokenConfigured ? '<button id="configure-token" class="token-banner"><span>!</span><div><strong>连接滴答清单</strong><small>配置 Dida MCP Token 后即可开始对话</small></div><b>去设置 →</b></button>' : ""}
        <form id="composer" class="composer"><textarea id="message-input" maxlength="4000" rows="1" placeholder="给 Missy 发送消息…" ${!user.didaTokenConfigured || pending ? "disabled" : ""}></textarea><button class="send" type="submit" ${!user.didaTokenConfigured || pending ? "disabled" : ""} aria-label="发送">↑</button></form>
        <p class="hint">Enter 发送 · Shift + Enter 换行</p>
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
    <article class="message user"><div><p>你</p><div class="bubble">${escapeHtml(turn.userContent).replace(/\n/g, "<br>")}</div></div></article>
    <article class="message assistant"><div class="message-content"><p>Missy</p><div class="bubble markdown ${turn.status === "failed" ? "failed" : ""}">${turn.status === "pending" ? '<span class="typing"><i></i><i></i><i></i></span>' : renderMarkdown(turn.assistantContent || `请求失败：${turn.errorMessage ?? "未知错误"}`)}</div>${turn.status === "succeeded" ? renderFeedback(turn) : ""}</div></article>
  </div>`).join("");
}

function renderFeedback(turn: Turn): string {
  const value = turn.feedback ?? null;
  return `<div class="feedback" role="group" aria-label="回复评价">
    <button type="button" class="feedback-btn ${value === "like" ? "active" : ""}" data-turn-id="${escapeHtml(turn.id)}" data-feedback="like" title="有帮助" aria-label="点赞" aria-pressed="${value === "like"}">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M2 21h4V9H2v12zm20-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L13.17 1 6.59 7.59C6.22 7.95 6 8.45 6 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>
    </button>
    <button type="button" class="feedback-btn ${value === "dislike" ? "active" : ""}" data-turn-id="${escapeHtml(turn.id)}" data-feedback="dislike" title="没帮助" aria-label="点踩" aria-pressed="${value === "dislike"}">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M22 3h-4v12h4V3zM2 14c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L10.83 23l6.58-6.59c.37-.36.59-.86.59-1.41V5c0-1.1-.9-2-2-2H7c-.83 0-1.54.5-1.84 1.22L2.14 11.27c-.09.23-.14.47-.14.73v2z"/></svg>
    </button>
  </div>`;
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
  document.querySelector("#profile-button")!.addEventListener("click", () => navigate("/settings"));
  document.querySelector("#configure-token")?.addEventListener("click", () => navigate("/settings"));
  bindSidebarToggle();
  document.querySelectorAll<HTMLButtonElement>(".suggestions button").forEach((button) => button.addEventListener("click", () => void sendMessage(button.textContent ?? "")));
  document.querySelectorAll<HTMLButtonElement>(".feedback-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const turnId = button.dataset.turnId;
      const feedback = button.dataset.feedback as "like" | "dislike" | undefined;
      if (turnId && feedback) void setTurnFeedback(turnId, feedback);
    });
  });
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
    active = result.conversation; turns = result.turns;
    if (currentPath() !== "/") navigate("/");
    else renderApp();
    setTimeout(() => { const el = document.querySelector("#messages"); if (el) el.scrollTop = el.scrollHeight; });
  } catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
}

async function sendMessage(message: string): Promise<void> {
  if (!user?.didaTokenConfigured || pending) return;
  if (!active) await createConversation();
  if (!active) return;
  const conversationId = active.id;
  const optimistic: Turn = { id: "pending", userContent: message, assistantContent: null, status: "pending", feedback: null, usage: { inputTokens: null, outputTokens: null, totalTokens: null }, createdAt: new Date().toISOString() };
  turns.push(optimistic); pending = true; renderApp();
  try {
    const result = await api<{ turn: Turn }>(`/v1/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ message, allowDelete: false }) });
    turns[turns.length - 1] = result.turn;
    await loadConversations(); active = conversations.find((item) => item.id === conversationId) ?? active;
  } catch (error) {
    optimistic.status = "failed"; optimistic.errorMessage = error instanceof Error ? error.message : String(error);
  } finally { pending = false; renderApp(); }
}

async function setTurnFeedback(turnId: string, feedback: "like" | "dislike"): Promise<void> {
  if (!active || pending) return;
  const turn = turns.find((item) => item.id === turnId);
  if (!turn || turn.status !== "succeeded") return;
  const next = turn.feedback === feedback ? null : feedback;
  const previous = turn.feedback ?? null;
  turn.feedback = next;
  renderApp();
  try {
    const result = await api<{ turn: Turn }>(`/v1/conversations/${active.id}/turns/${turnId}/feedback`, {
      method: "PUT",
      body: JSON.stringify({ feedback: next }),
    });
    const index = turns.findIndex((item) => item.id === turnId);
    if (index >= 0) turns[index] = { ...turns[index]!, ...result.turn };
    renderApp();
  } catch (error) {
    turn.feedback = previous;
    renderApp();
    showToast(error instanceof Error ? error.message : String(error), true);
  }
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

function renderSettingsContent(): string {
  if (!user) return "";
  const initial = escapeHtml(user.displayName.slice(0, 1).toUpperCase());
  const icon = (path: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  return `<section class="account-summary">
      <div class="account-summary-avatar">${initial}</div>
      <div><strong>${escapeHtml(user.displayName)}</strong><span>${escapeHtml(user.email)}</span></div>
      <div class="account-summary-status"><i></i>账户正常</div>
    </section>
    <div class="settings-grid">
      <form id="profile-form" class="settings-section profile-settings">
        <div class="section-heading"><span class="section-icon">${icon("M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z")}</span><div><h3>个人资料</h3><p>管理你的公开名称和登录邮箱</p></div></div>
        <div class="settings-fields"><label>显示名称<input name="displayName" value="${escapeHtml(user.displayName)}" required maxlength="80" autocomplete="name"></label><label>邮箱地址<input name="email" type="email" value="${escapeHtml(user.email)}" required autocomplete="email"></label></div>
        <div class="section-actions"><button class="primary compact" type="submit">保存更改</button></div>
      </form>
      <form id="password-form" class="settings-section password-settings">
        <div class="section-heading"><span class="section-icon">${icon("M7 10V7a5 5 0 0 1 10 0v3M6 10h12a2 2 0 0 1 2 2v8H4v-8a2 2 0 0 1 2-2Zm6 4v3")}</span><div><h3>登录安全</h3><p>定期更新密码，保护账户安全</p></div></div>
        <div class="settings-fields"><label>当前密码<input name="currentPassword" type="password" required autocomplete="current-password" placeholder="输入当前密码"></label><label>新密码<input name="newPassword" type="password" minlength="8" required autocomplete="new-password" placeholder="至少 8 位字符"></label></div>
        <div class="section-actions"><button class="secondary compact" type="submit">更新密码</button></div>
      </form>
      <form id="token-form" class="settings-section token-settings">
        <div class="section-heading"><span class="section-icon token-icon">${icon("M15 7a4 4 0 1 0-3.7 5.5L3 20.8V22h3l1.5-1.5L9 22l2-2-1.5-1.5 4.2-4.2A4 4 0 0 0 15 7Z")}</span><div><div class="heading-line"><h3>Dida MCP Token</h3><span class="token-status ${user.didaTokenConfigured ? "ok" : ""}"><i></i>${user.didaTokenConfigured ? "已连接" : "未配置"}</span></div><p>连接滴答清单，让 Missy 可以安全地管理你的任务</p></div></div>
        <div class="token-body">
          <label>${user.didaTokenConfigured ? "替换 Token" : "添加 Token"}<span class="token-input-wrap"><input name="token" type="password" minlength="8" placeholder="粘贴 Dida MCP Token" required autocomplete="off"><small>${user.didaTokenConfigured ? escapeHtml(user.didaTokenHint) : "安全加密保存"}</small></span></label>
          <button class="primary compact" type="submit">验证并保存</button>
        </div>
        <p class="privacy-note">${icon("M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z")}Token 按账户独立保存，任何接口都不会返回完整内容。</p>
      </form>
      <section class="settings-section account-actions">
        <div><h3>账户操作</h3><p>退出当前设备，或永久删除账户及所有数据。</p></div>
        <div><button id="logout" class="text-button" type="button">退出登录</button><button id="delete-account" class="danger-button compact" type="button">注销账户</button></div>
      </section>
    </div>`;
}

function renderSettingsPage(): void {
  if (!user) return renderAuth();
  root.innerHTML = `<div class="${appShellClass()}">
    ${renderSidebar()}
    <main class="settings-pane">
      <header class="settings-header">${sidebarToggle()}<span class="header-divider" aria-hidden="true"></span><button id="back-to-chat" class="back-link" type="button" title="返回对话" aria-label="返回对话"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg></button><div class="header-actions">${profileAvatar(true)}</div></header>
      <div class="settings-content"><div class="settings-intro"><p class="eyebrow">ACCOUNT SETTINGS</p><h1>账户设置</h1><p>管理你的个人资料、服务连接与账户安全。</p></div>${renderSettingsContent()}</div>
    </main></div>`;
  renderConversationList();
  bindSettingsPageEvents();
}

function bindSettingsPageEvents(): void {
  hideContextMenu();
  document.querySelector("#new-chat")!.addEventListener("click", () => { navigate("/"); void createConversation(); });
  document.querySelector("#profile-button")!.addEventListener("click", () => navigate("/settings"));
  bindSidebarToggle();
  document.querySelector("#back-to-chat")!.addEventListener("click", () => navigate("/"));
  bindSettingsForms();
}

function bindSettingsForms(): void {
  const submit = (selector: string, url: string, method: string, onSuccess: (result: unknown) => void) => document.querySelector<HTMLFormElement>(selector)!.addEventListener("submit", async (event) => {
    event.preventDefault(); const button = event.currentTarget.querySelector<HTMLButtonElement>("button")!; button.disabled = true;
    try { const result = await api<unknown>(url, { method, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); onSuccess(result); showToast("保存成功"); }
    catch (error) { showToast(error instanceof Error ? error.message : String(error), true); } finally { button.disabled = false; }
  });
  submit("#profile-form", "/v1/me", "PATCH", (result) => { user = (result as { user: User }).user; renderSettingsPage(); });
  submit("#token-form", "/v1/me/dida-token", "PUT", (result) => { user = (result as { user: User }).user; renderSettingsPage(); });
  submit("#password-form", "/v1/me/password", "PUT", () => { (document.querySelector("#password-form") as HTMLFormElement).reset(); });
  document.querySelector("#logout")!.addEventListener("click", async () => {
    await api<void>("/v1/auth/logout", { method: "POST" });
    user = null; conversations = []; active = null; turns = [];
    history.replaceState(null, "", "/");
    renderAuth();
  });
  document.querySelector("#delete-account")!.addEventListener("click", async () => {
    const password = prompt("注销会永久删除所有会话。请输入当前密码确认："); if (!password) return;
    try {
      await api<void>("/v1/me", { method: "DELETE", body: JSON.stringify({ password }) });
      user = null; conversations = []; active = null; turns = [];
      history.replaceState(null, "", "/");
      renderAuth();
    }
    catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
  });
}

async function bootstrap(): Promise<void> {
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest(".context-menu")) hideContextMenu();
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") hideContextMenu(); });
  window.addEventListener("blur", hideContextMenu);
  window.addEventListener("popstate", () => route());
  root.innerHTML = '<div class="boot"><div class="brand-mark">✦</div><p>正在载入 Missy…</p></div>';
  try {
    user = (await api<{ user: User }>("/v1/me")).user;
    await loadConversations();
    if (currentPath() === "/settings") renderSettingsPage();
    else if (conversations[0]) await openConversation(conversations[0].id);
    else renderApp();
  } catch {
    user = null;
    renderAuth();
  }
}

void bootstrap();
