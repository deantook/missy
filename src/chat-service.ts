import type { Database } from "./db.ts";
import { AgentRunError, runAgentTurn, type DebugSink, type StoredMessage, type UserMcpManager } from "./agent-runtime.ts";
import type { TokenUsage } from "./usage.ts";

export type RunTurn = typeof runAgentTurn;

type PendingTurn = {
  id: string;
  userContent: string;
  assistantContent: null;
  status: "pending";
  feedback: null;
  usage: TokenUsage;
  createdAt: string;
};

type StreamCallbacks = {
  onStart?: (turn: PendingTurn) => void | Promise<void>;
  onDelta?: (delta: string, reset?: boolean) => void | Promise<void>;
  onDebug?: DebugSink;
};

export class ChatService {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly database: Database,
    private readonly model: string,
    private readonly mcp: UserMcpManager,
    private readonly runner: RunTurn = runAgentTurn,
  ) {}

  async send(params: { userId: string; didaToken: string; conversationId: string; message: string; allowDelete: boolean } & StreamCallbacks) {
    const previous = this.queues.get(params.conversationId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.catch(() => undefined).then(() => gate);
    this.queues.set(params.conversationId, queued);
    await previous.catch(() => undefined);
    try {
      return await this.execute(params);
    } finally {
      release();
      if (this.queues.get(params.conversationId) === queued) this.queues.delete(params.conversationId);
    }
  }

  private async execute(params: { userId: string; didaToken: string; conversationId: string; message: string; allowDelete: boolean } & StreamCallbacks) {
    const conversation = await this.database.query("SELECT id FROM conversations WHERE id = $1 AND user_id = $2 AND hidden_at IS NULL", [params.conversationId, params.userId]);
    if (!conversation.rowCount) throw Object.assign(new Error("会话不存在。"), { status: 404, code: "NOT_FOUND" });
    const turn = await this.database.query<{ id: string; created_at: string }>("INSERT INTO chat_turns(conversation_id, user_content) VALUES ($1, $2) RETURNING id, created_at", [params.conversationId, params.message]);
    const turnId = turn.rows[0]!.id;
    let usage: TokenUsage = { inputTokens: null, outputTokens: null, totalTokens: null };
    try {
      await params.onStart?.({
        id: turnId, userContent: params.message, assistantContent: null, status: "pending",
        feedback: null, usage, createdAt: new Date(turn.rows[0]!.created_at).toISOString(),
      });
      const rows = await this.database.query<{ user_content: string; assistant_content: string }>(`SELECT user_content, assistant_content FROM chat_turns
        WHERE conversation_id = $1 AND status = 'succeeded' ORDER BY created_at, id`, [params.conversationId]);
      const history: StoredMessage[] = rows.rows.flatMap((row) => [
        { role: "user" as const, content: row.user_content },
        { role: "assistant" as const, content: row.assistant_content },
      ]);
      const tools = await this.mcp.toolsFor(params.userId, params.didaToken, params.onDebug);
      const result = await this.runner({
        model: this.model, tools, history, message: params.message,
        conversationId: params.conversationId, allowDelete: params.allowDelete,
        onToken: params.onDelta,
        onDebug: params.onDebug,
      });
      usage = result.usage;
      await this.complete(turnId, params.conversationId, params.message, result.message, usage);
      return { id: turnId, userContent: params.message, assistantContent: result.message, status: "succeeded", feedback: null, usage, createdAt: new Date().toISOString() };
    } catch (error) {
      if (error instanceof AgentRunError) usage = error.usage;
      const message = error instanceof Error ? error.message : String(error);
      await this.fail(turnId, params.conversationId, message, usage);
      throw Object.assign(new Error(message), { status: 502, code: "AGENT_ERROR" });
    }
  }

  private async complete(turnId: string, conversationId: string, userMessage: string, assistantMessage: string, usage: TokenUsage): Promise<void> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE chat_turns SET status = 'succeeded', assistant_content = $2,
        input_tokens = $3, output_tokens = $4, total_tokens = $5, completed_at = now() WHERE id = $1`,
        [turnId, assistantMessage, usage.inputTokens, usage.outputTokens, usage.totalTokens]);
      const title = userMessage.replace(/\s+/g, " ").trim().slice(0, 60) || "新对话";
      await client.query(`UPDATE conversations SET
        title = CASE WHEN title_is_custom OR EXISTS (SELECT 1 FROM chat_turns WHERE conversation_id = $1 AND status = 'succeeded' AND id <> $2) THEN title ELSE $6 END,
        input_tokens = input_tokens + COALESCE($3, 0), output_tokens = output_tokens + COALESCE($4, 0),
        total_tokens = total_tokens + COALESCE($5, 0), updated_at = now() WHERE id = $1`,
        [conversationId, turnId, usage.inputTokens, usage.outputTokens, usage.totalTokens, title]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async fail(turnId: string, conversationId: string, message: string, usage: TokenUsage): Promise<void> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE chat_turns SET status = 'failed', error_message = $2,
        input_tokens = $3, output_tokens = $4, total_tokens = $5, completed_at = now() WHERE id = $1`,
        [turnId, message, usage.inputTokens, usage.outputTokens, usage.totalTokens]);
      await client.query(`UPDATE conversations SET input_tokens = input_tokens + COALESCE($2, 0),
        output_tokens = output_tokens + COALESCE($3, 0), total_tokens = total_tokens + COALESCE($4, 0),
        updated_at = now() WHERE id = $1`, [conversationId, usage.inputTokens, usage.outputTokens, usage.totalTokens]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
