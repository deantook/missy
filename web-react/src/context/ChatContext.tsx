import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "../api/client.ts";
import { DebugTimeline } from "../lib/debug-timeline.ts";
import type { Conversation, Turn } from "../types.ts";
import { useAuth } from "./AuthContext.tsx";
import { sendChatMessage } from "./chat/sendMessage.ts";
import { useToast } from "./ToastContext.tsx";

type Feedback = "like" | "dislike";
type ChatContextValue = {
  conversations: Conversation[];
  active: Conversation | null;
  turns: Turn[];
  pending: boolean;
  loadConversations: () => Promise<void>;
  createConversation: () => Promise<Conversation | null>;
  openConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title?: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  clearAllConversations: () => Promise<void>;
  sendMessage: (message: string) => Promise<void>;
  setTurnFeedback: (turnId: string, feedback: Feedback) => Promise<void>;
  debugTimeline: DebugTimeline;
  debugRevision: number;
  clearDebug: () => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);
export function ChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false), loadedUserRef = useRef<string | null>(null);
  const [debugRevision, setDebugVersion] = useState(0);
  const debugTimeline = useRef(new DebugTimeline()).current;
  const bumpDebug = useCallback(() => setDebugVersion((version) => version + 1), []);

  const clearDebug = useCallback(() => {
    debugTimeline.clear();
    bumpDebug();
  }, [bumpDebug, debugTimeline]);

  const loadConversationList = useCallback(async (): Promise<Conversation[]> => {
    const result = await api<{ conversations: Conversation[] }>("/v1/conversations");
    setConversations(result.conversations);
    return result.conversations;
  }, []);

  const loadConversations = useCallback(async () => {
    await loadConversationList();
  }, [loadConversationList]);

  const createConversation = useCallback(async (): Promise<Conversation | null> => {
    try {
      const result = await api<{ conversation: Conversation }>("/v1/conversations", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setConversations((items) => [result.conversation, ...items]);
      setActive(result.conversation);
      setTurns([]);
      clearDebug();
      return result.conversation;
    } catch {
      return null;
    }
  }, [clearDebug]);

  const openConversation = useCallback(
    async (id: string) => {
      try {
        const result = await api<{ conversation: Conversation; turns: Turn[] }>(
          `/v1/conversations/${id}`,
        );
        setActive(result.conversation);
        setTurns(result.turns);
        clearDebug();
      } catch (error) {
        showToast(error instanceof Error ? error.message : String(error), true);
      }
    },
    [clearDebug, showToast],
  );

  const renameConversation = useCallback(
    async (id: string, title?: string) => {
      const current = conversations.find((item) => item.id === id);
      const nextTitle = (title ?? window.prompt("新的会话名称", current?.title ?? "") ?? "").trim();
      if (!nextTitle) return;
      try {
        const result = await api<{ conversation: Conversation }>(`/v1/conversations/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ title: nextTitle }),
        });
        setConversations((items) =>
          items.map((item) => (item.id === id ? result.conversation : item)),
        );
        if (active?.id === id) setActive(result.conversation);
      } catch (error) {
        showToast(error instanceof Error ? error.message : String(error), true);
      }
    },
    [active, conversations, showToast],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      try {
        await api<void>(`/v1/conversations/${id}`, { method: "DELETE" });
        if (active?.id === id) {
          setActive(null);
          setTurns([]);
          clearDebug();
        }
        await loadConversationList();
      } catch (error) {
        showToast(error instanceof Error ? error.message : String(error), true);
      }
    },
    [active, clearDebug, loadConversationList, showToast],
  );

  const clearAllConversations = useCallback(async () => {
    try {
      await api<void>("/v1/conversations", { method: "DELETE" });
      setConversations([]);
      setActive(null);
      setTurns([]);
      clearDebug();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), true);
      throw error;
    }
  }, [clearDebug, showToast]);

  const setTurnFeedback = useCallback(
    async (turnId: string, feedback: Feedback) => {
      if (!active || pending) return;
      const turn = turns.find((item) => item.id === turnId);
      if (!turn || turn.status !== "succeeded") return;
      const previous = turn.feedback ?? null;
      const next = previous === feedback ? null : feedback;
      setTurns((items) => items.map((item) => (item.id === turnId ? { ...item, feedback: next } : item)));
      try {
        const result = await api<{ turn: Turn }>(
          `/v1/conversations/${active.id}/turns/${turnId}/feedback`,
          { method: "PUT", body: JSON.stringify({ feedback: next }) },
        );
        setTurns((items) => items.map((item) => (item.id === turnId ? result.turn : item)));
      } catch (error) {
        setTurns((items) =>
          items.map((item) => (item.id === turnId ? { ...item, feedback: previous } : item)),
        );
        showToast(error instanceof Error ? error.message : String(error), true);
      }
    },
    [active, pending, showToast, turns],
  );

  const sendMessage = useCallback(
    async (message: string) => {
      await sendChatMessage(message, {
        user,
        active,
        pendingRef,
        createConversation,
        loadConversationList,
        setActive,
        setTurns,
        setPending,
        debugTimeline,
        clearDebug,
        bumpDebug,
      });
    },
    [active, bumpDebug, clearDebug, createConversation, debugTimeline, loadConversationList, user],
  );

  useEffect(() => {
    if (!user) {
      loadedUserRef.current = null;
      setConversations([]);
      setActive(null);
      setTurns([]);
      clearDebug();
      return;
    }
    if (loadedUserRef.current === user.id) return;
    loadedUserRef.current = user.id;
    void loadConversationList();
  }, [clearDebug, loadConversationList, user]);

  const value = useMemo(
    () => ({
      conversations,
      active,
      turns,
      pending,
      loadConversations,
      createConversation,
      openConversation,
      renameConversation,
      deleteConversation,
      clearAllConversations,
      sendMessage,
      setTurnFeedback,
      debugTimeline,
      debugRevision,
      clearDebug,
    }),
    [
      conversations,
      active,
      turns,
      pending,
      loadConversations,
      createConversation,
      openConversation,
      renameConversation,
      deleteConversation,
      clearAllConversations,
      sendMessage,
      setTurnFeedback,
      debugTimeline,
      debugRevision,
      clearDebug,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}

