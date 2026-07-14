import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../components/AppShell.tsx";
import { ChoiceDialog } from "../components/ChoiceDialog.tsx";
import { Composer } from "../components/Composer.tsx";
import { DebugPane } from "../components/DebugPane.tsx";
import { MessageList } from "../components/MessageList.tsx";
import { ThemeToggle } from "../components/ThemeToggle.tsx";
import { useAuth } from "../context/AuthContext.tsx";
import { useChat } from "../context/ChatContext.tsx";
import { useRouter } from "../hooks/useRouter.tsx";
import { isDebugBuild } from "../lib/debug-timeline.ts";
import { parseChoicePrompt } from "../lib/choice-prompt.ts";
import styles from "./ChatPage.module.css";

const debugPanelStorageKey = "missy.debugPanelCollapsed";

function storedDebugCollapsed(): boolean {
  try {
    return localStorage.getItem(debugPanelStorageKey) === "true";
  } catch {
    return false;
  }
}

export function ChatPage() {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const {
    conversations,
    active,
    turns,
    pending,
    loadConversations,
    openConversation,
    sendMessage,
    retryTurn,
    setTurnFeedback,
  } = useChat();
  const requestedLoad = useRef(false);
  const openingId = useRef<string | null>(null);
  const [dismissedChoiceTurnId, setDismissedChoiceTurnId] = useState<string | null>(null);
  const debugEnabled = isDebugBuild();
  const [debugCollapsed, setDebugCollapsed] = useState(storedDebugCollapsed);

  useEffect(() => {
    if (!debugEnabled) return;
    try {
      localStorage.setItem(debugPanelStorageKey, String(debugCollapsed));
    } catch {
      /* localStorage may be unavailable in private contexts. */
    }
  }, [debugCollapsed, debugEnabled]);

  const toggleDebugCollapsed = () => setDebugCollapsed((value) => !value);

  useEffect(() => {
    if (conversations.length > 0 || requestedLoad.current) return;
    requestedLoad.current = true;
    void loadConversations();
  }, [conversations.length, loadConversations]);

  useEffect(() => {
    const first = conversations[0];
    if (active || !first || openingId.current === first.id) return;
    openingId.current = first.id;
    void openConversation(first.id).finally(() => {
      openingId.current = null;
    });
  }, [active, conversations, openConversation]);

  const didaReady = Boolean(user?.didaTokenConfigured);
  const title = active?.title ?? "新对话";
  const pendingChoice = useMemo(() => {
    const turn = [...turns].reverse().find((item) => item.status === "succeeded");
    if (!turn || turn.id === dismissedChoiceTurnId) return null;
    const prompt = parseChoicePrompt(turn.assistantContent);
    return prompt ? { turn, prompt } : null;
  }, [dismissedChoiceTurnId, turns]);

  const focusComposer = () => {
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>("textarea")?.focus(), 0);
  };

  const dismissChoice = () => {
    if (pendingChoice) setDismissedChoiceTurnId(pendingChoice.turn.id);
    focusComposer();
  };

  const submitChoice = (message: string) => {
    dismissChoice();
    void sendMessage(message);
  };

  return (
    <AppShell
      debug={debugEnabled ? <DebugPane collapsed={debugCollapsed} onToggleCollapsed={toggleDebugCollapsed} /> : undefined}
      debugCollapsed={debugCollapsed}
    >
      <div className={styles.top}>
        <header className={styles.header}>
          <div className={styles.title}>
            <h2>{title}</h2>
          </div>
          <div className={styles.actions}>
            {debugEnabled ? (
              <button
                type="button"
                className={styles.debugBadge}
                title={debugCollapsed ? "展开调试面板" : "折叠调试面板"}
                aria-pressed={!debugCollapsed}
                onClick={toggleDebugCollapsed}
              >
                DEBUG
              </button>
            ) : null}
            <ThemeToggle />
            <button
              type="button"
              className={styles.settings}
              title="账户设置"
              aria-label="账户设置"
              onClick={() => navigate("/settings")}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        </header>
        {!didaReady ? (
          <button type="button" className={styles.banner} onClick={() => navigate("/settings")}>
            <span>!</span>
            <div>
              <strong>连接滴答清单</strong>
              <small>配置 Dida MCP Token 后即可开始对话</small>
            </div>
            <b>去设置 →</b>
          </button>
        ) : null}
      </div>
      <MessageList
        turns={turns}
        pending={pending}
        sendMessage={sendMessage}
        retryTurn={retryTurn}
        setTurnFeedback={setTurnFeedback}
      />
      <Composer pending={pending} didaTokenConfigured={didaReady} sendMessage={sendMessage} />
      {pendingChoice ? (
        <ChoiceDialog
          prompt={pendingChoice.prompt}
          onDismiss={dismissChoice}
          onSubmit={submitChoice}
        />
      ) : null}
    </AppShell>
  );
}
