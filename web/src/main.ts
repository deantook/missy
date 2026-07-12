import "./style.css";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { parseChoicePrompt, visibleAssistantContent, type ChoicePrompt } from "./choice-prompt.ts";
import { DebugTimeline, isDebugBuild, type ClientDebugEvent } from "./debug-panel.ts";

type Usage = { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
type User = { id: string; email: string; displayName: string; didaTokenConfigured: boolean; didaTokenHint: string | null };
type Conversation = { id: string; title: string; usage: Usage; createdAt: string; updatedAt: string };
type Turn = { id: string; userContent: string; assistantContent: string | null; status: "pending" | "succeeded" | "failed"; errorMessage?: string | null; feedback?: "like" | "dislike" | null; usage: Usage; createdAt: string };
type StreamEvent =
  | { type: "start"; turn: Turn }
  | { type: "delta"; delta: string; reset?: boolean }
  | { type: "done"; turn: Turn }
  | { type: "debug"; event: ClientDebugEvent }
  | { type: "error"; error: { message?: string; code?: string; stack?: string; cause?: string } };

const debugEnabled = isDebugBuild();
const debugPanelStorageKey = "missy.debugPanelCollapsed";
const debugTimeline = new DebugTimeline();

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("找不到应用挂载点");

let user: User | null = null;
let conversations: Conversation[] = [];
let active: Conversation | null = null;
let turns: Turn[] = [];
let pending = false;
let dismissedChoiceTurnId: string | null = null;
const sidebarStorageKey = "missy.sidebarCollapsed";
let sidebarCollapsed = (() => {
  try { return localStorage.getItem(sidebarStorageKey) === "true"; }
  catch { return false; }
})();
let debugPanelCollapsed = (() => {
  try { return localStorage.getItem(debugPanelStorageKey) === "true"; }
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
    if (currentPath() === "/login" || currentPath() === "/register") {
      renderAuth(currentPath() === "/register" ? "register" : "login");
      return;
    }
    if (currentPath() !== "/") history.replaceState(null, "", "/");
    renderHome();
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

async function streamApi(url: string, body: unknown, onEvent: (event: StreamEvent) => void): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(data.error?.message || `请求失败（${response.status}）`);
  }
  if (!response.body) throw new Error("浏览器不支持流式响应。");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal = false;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as StreamEvent;
    terminal ||= event.type === "done" || event.type === "error";
    onEvent(event);
  };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) consume(line);
    if (done) break;
  }
  consume(buffer);
  if (!terminal) throw new Error("流式响应意外中断，请稍后重试。");
}

function showToast(message: string, error = false): void {
  document.querySelector(".toast")?.remove();
  root.insertAdjacentHTML("beforeend", `<div class="toast ${error ? "error" : ""}">${escapeHtml(message)}</div>`);
  setTimeout(() => document.querySelector(".toast")?.remove(), 3200);
}

function showConfirmDialog(options: { title: string; message: string; confirmLabel?: string }): Promise<boolean> {
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialogId = `confirm-dialog-${crypto.randomUUID()}`;
  root.insertAdjacentHTML("beforeend", `<div class="confirm-dialog-backdrop">
    <section class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="${dialogId}-title" aria-describedby="${dialogId}-message">
      <div class="confirm-dialog-copy"><h3 id="${dialogId}-title">${escapeHtml(options.title)}</h3><p id="${dialogId}-message">${escapeHtml(options.message)}</p></div>
      <div class="confirm-dialog-actions"><button class="confirm-cancel" type="button">取消</button><button class="confirm-danger" type="button">${escapeHtml(options.confirmLabel ?? "删除")}</button></div>
    </section>
  </div>`);

  const backdrop = document.querySelector<HTMLElement>(".confirm-dialog-backdrop:last-child")!;
  const cancelButton = backdrop.querySelector<HTMLButtonElement>(".confirm-cancel")!;
  const confirmButton = backdrop.querySelector<HTMLButtonElement>(".confirm-danger")!;
  return new Promise((resolve) => {
    const finish = (confirmed: boolean) => {
      document.removeEventListener("keydown", onKeydown);
      backdrop.remove();
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
      resolve(confirmed);
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish(false);
      if (event.key === "Tab") {
        const next = event.shiftKey ? cancelButton : confirmButton;
        const edge = event.shiftKey ? confirmButton : cancelButton;
        if (document.activeElement === edge) { event.preventDefault(); next.focus(); }
      }
    };
    cancelButton.addEventListener("click", () => finish(false));
    confirmButton.addEventListener("click", () => finish(true));
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) finish(false); });
    document.addEventListener("keydown", onKeydown);
    requestAnimationFrame(() => cancelButton.focus());
  });
}

