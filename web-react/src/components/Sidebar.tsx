import { useState } from "react";
import { useChat } from "../context/ChatContext.tsx";
import type { Conversation } from "../types.ts";
import { ConversationMenu } from "./ConversationMenu.tsx";
import styles from "./Sidebar.module.css";

type MenuState = { conversation: Conversation; x: number; y: number } | null;

type SidebarProps = {
  mobileOpen: boolean;
  onCloseMobile: () => void;
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(value));
}

export function Sidebar({ mobileOpen, onCloseMobile }: SidebarProps) {
  const {
    conversations,
    active,
    createConversation,
    openConversation,
    renameConversation,
    deleteConversation,
  } = useChat();
  const [menu, setMenu] = useState<MenuState>(null);

  const rename = (conversation: Conversation) => {
    const title = window.prompt("新的会话名称", conversation.title)?.trim();
    if (title) void renameConversation(conversation.id, title);
  };

  const remove = (conversation: Conversation) => {
    if (window.confirm(`删除会话「${conversation.title}」？`)) void deleteConversation(conversation.id);
  };

  return (
    <aside className={`${styles.sidebar} ${mobileOpen ? styles.open : ""}`}>
      <div className={styles.logo}>
        <span>M</span>
        Missy
      </div>
      <button type="button" className={styles.newChat} onClick={() => void createConversation()}>
        <span>+</span>
        新聊天
      </button>
      <div className={styles.history}>
        <p className={styles.historyHeader}>Conversations</p>
        {conversations.length === 0 ? <p className={styles.empty}>还没有会话</p> : null}
        {conversations.map((conversation) => (
          <div
            key={conversation.id}
            className={`${styles.item} ${active?.id === conversation.id ? styles.active : ""}`}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu({ conversation, x: event.clientX, y: event.clientY });
            }}
          >
            <button
              type="button"
              className={styles.conversation}
              onClick={() => {
                onCloseMobile();
                void openConversation(conversation.id);
              }}
            >
              <span className={styles.title}>{conversation.title}</span>
              <small className={styles.date}>{formatDate(conversation.updatedAt)}</small>
            </button>
            <button
              type="button"
              className={styles.more}
              onClick={(event) => {
                setMenu({ conversation, x: event.clientX, y: event.clientY });
              }}
              aria-label={`打开「${conversation.title}」菜单`}
            >
              ...
            </button>
          </div>
        ))}
      </div>
      {menu ? (
        <ConversationMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onRename={() => {
            rename(menu.conversation);
            setMenu(null);
          }}
          onDelete={() => {
            remove(menu.conversation);
            setMenu(null);
          }}
        />
      ) : null}
    </aside>
  );
}
