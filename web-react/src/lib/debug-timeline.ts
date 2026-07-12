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
}

export const isDebugBuild = (): boolean => {
  try {
    return import.meta.env?.VITE_DEBUG === "true";
  } catch {
    return false;
  }
};
