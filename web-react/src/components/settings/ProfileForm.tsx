import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../api/client.ts";
import { useAuth } from "../../context/AuthContext.tsx";
import { useToast } from "../../context/ToastContext.tsx";
import type { User } from "../../types.ts";
import { validateProfileSettings } from "./validation.ts";
import styles from "./settingsShared.module.css";

export function ProfileForm() {
  const { user, setUser } = useAuth();
  const { showToast } = useToast();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDisplayName(user?.displayName ?? "");
    setEmail(user?.email ?? "");
  }, [user?.displayName, user?.email]);

  if (!user) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = { displayName: displayName.trim(), email: email.trim() };
    const error = validateProfileSettings(values);
    if (error) {
      showToast(error, true);
      return;
    }
    setSaving(true);
    try {
      const result = await api<{ user: User }>("/v1/me", {
        method: "PATCH",
        body: JSON.stringify(values),
      });
      setUser(result.user);
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
            <path d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" />
          </svg>
        </span>
        <div>
          <h3>个人资料</h3>
          <p>管理你的公开名称和登录邮箱</p>
        </div>
      </div>
      <div className={styles.fields}>
        <label>
          显示名称
          <input
            name="displayName"
            value={displayName}
            maxLength={80}
            autoComplete="name"
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label>
          邮箱地址
          <input
            name="email"
            type="email"
            value={email}
            maxLength={254}
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
      </div>
      <div className={styles.actions}>
        <button className={styles.primary} type="submit" disabled={saving}>
          保存更改
        </button>
      </div>
    </form>
  );
}
