import { apiUrl, authHeaders, triggerUnauthorized } from "./client.ts";
import type { StreamEvent } from "../types.ts";

export async function streamApi(url: string, body: unknown, onEvent: (event: StreamEvent) => void, signal?: AbortSignal): Promise<void> {
  const response = await fetch(apiUrl(url), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json", Accept: "application/x-ndjson" }),
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: { message?: string; code?: string } };
    if (response.status === 401 && (data.error?.code === "UNAUTHORIZED" || !data.error?.code)) {
      triggerUnauthorized();
    }
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
