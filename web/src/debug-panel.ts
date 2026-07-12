export type ClientDebugEvent =
  | { kind: "phase"; phase: string; status: string; detail?: string }
  | { kind: "thinking"; delta: string }
  | { kind: "tool_call"; name: string; args?: unknown; id?: string }
  | { kind: "tool_result"; name: string; ok: boolean; preview: string; id?: string }
  | { kind: "mcp"; action: string; detail?: string }
  | { kind: "note"; message: string };

export type TimelineEntry =
  | { kind: "phase"; phase: string; status: string; detail?: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_call"; name: string; args?: unknown; id?: string }
  | { kind: "tool_result"; name: string; ok: boolean; preview: string; id?: string }
  | { kind: "mcp"; action: string; detail?: string }
  | { kind: "note"; message: string };

export type DebugError = { code: string; message: string; stack?: string; cause?: string };

export class DebugTimeline {
  entries: TimelineEntry[] = [];
  error: DebugError | null = null;

  clear(): void {
    this.entries = [];
    this.error = null;
  }

  append(event: ClientDebugEvent): void {
    if (event.kind === "thinking") {
      const last = this.entries.at(-1);
      if (last?.kind === "thinking") {
        last.text += event.delta;
        return;
      }
      this.entries.push({ kind: "thinking", text: event.delta });
      return;
    }
    this.entries.push(event);
  }

  setError(error: DebugError): void {
    this.error = error;
  }

  renderHtml(escapeHtml: (value: unknown) => string): string {
    const errorBlock = this.error
      ? `<div class="debug-error"><div class="debug-tag">error</div><pre>${escapeHtml(this.error.message)}
code: ${escapeHtml(this.error.code)}
${this.error.cause ? `cause:\n${escapeHtml(this.error.cause)}\n` : ""}${this.error.stack ? `stack:\n${escapeHtml(this.error.stack)}` : ""}</pre></div>`
      : "";
    const items = this.entries.map((entry) => {
      if (entry.kind === "thinking") {
        return `<div class="debug-item thinking"><div class="debug-tag">thinking</div><pre>${escapeHtml(entry.text)}</pre></div>`;
      }
      if (entry.kind === "tool_call") {
        return `<div class="debug-item tool"><div class="debug-tag">tool_call</div><strong>${escapeHtml(entry.name)}</strong><pre>${escapeHtml(JSON.stringify(entry.args ?? {}, null, 2))}</pre></div>`;
      }
      if (entry.kind === "tool_result") {
        return `<div class="debug-item tool ${entry.ok ? "ok" : "bad"}"><div class="debug-tag">tool_result</div><strong>${escapeHtml(entry.name)}</strong><pre>${escapeHtml(entry.preview)}</pre></div>`;
      }
      if (entry.kind === "mcp") {
        return `<div class="debug-item mcp"><div class="debug-tag">mcp</div><span>${escapeHtml(entry.action)}${entry.detail ? ` · ${escapeHtml(entry.detail)}` : ""}</span></div>`;
      }
      if (entry.kind === "phase") {
        return `<div class="debug-item phase"><div class="debug-tag">phase</div><span>${escapeHtml(entry.phase)} · ${escapeHtml(entry.status)}${entry.detail ? ` · ${escapeHtml(entry.detail)}` : ""}</span></div>`;
      }
      return `<div class="debug-item note"><div class="debug-tag">note</div><span>${escapeHtml(entry.message)}</span></div>`;
    }).join("");
    return `${errorBlock}${items || '<p class="debug-empty">等待本轮调试事件…</p>'}`;
  }
}

export const isDebugBuild = (): boolean => {
  try {
    return import.meta.env?.VITE_DEBUG === "true";
  } catch {
    return false;
  }
};
