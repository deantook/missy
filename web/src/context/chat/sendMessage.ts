import type { MutableRefObject } from "react";
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
};

const emptyUsage = { inputTokens: null, outputTokens: null, totalTokens: null };

const updateLastTurn = (turns: Turn[], update: (turn: Turn) => Turn): Turn[] => {
  const last = turns.at(-1);
  if (!last) return turns;
  return [...turns.slice(0, -1), update(last)];
};

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

  try {
    await streamApi(
      `/v1/conversations/${conversation.id}/messages`,
      { message, allowDelete: false, ...(isDebugBuild() ? { debug: true } : {}) },
      (event) => {
        if (event.type === "start") {
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
    );
    const conversations = await deps.loadConversationList();
    deps.setActive(conversations.find((item) => item.id === conversation.id) ?? conversation);
  } catch (error) {
    if (!readAuthToken()) return;
    const errorMessage = error instanceof Error ? error.message : String(error);
    deps.setTurns((turns) =>
      updateLastTurn(turns, (turn) => ({ ...turn, status: "failed", errorMessage })),
    );
  } finally {
    deps.pendingRef.current = false;
    deps.setPending(false);
  }
}