function renderHome(): void {
  root.innerHTML = `<main class="landing-page">
    <header class="landing-header">
      <button class="landing-logo" type="button" data-route="/" aria-label="Missy 首页"><span>✦</span><strong>Missy</strong></button>
      <nav aria-label="主页导航"><a href="#features">功能</a><a href="#how-it-works">使用方式</a></nav>
      <div class="landing-actions"><button class="landing-login" type="button" data-route="/login">登录</button><button class="primary" type="button" data-route="/register">免费开始</button></div>
    </header>
    <section class="landing-hero">
      <div class="hero-copy">
        <p class="hero-badge"><span>✦</span> 你的滴答清单 AI 助手</p>
        <h1>说出想法，<br><em>让计划发生。</em></h1>
        <p class="hero-description">Missy 连接你的滴答清单。用自然语言创建任务、调整日程、查询进度，把琐碎的管理交给 AI。</p>
        <div class="hero-actions"><button class="primary hero-primary" type="button" data-route="/register">开始使用 <span>→</span></button><button class="hero-secondary" type="button" data-route="/login">已有账户，登录</button></div>
        <p class="hero-note"><span>✓</span> 几分钟完成连接&nbsp;&nbsp; <span>✓</span> 你的数据按账户隔离</p>
      </div>
      <div class="hero-visual" aria-label="Missy 对话界面示意图">
        <div class="preview-glow"></div>
        <div class="preview-window">
          <div class="preview-sidebar"><div class="preview-brand"><span>✦</span><b>Missy</b></div><small>最近对话</small><i class="active"></i><i></i><i class="short"></i></div>
          <div class="preview-chat">
            <div class="preview-top"><span>今天的安排</span><i></i></div>
            <div class="preview-messages">
              <div class="preview-date">今天</div>
              <div class="preview-user">帮我安排明天下午写周报，预留 1 小时</div>
              <div class="preview-reply"><span class="mini-mark">✦</span><div><b>已经安排好了</b><p>明天 15:00–16:00 · 写周报</p><small><i>✓</i> 已同步到滴答清单</small></div></div>
            </div>
            <div class="preview-composer">继续告诉 Missy…<b>↑</b></div>
          </div>
        </div>
        <div class="floating-card floating-task"><span>✓</span><div><b>任务已创建</b><small>明天 15:00</small></div></div>
        <div class="floating-card floating-status"><i></i> 滴答清单已连接</div>
      </div>
    </section>
    <section id="features" class="landing-features">
      <div><p class="eyebrow">ONE CONVERSATION, MORE DONE</p><h2>少一点整理，多一点完成</h2></div>
      <div class="feature-grid">
        <article><span>01</span><h3>自然语言管理</h3><p>像聊天一样创建、修改和完成任务，不必在菜单间来回切换。</p></article>
        <article><span>02</span><h3>理解你的日程</h3><p>查询今天、未来一周或指定清单，让下一步始终清晰。</p></article>
        <article id="how-it-works"><span>03</span><h3>安全连接滴答</h3><p>使用你自己的 Token 连接，账户数据彼此隔离，随时可以退出。</p></article>
      </div>
    </section>
    <footer class="landing-footer"><div class="landing-logo"><span>✦</span><strong>Missy</strong></div><p>让每个计划，都有下一步。</p></footer>
  </main>`;
  document.querySelectorAll<HTMLButtonElement>("[data-route]").forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.route!));
  });
}

function renderAuth(mode: "login" | "register" = "login"): void {
  const registering = mode === "register";
  root.innerHTML = `<main class="auth-page">
    <button id="back-home" class="auth-home-link" type="button" aria-label="返回主页"><span>✦</span><strong>Missy</strong></button>
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
  document.querySelector("#back-home")!.addEventListener("click", () => navigate("/"));
  document.querySelector("#switch-auth")!.addEventListener("click", () => navigate(registering ? "/login" : "/register"));
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
    <nav class="history">
      <div class="history-header">
        <p>最近对话</p>
        <button id="new-chat" class="icon-button new-chat-icon" type="button" title="新建对话" aria-label="新建对话"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
      </div>
      <div id="conversation-list"></div>
    </nav>
  </aside>`;
}

