import { useState, type FormEvent } from "react";
import { api } from "../../api/client.ts";
import { useToast } from "../../context/ToastContext.tsx";
import { validatePasswordSettings } from "./validation.ts";
import styles from "./PasswordForm.module.css";

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
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={styles.card} onSubmit={submit} noValidate>
      <div className={styles.heading}>
        <span>登录安全</span>
        <p>定期更新密码，保护账户安全</p>
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
      <button type="submit" disabled={saving}>
        更新密码
      </button>
    </form>
  );
}
