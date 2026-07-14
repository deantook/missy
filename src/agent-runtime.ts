import { createHash } from "node:crypto";
import type { NamedTool } from "./agent.ts";
import { createTaskAgent } from "./agent.ts";
import { lastAssistantText, latestCreatedProjectId, needsStructuredClarification, projectCreationNeedsVerification, resolveInterruptsWith, type AgentResult } from "./conversation.ts";
import {
  debugEventsFromStreamMessage,
  type DebugEvent,
} from "./debug-events.ts";
import { connectDida365Mcp, closeMcp, type McpHandle } from "./mcp.ts";
import { UsageCollector, type TokenUsage } from "./usage.ts";

type CacheEntry = { handle: McpHandle; fingerprint: string; lastUsed: number };

export type DebugSink = (event: DebugEvent) => void | Promise<void>;

export class UserMcpManager {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly model: string, private readonly url: string, private readonly idleMs = 15 * 60_000) {
    this.timer = setInterval(() => void this.evictIdle(), Math.min(idleMs, 60_000));
    this.timer.unref();
  }

  private fingerprint(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  async toolsFor(userId: string, token: string, onDebug?: DebugSink): Promise<readonly NamedTool[]> {
    const fingerprint = this.fingerprint(token);
    const cached = this.cache.get(userId);
    if (cached?.fingerprint === fingerprint) {
      cached.lastUsed = Date.now();
      await onDebug?.({ kind: "mcp", action: "cache_hit" });
      return cached.handle.tools;
    }
    if (cached) await this.invalidate(userId, onDebug);
    await onDebug?.({ kind: "phase", phase: "mcp_connect", status: "start" });
    try {
      const handle = await connectDida365Mcp({ model: this.model, dida365McpUrl: this.url, dida365Token: token });
      this.cache.set(userId, { handle, fingerprint, lastUsed: Date.now() });
      await onDebug?.({ kind: "mcp", action: "connect" });
      await onDebug?.({ kind: "phase", phase: "mcp_connect", status: "done" });
      return handle.tools;
    } catch (error) {
      await onDebug?.({
        kind: "phase",
        phase: "mcp_connect",
        status: "error",
        detail: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async validate(token: string): Promise<void> {
    const handle = await connectDida365Mcp({ model: this.model, dida365McpUrl: this.url, dida365Token: token });
    await closeMcp(handle);
  }

  async invalidate(userId: string, onDebug?: DebugSink): Promise<void> {
    const entry = this.cache.get(userId);
    this.cache.delete(userId);
    if (entry) {
      await onDebug?.({ kind: "mcp", action: "invalidate" });
      await closeMcp(entry.handle).catch(() => undefined);
    }
  }

  private async evictIdle(): Promise<void> {
    const cutoff = Date.now() - this.idleMs;
    await Promise.all([...this.cache].filter(([, value]) => value.lastUsed < cutoff).map(([id]) => this.invalidate(id)));
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    await Promise.all([...this.cache.keys()].map((id) => this.invalidate(id)));
  }
}

export class AgentRunError extends Error {
  constructor(message: string, readonly usage: TokenUsage, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AgentRunError";
  }
}

export type StoredMessage = { role: "user" | "assistant"; content: string };

export async function runAgentTurn(params: {
  model: string;
  tools: readonly NamedTool[];
  history: StoredMessage[];
  message: string;
  conversationId: string;
  allowDelete: boolean;
  signal?: AbortSignal;
  onToken?: (token: string, reset?: boolean) => void | Promise<void>;
  onDebug?: DebugSink;
}): Promise<{ message: string; usage: TokenUsage }> {
  const collector = new UsageCollector();
  try {
    const { agent } = createTaskAgent({ model: params.model, tools: params.tools });
    const config = { configurable: { thread_id: params.conversationId }, callbacks: [collector.callback] };
    let streamedMessageId: string | undefined;
    const stream = async (input: unknown): Promise<AgentResult> => {
      const events = await agent.stream(input as never, {
        ...config,
        signal: params.signal,
        streamMode: ["messages", "values"],
      } as never);
      let latest: AgentResult | undefined;
      for await (const rawEvent of events) {
        const [mode, payload] = rawEvent as unknown as [string, unknown];
        if (mode === "values") {
          latest = payload as AgentResult;
          continue;
        }
        if (mode !== "messages" || !Array.isArray(payload)) continue;
        const message = payload[0] as {
          id?: string;
          content?: unknown;
          additional_kwargs?: Record<string, unknown>;
          tool_calls?: Array<{ id?: string; name?: string; args?: unknown }>;
          name?: string;
          tool_call_id?: string;
          status?: string;
          getType?: () => string;
        };
        for (const event of debugEventsFromStreamMessage(message)) {
          await params.onDebug?.(event);
        }
        if (params.onToken && message.getType?.() === "ai") {
          const token = textContent(message.content);
          if (token) {
            const reset = streamedMessageId !== undefined && message.id !== streamedMessageId;
            streamedMessageId = message.id;
            await params.onToken(token, reset);
          }
        }
      }
      if (!latest) throw new Error("模型流已结束，但没有返回最终状态。");
      return latest;
    };
    await params.onDebug?.({ kind: "phase", phase: "agent_run", status: "start" });
    let result = await stream({ messages: [...params.history, { role: "user" as const, content: params.message }] });
    await params.onDebug?.({ kind: "phase", phase: "interrupt", status: "start" });
    result = await resolveInterruptsWith(
      result,
      async () => params.allowDelete ? "approve" : "reject",
      (command) => stream(command),
    );
    await params.onDebug?.({ kind: "phase", phase: "interrupt", status: "done" });
    let didVerify = false;
    for (let attempt = 0; attempt < 2 && projectCreationNeedsVerification(result); attempt += 1) {
      didVerify = true;
      await params.onDebug?.({ kind: "note", message: "清单创建回查校验重试" });
      await params.onDebug?.({ kind: "phase", phase: "verify", status: "start" });
      const projectId = latestCreatedProjectId(result);
      const projectHint = projectId
        ? `刚才 create_project 返回的真实清单 ID 是 ${JSON.stringify(projectId)}。`
        : "请从此前 create_project 的工具结果读取真实清单 ID。";
      result = await stream({ messages: [{
        role: "user" as const,
        content: `系统一致性检查：清单创建后的任务写入与回查流程尚未完整通过。不要重复创建清单，也不要向用户提问。${projectHint} 写任务时把该值传给 projectId（驼峰）；调用 get_project_with_undone_tasks 回查时必须把同一个值传给 project_id（下划线），不得传 projectId，也不得留空。如果任务尚未成功写入，立即用 batch_add_tasks（或 create_task）写入刚才承诺的全部任务；然后回查。只有回查确认任务存在后才能报告成功。`,
      }] });
    }
    if (didVerify) {
      await params.onDebug?.({ kind: "phase", phase: "verify", status: "done" });
    }
    if (projectCreationNeedsVerification(result)) {
      throw new Error("清单任务写入或回查验证未完成；系统已阻止返回错误的成功结果，请重试。");
    }
    for (let attempt = 0; attempt < 2 && needsStructuredClarification(lastAssistantText(result)); attempt += 1) {
      await params.onDebug?.({ kind: "note", message: "choice_prompt 重写" });
      result = await stream({ messages: [{
        role: "user" as const,
        content: "系统界面一致性检查：上一条回复正在向用户提问，但没有输出可渲染的 choice_prompt。请立即重写上一条回复，不要回答问题本身，也不要输出普通文本问题。互斥选项使用 single，可多选使用 multiple；身高、体重、年龄等需要自由输入或一次收集多个信息时必须使用 form fields。严格按照系统提示中的 JSON 协议输出。",
      }] });
    }
    if (needsStructuredClarification(lastAssistantText(result))) {
      throw new Error("模型未返回可渲染的提问表单；系统已阻止显示普通文本问题，请重试。");
    }
    await params.onDebug?.({ kind: "phase", phase: "agent_run", status: "done" });
    return { message: lastAssistantText(result), usage: collector.value() };
  } catch (error) {
    throw new AgentRunError(
      error instanceof Error ? error.message : String(error),
      collector.value(),
      { cause: error },
    );
  }
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (part && typeof part === "object") {
      const record = part as Record<string, unknown>;
      if (record.type === "reasoning" || record.type === "thinking") return "";
      if ("text" in part) return String((part as { text: unknown }).text);
    }
    return "";
  }).join("");
}