function appShellClass(includeDebug = true): string {
  const classes = ["app-shell"];
  if (sidebarCollapsed) classes.push("sidebar-collapsed");
  if (debugEnabled && includeDebug) {
    classes.push("has-debug");
    if (debugPanelCollapsed) classes.push("debug-collapsed");
  }
  return classes.join(" ");
}

function clearDebugTimeline(): void {
  if (!debugEnabled) return;
  debugTimeline.clear();
}

function setDebugPanelCollapsed(collapsed: boolean): void {
  debugPanelCollapsed = collapsed;
  document.querySelector(".app-shell")?.classList.toggle("debug-collapsed", collapsed);
  try { localStorage.setItem(debugPanelStorageKey, String(collapsed)); } catch { /* 状态记忆不可用时仍保留本次交互 */ }
  const toggle = document.querySelector<HTMLButtonElement>("#debug-toggle");
  if (toggle) toggle.textContent = collapsed ? "展开" : "折叠";
  const badge = document.querySelector<HTMLButtonElement>("#chat-debug-badge");
  if (badge) {
    badge.title = collapsed ? "展开调试面板" : "折叠调试面板";
    badge.setAttribute("aria-pressed", String(!collapsed));
  }
}

function renderDebugPane(): string {
  if (!debugEnabled) return "";
  return `<aside class="debug-pane" aria-label="调试面板">
  <header class="debug-header">
    <strong>调试</strong>
    <span class="debug-badge">DEBUG</span>
    <div class="debug-actions">
      <button id="debug-clear" type="button">清空</button>
      <button id="debug-toggle" type="button">${debugPanelCollapsed ? "展开" : "折叠"}</button>
    </div>
  </header>
  <div id="debug-timeline" class="debug-timeline"></div>
</aside>`;
}

function renderDebugPanel(): void {
  const timeline = document.querySelector<HTMLElement>("#debug-timeline");
  if (timeline) {
    timeline.innerHTML = debugTimeline.renderHtml(escapeHtml);
    timeline.scrollTop = timeline.scrollHeight;
  }
  setDebugPanelCollapsed(debugPanelCollapsed);
}

function bindDebugPanel(): void {
  if (!debugEnabled) return;
  document.querySelector("#debug-clear")?.addEventListener("click", () => {
    clearDebugTimeline();
    renderDebugPanel();
  });
  const toggleCollapsed = () => setDebugPanelCollapsed(!debugPanelCollapsed);
  document.querySelector("#debug-toggle")?.addEventListener("click", toggleCollapsed);
  document.querySelector("#chat-debug-badge")?.addEventListener("click", toggleCollapsed);
}

function sidebarEdgeToggle(): string {
  const chevron = sidebarCollapsed
    ? '<path d="m9 6 6 6-6 6"/>'
    : '<path d="m15 6-6 6 6 6"/>';
  return `<button id="sidebar-toggle" class="sidebar-edge-toggle sidebar-toggle" type="button" title="显示或隐藏对话历史" aria-label="显示或隐藏对话历史" aria-pressed="${sidebarCollapsed}"><svg viewBox="0 0 24 24" aria-hidden="true">${chevron}</svg></button>`;
}

function headerSidebarOpen(): string {
  return `<button id="sidebar-open" class="icon-button sidebar-toggle" type="button" title="显示对话历史" aria-label="显示对话历史" aria-expanded="false">☰</button>`;
}

function profileAvatar(): string {
  if (!user) return "";
  return `<button id="profile-button" class="icon-button" type="button" title="账户设置" aria-label="账户设置"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>`;
}

