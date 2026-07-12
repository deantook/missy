import { useEffect, useRef } from "react";
import { AccountActions } from "../components/settings/AccountActions.tsx";
import { PasswordForm } from "../components/settings/PasswordForm.tsx";
import { ProfileForm } from "../components/settings/ProfileForm.tsx";
import { TokenForm } from "../components/settings/TokenForm.tsx";
import { AppShell } from "../components/AppShell.tsx";
import { ThemeToggle } from "../components/ThemeToggle.tsx";
import { useAuth } from "../context/AuthContext.tsx";
import { useChat } from "../context/ChatContext.tsx";
import { useRouter } from "../hooks/useRouter.tsx";
import styles from "./SettingsPage.module.css";

export function SettingsPage() {
  const { user } = useAuth();
  const { conversations, loadConversations } = useChat();
  const { navigate } = useRouter();
  const requestedLoad = useRef(false);

  useEffect(() => {
    if (conversations.length > 0 || requestedLoad.current) return;
    requestedLoad.current = true;
    void loadConversations();
  }, [conversations.length, loadConversations]);

  if (!user) return null;

  const initial = user.displayName.slice(0, 1).toUpperCase() || "M";

  return (
    <AppShell>
      <header className={styles.header}>
        <div className={styles.headerActions}>
          <ThemeToggle />
          <button
            type="button"
            className={styles.back}
            title="关闭设置"
            aria-label="关闭设置"
            onClick={() => navigate("/", true)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </header>
      <section className={styles.content}>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>ACCOUNT SETTINGS</p>
          <h1>账户设置</h1>
          <p>管理你的个人资料、服务连接与账户安全。</p>
        </div>
        <section className={styles.summary}>
          <div className={styles.avatar}>{initial}</div>
          <div className={styles.summaryCopy}>
            <strong>{user.displayName}</strong>
            <span>{user.email}</span>
          </div>
          <div className={styles.status}>
            <i />
            账户正常
          </div>
        </section>
        <div className={styles.grid}>
          <ProfileForm />
          <PasswordForm />
          <TokenForm />
          <AccountActions />
        </div>
      </section>
    </AppShell>
  );
}
