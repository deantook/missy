import { useState, type FormEvent } from "react";
import { api } from "../../api/client.ts";
import { useToast } from "../../context/ToastContext.tsx";
import { validatePasswordSettings } from "./validation.ts";
import styles from "./settingsShared.module.css";

export function PasswordForm() {
  const { showToast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const error = validatePasswordSettings({ currentPassword, newPassword });
    if (error) {
      showToast(error, true);
      return;
    }
    setSaving(true);
    try {
      await api<void>("/v1/me/password", {
        method: "PUT",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      showToast("保存成功");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={styles.card} onSubmit={submit} noValidate>
      <div className={styles.heading}>
        <span className={styles.icon}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 10V7a5 5 0 0 1 10 0v3M6 10h12a2 2 0 0 1 2 2v8H4v-8a2 2 0 0 1 2-2Zm6 4v3" />
          </svg>
        </span>
        <div>
          <h3>登录安全</h3>
          <p>定期更新密码，保护账户安全</p>
        </div>
      </div>
      <div className={styles.fields}>
        <label>
          当前密码
          <input
            name="currentPassword"
            type="password"
            value={currentPassword}
            autoComplete="current-password"
            placeholder="输入当前密码"
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </label>
        <label>
          新密码
          <input
            name="newPassword"
            type="password"
            value={newPassword}
            autoComplete="new-password"
            placeholder="至少 8 位字符"
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </label>
      </div>
      <div className={styles.actions}>
        <button className={styles.secondary} type="submit" disabled={saving}>
          更新密码
        </button>
      </div>
    </form>
  );
}