function bindSidebarToggle(): void {
  const buttons = () => document.querySelectorAll<HTMLButtonElement>(".sidebar-toggle");
  const syncEdgeIcon = (collapsed: boolean) => {
    const edge = document.querySelector<HTMLButtonElement>("#sidebar-toggle");
    if (!edge) return;
    edge.setAttribute("aria-pressed", String(collapsed));
    edge.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${collapsed ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6"}"/></svg>`;
  };
  const syncButtons = (collapsed: boolean, mobileOpen?: boolean) => {
    buttons().forEach((button) => {
      button.setAttribute("aria-pressed", String(collapsed));
      if (mobileOpen !== undefined) button.setAttribute("aria-expanded", String(mobileOpen));
    });
    syncEdgeIcon(collapsed);
  };
  const setDesktopCollapsed = (collapsed: boolean) => {
    sidebarCollapsed = collapsed;
    document.querySelector(".app-shell")!.classList.toggle("sidebar-collapsed", collapsed);
    syncButtons(collapsed);
    try { localStorage.setItem(sidebarStorageKey, String(collapsed)); } catch { /* 状态记忆不可用时仍保留本次交互 */ }
  };
  buttons().forEach((button) => {
    button.addEventListener("click", () => {
      const sidebar = document.querySelector(".sidebar")!;
      if (window.matchMedia("(max-width: 760px)").matches) {
        const open = sidebar.classList.toggle("open");
        syncButtons(sidebarCollapsed, open);
        return;
      }
      setDesktopCollapsed(!sidebarCollapsed);
    });
  });
}

function renderApp(): void {
  if (!user) return route();
  root.innerHTML = `<div class="${appShellClass()}">
    ${renderSidebar()}
    ${sidebarEdgeToggle()}
    <main class="chat-pane">
      <header class="chat-header">${headerSidebarOpen()}<div><h2>${escapeHtml(active?.title ?? "新对话")}</h2></div><div class="header-actions">${debugEnabled ? `<button id="chat-debug-badge" class="chat-debug-badge" type="button" title="${debugPanelCollapsed ? "展开调试面板" : "折叠调试面板"}" aria-pressed="${!debugPanelCollapsed}">DEBUG</button>` : ""}${profileAvatar()}</div></header>
      <section id="messages" class="messages">${renderMessages()}</section>
      <div class="composer-wrap">
        ${!user.didaTokenConfigured ? '<button id="configure-token" class="token-banner"><span>!</span><div><strong>连接滴答清单</strong><small>配置 Dida MCP Token 后即可开始对话</small></div><b>去设置 →</b></button>' : ""}
        <form id="composer" class="composer"><textarea id="message-input" maxlength="4000" rows="1" placeholder="给 Missy 发送消息…" ${!user.didaTokenConfigured || pending ? "disabled" : ""}></textarea><button class="send" type="submit" ${!user.didaTokenConfigured || pending ? "disabled" : ""} aria-label="发送">↑</button></form>
        <p class="hint">Enter 发送 · Shift + Enter 换行</p>
      </div>
    </main>${renderDebugPane()}${renderChoiceDialog()}</div>`;
  renderConversationList();
  bindAppEvents();
  if (debugEnabled) renderDebugPanel();
  requestAnimationFrame(() => {
    const messages = document.querySelector<HTMLElement>("#messages");
    if (messages) messages.scrollTop = messages.scrollHeight;
  });
}

function renderMessages(): string {
  if (!turns.length) return `<div class="welcome"><div class="brand-mark">✦</div><h1>今天想安排什么？</h1><p>查询待办、创建任务、调整日程，或者完成你的清单。</p><div class="suggestions"><button>今天有哪些待办？</button><button>创建一个明天下午三点写周报的任务</button><button>列出最近七天已完成的任务</button></div></div>`;
  return turns.map((turn) => {
    const visible = visibleAssistantContent(turn.assistantContent);
    const assistantBody = turn.status === "failed"
      ? `请求失败：${turn.errorMessage ?? "未知错误"}`
      : visible || parseChoicePrompt(turn.assistantContent)?.question || "";
    return `<div class="turn">
    <article class="message user"><div><p>你</p><div class="bubble">${escapeHtml(turn.userContent).replace(/\n/g, "<br>")}</div></div></article>
    <article class="message assistant"><div class="message-content"><p>Missy</p><div class="bubble markdown ${turn.status === "failed" ? "failed" : ""}">${turn.status === "pending" && !turn.assistantContent ? '<span class="typing"><i></i><i></i><i></i></span>' : renderMarkdown(assistantBody)}</div>${turn.status === "succeeded" ? renderFeedback(turn) : ""}</div></article>
  </div>`;
  }).join("");
}

function pendingChoice(): { turn: Turn; prompt: ChoicePrompt } | null {
  const turn = turns.at(-1);
  if (!turn || turn.status !== "succeeded" || turn.id === dismissedChoiceTurnId) return null;
  const prompt = parseChoicePrompt(turn.assistantContent);
  return prompt ? { turn, prompt } : null;
}

function renderChoiceDialog(): string {
  const choice = pendingChoice();
  if (!choice) return "";
  const { turn, prompt } = choice;
  const selectionOptions = prompt.mode === "form" ? renderFormFields(prompt) : renderSelectionOptions(prompt);
  return `<div class="choice-dialog-backdrop" data-choice-turn="${escapeHtml(turn.id)}">
    <section class="choice-dialog" role="dialog" aria-modal="true" aria-labelledby="choice-dialog-title">
      <div class="choice-dialog-header"><div><span class="choice-dialog-kicker">帮我确认一下</span><h3 id="choice-dialog-title">${escapeHtml(prompt.question)}</h3></div><button class="choice-dialog-close" type="button" aria-label="关闭，改为手动输入">×</button></div>
      <form id="choice-form" data-mode="${prompt.mode}">
        ${selectionOptions}
        ${prompt.allowOther ? '<label class="choice-other"><span>其他（可选）</span><input name="other" maxlength="240" placeholder="补充你的情况…"></label>' : ""}
        <div class="choice-dialog-actions"><button class="choice-skip" type="button">我自己输入</button><button class="primary choice-submit" type="submit" disabled>${escapeHtml(prompt.submitLabel)}</button></div>
      </form>
    </section>
  </div>`;
}

function renderSelectionOptions(prompt: ChoicePrompt): string {
  const inputType = prompt.mode === "single" ? "radio" : "checkbox";
  return `<div class="choice-options">${prompt.options.map((option, index) => `<label class="choice-option"><input type="${inputType}" name="choice" value="${index}"><span class="choice-control" aria-hidden="true"></span><span><strong>${escapeHtml(option.label)}</strong>${option.description ? `<small>${escapeHtml(option.description)}</small>` : ""}</span></label>`).join("")}</div>`;
}

function renderFormFields(prompt: ChoicePrompt): string {
  return `<div class="choice-fields">${prompt.fields.map((field) => {
    const name = `field:${field.id}`;
    if (field.type === "single" || field.type === "multiple") {
      const inputType = field.type === "single" ? "radio" : "checkbox";
      return `<fieldset class="choice-field" data-field-id="${escapeHtml(field.id)}" data-required="${field.required}"><legend>${escapeHtml(field.label)}${field.required ? " *" : ""}</legend><div class="choice-field-options">${field.options!.map((option, index) => `<label><input type="${inputType}" name="${escapeHtml(name)}" value="${index}"><span>${escapeHtml(option.label)}</span></label>`).join("")}</div></fieldset>`;
    }
    const attributes = `${field.required ? " required" : ""}${field.min !== undefined ? ` min="${field.min}"` : ""}${field.max !== undefined ? ` max="${field.max}"` : ""}`;
    return `<label class="choice-field choice-field-input" data-field-id="${escapeHtml(field.id)}" data-required="${field.required}"><span>${escapeHtml(field.label)}${field.required ? " *" : ""}</span><span class="choice-input-wrap"><input type="${field.type}" name="${escapeHtml(name)}" maxlength="240" placeholder="${escapeHtml(field.placeholder ?? "请输入")}"${attributes}>${field.unit ? `<b>${escapeHtml(field.unit)}</b>` : ""}</span></label>`;
  }).join("")}</div>`;
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
  list.innerHTML = conversations.length ? conversations.map((conversation) => `<button class="conversation-item ${active?.id === conversation.id ? "active" : ""}" data-id="${conversation.id}"><span>${escapeHtml(conversation.title)}</span></button>`).join("") : '<p class="empty-list">还没有历史对话</p>';
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
  bindDebugPanel();
  document.querySelectorAll<HTMLButtonElement>(".suggestions button").forEach((button) => button.addEventListener("click", () => void sendMessage(button.textContent ?? "")));
  document.querySelectorAll<HTMLButtonElement>(".feedback-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const turnId = button.dataset.turnId;
      const feedback = button.dataset.feedback as "like" | "dislike" | undefined;
      if (turnId && feedback) void setTurnFeedback(turnId, feedback);
    });
  });
  bindChoiceDialog();
  const form = document.querySelector<HTMLFormElement>("#composer")!;
  const input = document.querySelector<HTMLTextAreaElement>("#message-input")!;
  form.addEventListener("submit", (event) => { event.preventDefault(); const message = input.value.trim(); if (message) { input.value = ""; void sendMessage(message); } });
  input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } });
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 160)}px`; });
}

