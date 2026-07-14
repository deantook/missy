import type { MutableRefObject } from "react";
import { api } from "../../api/client.ts";
import { readAuthToken } from "../../api/auth-storage.ts";
import { streamApi } from "../../api/stream.ts";
import { DebugTimeline, isDebugBuild } from "../../lib/debug-timeline.ts";
import type { Conversation, Turn, User } from "../../types.ts";

type SetState<T> = (updater: T | ((value: T) => T)) => void;

type SendMessageDeps = {
  user: User | null;
  active: Conversation | null;
  pendingRef: MutableRefObject<boolean>;
  createConversation: () => Promise<Conversation | null>;
  loadConversationList: () => Promise<Conversation[]>;
  setActive: SetState<Conversation | null>;
  setTurns: SetState<Turn[]>;
  setPending: SetState<boolean>;
  debugTimeline: DebugTimeline;
  clearDebug: () => void;
  bumpDebug: () => void;
  stopRef: MutableRefObject<(() => Promise<void>) | null>;
};

const emptyUsage = { inputTokens: null, outputTokens: null, totalTokens: null };

const updateLastTurn = (turns: Turn[], update: (turn: Turn) => Turn): Turn[] => {
  const last = turns.at(-1);
  if (!last) return turns;
  return [...turns.slice(0, -1), update(last)];
};

const updateTurn = (turns: Turn[], turnId: string, update: (turn: Turn) => Turn): Turn[] =>
  turns.map((turn) => (turn.id === turnId ? update(turn) : turn));

export async function sendChatMessage(message: string, deps: SendMessageDeps): Promise<void> {
  if (!deps.user?.didaTokenConfigured) return;
  if (deps.pendingRef.current) return;
  deps.pendingRef.current = true;
  deps.setPending(true);

  const conversation = deps.active ?? await deps.createConversation();
  if (!conversation) {
    deps.pendingRef.current = false;
    deps.setPending(false);
    return;
  }

  const optimistic: Turn = {
    id: "pending",
    userContent: message,
    assistantContent: null,
    status: "pending",
    errorMessage: null,
    feedback: null,
    usage: emptyUsage,
    createdAt: new Date().toISOString(),
  };

  deps.setTurns((turns) => [...turns, optimistic]);
  let serverTurnId: string | null = null;
  const controller = new AbortController();
  deps.stopRef.current = async () => {
    try {
      if (serverTurnId) {
        await api(`/v1/conversations/${conversation.id}/turns/${serverTurnId}/cancel`, { method: "POST" });
      }
    } finally {
      controller.abort();
    }
  };

  try {
    await streamApi(
      `/v1/conversations/${conversation.id}/messages`,
      { message, allowDelete: false, ...(isDebugBuild() ? { debug: true } : {}) },
      (event) => {
        if (event.type === "start") {
          serverTurnId = event.turn.id;
          deps.clearDebug();
          deps.setTurns((turns) => updateLastTurn(turns, () => event.turn));
          return;
        }
        if (event.type === "delta") {
          deps.setTurns((turns) =>
            updateLastTurn(turns, (turn) => ({
              ...turn,
              assistantContent: `${event.reset ? "" : turn.assistantContent ?? ""}${event.delta}`,
            })),
          );
          return;
        }
        if (event.type === "done") {
          deps.setTurns((turns) => updateLastTurn(turns, () => event.turn));
          return;
        }
        if (event.type === "debug") {
          deps.debugTimeline.append(event.event);
          deps.bumpDebug();
          return;
        }
        if (event.type === "error") {
          if (isDebugBuild()) {
            deps.debugTimeline.setError({
              code: event.error.code ?? "unknown",
              message: event.error.message ?? "请求失败。",
              stack: event.error.stack,
              cause: event.error.cause,
            });
            deps.bumpDebug();
          }
          throw new Error(event.error.message || "请求失败。");
        }
      },
      controller.signal,
    );
    const conversations = await deps.loadConversationList();
    deps.setActive(conversations.find((item) => item.id === conversation.id) ?? conversation);
  } catch (error) {
    if (!readAuthToken()) return;
    if (serverTurnId) {
      try {
        const result = await api<{ turn: Turn }>(
          `/v1/conversations/${conversation.id}/turns/${serverTurnId}`,
        );
        deps.setTurns((turns) => updateTurn(turns, serverTurnId!, (turn) => ({
          ...result.turn,
          status: result.turn.status === "pending" ? "unknown" : result.turn.status,
          errorMessage: result.turn.status === "pending"
            ? "连接中断，服务端可能仍在执行，请刷新会话确认结果。"
            : result.turn.errorMessage,
        })));
        return;
      } catch {
        // Fall through to an explicit unknown state when the status cannot be checked.
      }
    }
    const errorMessage = "连接中断，暂时无法确认执行结果，请刷新会话后再决定是否重试。";
    deps.setTurns((turns) => updateLastTurn(turns, (turn) => ({ ...turn, status: "unknown", errorMessage })));
  } finally {
    deps.stopRef.current = null;
    deps.pendingRef.current = false;
    deps.setPending(false);
  }
}
