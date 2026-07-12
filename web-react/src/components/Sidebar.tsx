import { useState } from "react";
import { useChat } from "../context/ChatContext.tsx";
import { useConfirm } from "../hooks/useConfirm.ts";
import type { Conversation } from "../types.ts";
import { ConversationMenu } from "./ConversationMenu.tsx";
import styles from "./Sidebar.module.css";

type MenuState = { conversation: Conversation; x: number; y: number } | null;

type SidebarProps = {
  mobileOpen: boolean;
  onCloseMobile: () => void;
};

export function Sidebar({ mobileOpen, onCloseMobile }: SidebarProps) {
  const {
    conversations,
    active,
    createConversation,
    openConversation,
    renameConversation,
    deleteConversation,
  } = useChat();
  const confirm = useConfirm();
  const [menu, setMenu] = useState<MenuState>(null);

  const rename = (conversation: Conversation) => {
    const title = window.prompt("新的会话名称", conversation.title)?.trim();
    if (title) void renameConversation(conversation.id, title);
  };

  const remove = async (conversation: Conversation) => {
    const ok = await confirm({
      title: "删除这个对话？",
      message: `“${conversation.title}”及其中的全部记录将被永久删除，此操作无法撤销。`,
      confirmLabel: "删除",
    });
    if (ok) await deleteConversation(conversation.id);
  };

  return (
    <aside className={`${styles.sidebar} ${mobileOpen ? styles.open : ""}`}>
      <div className={styles.logo}>
        <span>✦</span>
        <strong>Missy</strong>
      </div>
      <nav className={styles.history}>
        <div className={styles.historyHeader}>
          <p>最近对话</p>
          <button
            type="button"
            className={styles.newChat}
            title="新建对话"
            aria-label="新建对话"
            onClick={() => void createConversation()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
        <div className={styles.list}>
          {conversations.length === 0 ? <p className={styles.empty}>还没有历史对话</p> : null}
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              className={`${styles.item} ${active?.id === conversation.id ? styles.active : ""}`}
              onClick={() => {
                onCloseMobile();
                void openConversation(conversation.id);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ conversation, x: event.clientX, y: event.clientY });
              }}
            >
              <span>{conversation.title}</span>
            </button>
          ))}
        </div>
      </nav>
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
            void remove(menu.conversation);
            setMenu(null);
          }}
        />
      ) : null}
    </aside>
  );
}