function bindChoiceDialog(): void {
  const choice = pendingChoice();
  const form = document.querySelector<HTMLFormElement>("#choice-form");
  if (!choice || !form) return;
  const submit = form.querySelector<HTMLButtonElement>(".choice-submit")!;
  const other = form.elements.namedItem("other") as HTMLInputElement | null;
  const selectedInputs = () => Array.from(form.querySelectorAll<HTMLInputElement>('input[name="choice"]:checked'));
  const formComplete = () => choice.prompt.fields.every((field) => {
    if (!field.required) return true;
    const inputs = Array.from(form.querySelectorAll<HTMLInputElement>(`[name="field:${CSS.escape(field.id)}"]`));
    return field.type === "single" || field.type === "multiple" ? inputs.some((input) => input.checked) : Boolean(inputs[0]?.value.trim());
  });
  const sync = () => {
    submit.disabled = choice.prompt.mode === "form"
      ? !formComplete()
      : selectedInputs().length === 0 && !other?.value.trim();
  };
  form.addEventListener("change", sync);
  other?.addEventListener("input", sync);
  form.querySelectorAll("input").forEach((input) => input.addEventListener("input", sync));
  sync();
  let onKeydown: (event: KeyboardEvent) => void;
  const dismiss = () => {
    document.removeEventListener("keydown", onKeydown);
    dismissedChoiceTurnId = choice.turn.id;
    document.querySelector(".choice-dialog-backdrop")?.remove();
    document.querySelector<HTMLTextAreaElement>("#message-input")?.focus();
  };
  document.querySelector(".choice-dialog-close")?.addEventListener("click", dismiss);
  document.querySelector(".choice-skip")?.addEventListener("click", dismiss);
  onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      dismiss();
    }
  };
  document.addEventListener("keydown", onKeydown);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (choice.prompt.mode === "form") {
      if (!formComplete() || !form.reportValidity()) return;
      const answers = choice.prompt.fields.flatMap((field) => {
        const inputs = Array.from(form.querySelectorAll<HTMLInputElement>(`[name="field:${CSS.escape(field.id)}"]`));
        const values = field.type === "single" || field.type === "multiple"
          ? inputs.filter((input) => input.checked).map((input) => field.options?.[Number(input.value)]?.label).filter(Boolean)
          : [inputs[0]?.value.trim()].filter(Boolean);
        return values.length ? [`${field.label}：${values.join("、")}${field.unit && field.type === "number" ? ` ${field.unit}` : ""}`] : [];
      });
      dismiss();
      void sendMessage(`我的信息：${answers.join("；")}`);
      return;
    }
    const labels = selectedInputs().map((input) => choice.prompt.options[Number(input.value)]?.label).filter(Boolean);
    const custom = other?.value.trim();
    if (!labels.length && !custom) return;
    const parts = labels.length ? [`我的选择：${labels.join("、")}`] : [];
    if (custom) parts.push(`补充：${custom}`);
    dismiss();
    void sendMessage(parts.join("；"));
  });
}

