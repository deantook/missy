import { useEffect, useRef } from "react";
import { AppShell } from "../components/AppShell.tsx";
import { Composer } from "../components/Composer.tsx";
import { MessageList } from "../components/MessageList.tsx";
import { ThemeToggle } from "../components/ThemeToggle.tsx";
import { useAuth } from "../context/AuthContext.tsx";
import { useChat } from "../context/ChatContext.tsx";
import { useRouter } from "../hooks/useRouter.ts";
import styles from "./ChatPage.module.css";

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

  return (
    <AppShell>
      <header className={styles.header}>
        <div className={styles.title}>
          <h2>{title}</h2>
          <p>{didaReady ? "已连接滴答清单" : "需要配置滴答清单 Token"}</p>
        </div>
        <div className={styles.actions}>
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
      <MessageList
        turns={turns}
        pending={pending}
        sendMessage={sendMessage}
        setTurnFeedback={setTurnFeedback}
      />
      <Composer pending={pending} didaTokenConfigured={didaReady} sendMessage={sendMessage} />
    </AppShell>
  );
}
