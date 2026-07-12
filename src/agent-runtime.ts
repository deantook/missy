import { createHash } from "node:crypto";
import type { NamedTool } from "./agent.ts";
import { createTaskAgent } from "./agent.ts";
import { lastAssistantText, resolveInterrupts } from "./conversation.ts";
import { connectDida365Mcp, closeMcp, type McpHandle } from "./mcp.ts";
import { UsageCollector, type TokenUsage } from "./usage.ts";

type CacheEntry = { handle: McpHandle; fingerprint: string; lastUsed: number };

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

  async toolsFor(userId: string, token: string): Promise<readonly NamedTool[]> {
    const fingerprint = this.fingerprint(token);
    const cached = this.cache.get(userId);
    if (cached?.fingerprint === fingerprint) {
      cached.lastUsed = Date.now();
      return cached.handle.tools;
    }
    if (cached) await this.invalidate(userId);
    const handle = await connectDida365Mcp({ model: this.model, dida365McpUrl: this.url, dida365Token: token });
    this.cache.set(userId, { handle, fingerprint, lastUsed: Date.now() });
    return handle.tools;
  }

  async validate(token: string): Promise<void> {
    const handle = await connectDida365Mcp({ model: this.model, dida365McpUrl: this.url, dida365Token: token });
    await closeMcp(handle);
  }

  async invalidate(userId: string): Promise<void> {
    const entry = this.cache.get(userId);
    this.cache.delete(userId);
    if (entry) await closeMcp(entry.handle).catch(() => undefined);
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
  constructor(message: string, readonly usage: TokenUsage) {
    super(message);
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
}): Promise<{ message: string; usage: TokenUsage }> {
  const collector = new UsageCollector();
  try {
    const { agent } = createTaskAgent({ model: params.model, tools: params.tools });
    const config = { configurable: { thread_id: params.conversationId }, callbacks: [collector.callback] };
    let result = await agent.invoke({ messages: [...params.history, { role: "user" as const, content: params.message }] }, config);
    result = await resolveInterrupts(agent, result, config, async () => params.allowDelete ? "approve" : "reject");
    return { message: lastAssistantText(result), usage: collector.value() };
  } catch (error) {
    throw new AgentRunError(error instanceof Error ? error.message : String(error), collector.value());
  }
}
