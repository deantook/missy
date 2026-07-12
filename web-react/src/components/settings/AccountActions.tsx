import { useState } from "react";
import { api } from "../../api/client.ts";
import { useAuth } from "../../context/AuthContext.tsx";
import { useChat } from "../../context/ChatContext.tsx";
import { useToast } from "../../context/ToastContext.tsx";
import { useConfirm } from "../../hooks/useConfirm.ts";
import { useRouter } from "../../hooks/useRouter.tsx";
import styles from "./settingsShared.module.css";

export function AccountActions() {
  const { logout, clearSession } = useAuth();
  const { clearAllConversations } = useChat();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { navigate } = useRouter();
  const [clearing, setClearing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const clearHistory = async () => {
    const ok = await confirm({
      title: "清除全部历史会话？",
      message: "所有历史会话都将从会话列表中移除，此操作无法撤销。",
      confirmLabel: "全部清除",
    });
    if (!ok) return;
    setClearing(true);
    try {
      await clearAllConversations();
      showToast("历史会话已清除");
    } catch {
      /* ChatContext already toasts API errors. */
    } finally {
      setClearing(false);
    }
  };

  const signOut = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
      navigate("/", true);
    }
  };

  const deleteAccount = async () => {
    const password = window.prompt("注销会永久删除所有会话。请输入当前密码确认：");
    if (!password) return;
    setDeleting(true);
    try {
      await api<void>("/v1/me", { method: "DELETE", body: JSON.stringify({ password }) });
      clearSession();
      navigate("/", true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), true);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <section className={styles.rowCard}>
        <div>
          <h3>历史会话</h3>
          <p>将全部历史会话从你的会话列表中隐藏。此操作无法撤销。</p>
        </div>
        <button type="button" className={styles.danger} disabled={clearing} onClick={() => void clearHistory()}>
          清除历史会话
        </button>
      </section>
      <section className={styles.rowCard}>
        <div>
          <h3>账户操作</h3>
          <p>退出当前设备，或永久删除账户及所有数据。</p>
        </div>
        <div className={styles.rowActions}>
          <button type="button" className={styles.textButton} disabled={loggingOut} onClick={() => void signOut()}>
            退出登录
          </button>
          <button type="button" className={styles.danger} disabled={deleting} onClick={() => void deleteAccount()}>
            注销账户
          </button>
        </div>
      </section>
    </>
  );
}
