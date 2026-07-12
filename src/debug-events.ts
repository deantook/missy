export type DebugEvent =
  | {
      kind: "phase";
      phase: "mcp_connect" | "agent_run" | "interrupt" | "verify";
      status: "start" | "done" | "error";
      detail?: string;
    }
  | { kind: "thinking"; delta: string }
  | { kind: "tool_call"; name: string; args?: unknown; id?: string }
  | { kind: "tool_result"; name: string; ok: boolean; preview: string; id?: string }
  | { kind: "mcp"; action: "cache_hit" | "connect" | "invalidate"; detail?: string }
  | { kind: "note"; message: string };

const PREVIEW_LIMIT = 2048;

export function previewText(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  if (text.length <= PREVIEW_LIMIT) return text;
  return `${text.slice(0, PREVIEW_LIMIT)}…`;
}

export function serializeDebugError(
  error: unknown,
  code: string,
  debug: boolean,
): { code: string; message: string; stack?: string; cause?: string } {
  const err = error instanceof Error ? error : new Error(String(error));
  const payload: { code: string; message: string; stack?: string; cause?: string } = {
    code,
    message: err.message || "请求失败。",
  };
  if (!debug) return payload;
  if (err.stack) payload.stack = err.stack;
  if (err.cause !== undefined) {
    payload.cause = err.cause instanceof Error
      ? (err.cause.stack ?? err.cause.message)
      : String(err.cause);
  }
  return payload;
}

type StreamMessage = {
  getType?: () => string;
  content?: unknown;
  additional_kwargs?: Record<string, unknown>;
  tool_calls?: Array<{ id?: string; name?: string; args?: unknown }>;
  name?: string;
  tool_call_id?: string;
  status?: string;
};

function thinkingFromContent(content: unknown): string {
  if (typeof content === "string") return "";
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (!part || typeof part !== "object") return "";
    const record = part as Record<string, unknown>;
    if (record.type === "reasoning" || record.type === "thinking" || record.type === "reasoning_content") {
      return String(record.reasoning ?? record.thinking ?? record.reasoning_content ?? record.text ?? "");
    }
    return "";
  }).join("");
}

function thinkingFromAdditionalKwargs(kwargs: Record<string, unknown> | undefined): string {
  if (!kwargs) return "";
  const value = kwargs.reasoning_content ?? kwargs.reasoning;
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function thinkingDelta(message: StreamMessage): string {
  return thinkingFromContent(message.content) || thinkingFromAdditionalKwargs(message.additional_kwargs);
}

export function debugEventsFromStreamMessage(message: StreamMessage): DebugEvent[] {
  const type = message.getType?.();
  const events: DebugEvent[] = [];
  if (type === "ai") {
    const delta = thinkingDelta(message);
    if (delta) events.push({ kind: "thinking", delta });
    for (const call of message.tool_calls ?? []) {
      if (!call.name) continue;
      events.push({ kind: "tool_call", name: call.name, args: call.args, id: call.id });
    }
  }
  if (type === "tool") {
    const name = message.name ?? "tool";
    events.push({
      kind: "tool_result",
      name,
      ok: message.status !== "error",
      preview: previewText(message.content ?? ""),
      id: message.tool_call_id,
    });
  }
  return events;
}
