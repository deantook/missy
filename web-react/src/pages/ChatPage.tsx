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
  const title = active?.title ?? "新聊天";
  const profileLabel = user?.displayName?.slice(0, 1).toUpperCase() || "M";
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
            <p>{didaReady ? "已连接滴答清单" : "需要配置滴答清单 Token"}</p>
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
              className={styles.profile}
              aria-label="打开设置"
              onClick={() => navigate("/settings")}
            >
              {profileLabel}
            </button>
          </div>
        </header>
        {!didaReady ? (
          <div className={styles.banner}>
            <span>!</span>
            <div>
              <b>还不能发送消息</b>
              <small>先到设置页配置滴答清单 Token，Missy 才能读取和整理任务。</small>
            </div>
            <button type="button" onClick={() => navigate("/settings")}>
              去设置
            </button>
          </div>
        ) : null}
      </div>
      <MessageList
        turns={turns}
        pending={pending}
        sendMessage={sendMessage}
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