async function loadConversations(): Promise<void> {
  const result = await api<{ conversations: Conversation[] }>("/v1/conversations");
  conversations = result.conversations;
}

async function createConversation(): Promise<void> {
  try {
    const result = await api<{ conversation: Conversation }>("/v1/conversations", { method: "POST", body: "{}" });
    conversations.unshift(result.conversation); active = result.conversation; turns = []; clearDebugTimeline(); renderApp();
  } catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
}

async function openConversation(id: string): Promise<void> {
  try {
    const result = await api<{ conversation: Conversation; turns: Turn[] }>(`/v1/conversations/${id}`);
    active = result.conversation; turns = result.turns;
    clearDebugTimeline();
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
    await streamApi(`/v1/conversations/${conversationId}/messages`, { message, allowDelete: false, ...(debugEnabled ? { debug: true } : {}) }, (event) => {
      if (event.type === "start") {
        clearDebugTimeline();
        renderDebugPanel();
        Object.assign(optimistic, event.turn);
      } else if (event.type === "delta") {
        optimistic.assistantContent = (event.reset ? "" : optimistic.assistantContent ?? "") + event.delta;
        const bubble = document.querySelector<HTMLElement>(".turn:last-child .message.assistant .bubble");
        if (bubble) bubble.innerHTML = renderMarkdown(visibleAssistantContent(optimistic.assistantContent));
        const messages = document.querySelector<HTMLElement>("#messages");
        if (messages) messages.scrollTop = messages.scrollHeight;
      } else if (event.type === "done") {
        turns[turns.length - 1] = event.turn;
      } else if (event.type === "debug") {
        debugTimeline.append(event.event);
        renderDebugPanel();
      } else if (event.type === "error") {
        if (debugEnabled) {
          debugTimeline.setError({
            code: event.error.code ?? "unknown",
            message: event.error.message ?? "请求失败。",
            stack: event.error.stack,
            cause: event.error.cause,
          });
          renderDebugPanel();
        }
        throw new Error(event.error.message || "请求失败。");
      }
    });
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
  if (!conversation) return;
  const confirmed = await showConfirmDialog({
    title: "删除这个对话？",
    message: `“${conversation.title}”及其中的全部记录将被永久删除，此操作无法撤销。`,
  });
  if (!confirmed) return;
  try {
    await api<void>(`/v1/conversations/${id}`, { method: "DELETE" });
    if (active?.id === id) { active = null; turns = []; clearDebugTimeline(); }
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
      <form id="profile-form" class="settings-section profile-settings" novalidate>
        <div class="section-heading"><span class="section-icon">${icon("M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z")}</span><div><h3>个人资料</h3><p>管理你的公开名称和登录邮箱</p></div></div>
        <div class="settings-fields"><label>显示名称<input name="displayName" value="${escapeHtml(user.displayName)}" maxlength="80" autocomplete="name"></label><label>邮箱地址<input name="email" type="email" value="${escapeHtml(user.email)}" autocomplete="email"></label></div>
        <div class="section-actions"><button class="primary compact" type="submit">保存更改</button></div>
      </form>
      <form id="password-form" class="settings-section password-settings" novalidate>
        <div class="section-heading"><span class="section-icon">${icon("M7 10V7a5 5 0 0 1 10 0v3M6 10h12a2 2 0 0 1 2 2v8H4v-8a2 2 0 0 1 2-2Zm6 4v3")}</span><div><h3>登录安全</h3><p>定期更新密码，保护账户安全</p></div></div>
        <div class="settings-fields"><label>当前密码<input name="currentPassword" type="password" autocomplete="current-password" placeholder="输入当前密码"></label><label>新密码<input name="newPassword" type="password" autocomplete="new-password" placeholder="至少 8 位字符"></label></div>
        <div class="section-actions"><button class="secondary compact" type="submit">更新密码</button></div>
      </form>
      <form id="token-form" class="settings-section token-settings" novalidate>
        <div class="section-heading"><span class="section-icon token-icon">${icon("M15 7a4 4 0 1 0-3.7 5.5L3 20.8V22h3l1.5-1.5L9 22l2-2-1.5-1.5 4.2-4.2A4 4 0 0 0 15 7Z")}</span><div><div class="heading-line"><h3>Dida MCP Token</h3><span class="token-status ${user.didaTokenConfigured ? "ok" : ""}"><i></i>${user.didaTokenConfigured ? "已连接" : "未配置"}</span></div><p>连接滴答清单，让 Missy 可以安全地管理你的任务</p></div></div>
        <div class="token-body">
          <label>${user.didaTokenConfigured ? "" : "添加 Token"}<span class="token-input-wrap"><input name="token" type="password" placeholder="粘贴 Dida MCP Token" autocomplete="off"><small>${user.didaTokenConfigured ? escapeHtml(user.didaTokenHint) : "安全加密保存"}</small></span></label>
          <button class="primary compact" type="submit">验证并保存</button>
        </div>
        <p class="privacy-note">${icon("M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z")}<span>Token 按账户独立保存，任何接口都不会返回完整内容。<br>获取方式：滴答清单 → <a href="https://dida365.com/webapp/#q/all/tasks?modalType=settings" target="_blank" rel="noopener noreferrer">设置</a> → 账户与安全 → API 口令 → 管理。</span></p>
      </form>
      <section class="settings-section conversation-actions">
        <div><h3>历史会话</h3><p>将全部历史会话从你的会话列表中隐藏。此操作无法撤销。</p></div>
        <button id="clear-conversations" class="danger-button compact" type="button">清除历史会话</button>
      </section>
      <section class="settings-section account-actions">
        <div><h3>账户操作</h3><p>退出当前设备，或永久删除账户及所有数据。</p></div>
        <div><button id="logout" class="text-button" type="button">退出登录</button><button id="delete-account" class="danger-button compact" type="button">注销账户</button></div>
      </section>
    </div>`;
}

function renderSettingsPage(): void {
  if (!user) return route();
  root.innerHTML = `<div class="${appShellClass(false)}">
    ${renderSidebar()}
    ${sidebarEdgeToggle()}
    <main class="settings-pane">
      <header class="settings-header">${headerSidebarOpen()}<div class="header-actions"><button id="back-to-chat" class="back-link" type="button" title="关闭设置" aria-label="关闭设置"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div></header>
      <div class="settings-content"><div class="settings-intro"><p class="eyebrow">ACCOUNT SETTINGS</p><h1>账户设置</h1><p>管理你的个人资料、服务连接与账户安全。</p></div>${renderSettingsContent()}</div>
    </main></div>`;
  renderConversationList();
  bindSettingsPageEvents();
}

function bindSettingsPageEvents(): void {
  hideContextMenu();
  document.querySelector("#new-chat")!.addEventListener("click", () => { navigate("/"); void createConversation(); });
  bindSidebarToggle();
  document.querySelector("#back-to-chat")!.addEventListener("click", () => navigate("/"));
  bindSettingsForms();
}

function bindSettingsForms(): void {
  const fieldValue = (form: HTMLFormElement, name: string) => String(new FormData(form).get(name) ?? "").trim();
  const focusField = (form: HTMLFormElement, name: string) => form.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.focus();
  const submit = (selector: string, url: string, method: string, onSuccess: (result: unknown) => void, validate?: (form: HTMLFormElement) => string | null) =>
    document.querySelector<HTMLFormElement>(selector)!.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const validationError = validate?.(form);
      if (validationError) {
        showToast(validationError, true);
        return;
      }
      const button = form.querySelector<HTMLButtonElement>("button[type=submit], button:not([type])")!;
      button.disabled = true;
      try {
        const result = await api<unknown>(url, { method, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
        onSuccess(result);
        showToast("保存成功");
      } catch (error) {
        showToast(error instanceof Error ? error.message : String(error), true);
      } finally {
        button.disabled = false;
      }
    });

  submit("#profile-form", "/v1/me", "PATCH", (result) => { user = (result as { user: User }).user; renderSettingsPage(); }, (form) => {
    if (!fieldValue(form, "displayName")) { focusField(form, "displayName"); return "请填写显示名称"; }
    const email = fieldValue(form, "email");
    if (!email) { focusField(form, "email"); return "请填写邮箱地址"; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { focusField(form, "email"); return "请输入有效的邮箱地址"; }
    return null;
  });
  submit("#token-form", "/v1/me/dida-token", "PUT", (result) => { user = (result as { user: User }).user; renderSettingsPage(); }, (form) => {
    const token = fieldValue(form, "token");
    if (!token) { focusField(form, "token"); return "请先粘贴 Dida MCP Token"; }
    if (token.length < 8) { focusField(form, "token"); return "Token 长度至少 8 位"; }
    return null;
  });
  submit("#password-form", "/v1/me/password", "PUT", () => { (document.querySelector("#password-form") as HTMLFormElement).reset(); }, (form) => {
    if (!fieldValue(form, "currentPassword")) { focusField(form, "currentPassword"); return "请填写当前密码"; }
    const next = fieldValue(form, "newPassword");
    if (!next) { focusField(form, "newPassword"); return "请填写新密码"; }
    if (next.length < 8) { focusField(form, "newPassword"); return "新密码至少 8 位"; }
    return null;
  });
  document.querySelector("#clear-conversations")!.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const confirmed = await showConfirmDialog({
      title: "清除全部历史会话？",
      message: "所有历史会话都将从会话列表中移除，此操作无法撤销。",
      confirmLabel: "全部清除",
    });
    if (!confirmed) return;
    button.disabled = true;
    try {
      await api<void>("/v1/conversations", { method: "DELETE" });
      conversations = []; active = null; turns = []; clearDebugTimeline();
      renderSettingsPage();
      showToast("历史会话已清除");
    } catch (error) {
      button.disabled = false;
      showToast(error instanceof Error ? error.message : String(error), true);
    }
  });
  document.querySelector("#logout")!.addEventListener("click", async () => {
    await api<void>("/v1/auth/logout", { method: "POST" });
    user = null; conversations = []; active = null; turns = [];
    history.replaceState(null, "", "/");
    renderHome();
  });
  document.querySelector("#delete-account")!.addEventListener("click", async () => {
    const password = prompt("注销会永久删除所有会话。请输入当前密码确认："); if (!password) return;
    try {
      await api<void>("/v1/me", { method: "DELETE", body: JSON.stringify({ password }) });
      user = null; conversations = []; active = null; turns = [];
      history.replaceState(null, "", "/");
      renderHome();
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
    route();
  }
}

void bootstrap();
