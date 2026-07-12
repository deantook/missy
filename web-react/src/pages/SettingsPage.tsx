import { AccountActions } from "../components/settings/AccountActions.tsx";
import { PasswordForm } from "../components/settings/PasswordForm.tsx";
import { ProfileForm } from "../components/settings/ProfileForm.tsx";
import { TokenForm } from "../components/settings/TokenForm.tsx";
import { AppShell } from "../components/AppShell.tsx";
import { ThemeToggle } from "../components/ThemeToggle.tsx";
import { useAuth } from "../context/AuthContext.tsx";
import { useRouter } from "../hooks/useRouter.ts";
import styles from "./SettingsPage.module.css";

export function SettingsPage() {
  const { user } = useAuth();
  const { navigate } = useRouter();

  if (!user) return null;

  const initial = user.displayName.slice(0, 1).toUpperCase() || "M";

  return (
    <AppShell>
      <header className={styles.header}>
        <div>
          <p>SETTINGS</p>
          <h2>账户设置</h2>
        </div>
        <div className={styles.headerActions}>
          <ThemeToggle />
          <button type="button" onClick={() => navigate("/", true)}>
            返回聊天
          </button>
        </div>
      </header>
      <section className={styles.content}>
        <div className={styles.summary}>
          <div className={styles.avatar}>{initial}</div>
          <div>
            <strong>{user.displayName}</strong>
            <span>{user.email}</span>
          </div>
          <small>账户正常</small>
        </div>
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
