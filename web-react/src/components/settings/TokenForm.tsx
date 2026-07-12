import { useState, type FormEvent } from "react";
import { api } from "../../api/client.ts";
import { useAuth } from "../../context/AuthContext.tsx";
import { useToast } from "../../context/ToastContext.tsx";
import type { User } from "../../types.ts";
import { validateTokenSettings } from "./validation.ts";
import styles from "./settingsShared.module.css";

export function TokenForm() {
  const { user, setUser } = useAuth();
  const { showToast } = useToast();
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const configured = Boolean(user?.didaTokenConfigured);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = token.trim();
    const error = validateTokenSettings({ token: value });
    if (error) {
      showToast(error, true);
      return;
    }
    setSaving(true);
    try {
      const result = await api<{ user: User }>("/v1/me/dida-token", {
        method: "PUT",
        body: JSON.stringify({ token: value }),
      });
      setUser(result.user);
      setToken("");
      showToast("保存成功");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={`${styles.card} ${styles.wide}`} onSubmit={submit} noValidate>
      <div className={styles.heading}>
        <span className={`${styles.icon} ${styles.tokenIcon}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 7a4 4 0 1 0-3.7 5.5L3 20.8V22h3l1.5-1.5L9 22l2-2-1.5-1.5 4.2-4.2A4 4 0 0 0 15 7Z" />
          </svg>
        </span>
        <div>
          <div className={styles.headingLine}>
            <h3>Dida MCP Token</h3>
            <span className={`${styles.status} ${configured ? styles.statusOk : ""}`}>
              <i />
              {configured ? "已连接" : "未配置"}
            </span>
          </div>
          <p>连接滴答清单，让 Missy 可以安全地管理你的任务</p>
        </div>
      </div>
      <div className={styles.tokenBody}>
        <label className={styles.tokenLabel}>
          {configured ? null : "添加 Token"}
          <span className={styles.tokenWrap}>
            <input
              name="token"
              type="password"
              value={token}
              placeholder="粘贴 Dida MCP Token"
              autoComplete="off"
              onChange={(event) => setToken(event.target.value)}
            />
            <small>{configured ? user?.didaTokenHint : "安全加密保存"}</small>
          </span>
        </label>
        <button className={styles.primary} type="submit" disabled={saving}>
          验证并保存
        </button>
      </div>
      <p className={styles.privacy}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        </svg>
        <span>
          Token 按账户独立保存，任何接口都不会返回完整内容。
          <br />
          获取方式：滴答清单 →{" "}
          <a
            href="https://dida365.com/webapp/#q/all/tasks?modalType=settings"
            target="_blank"
            rel="noopener noreferrer"
          >
            设置
          </a>{" "}
          → 账户与安全 → API 口令 → 管理。
        </span>
      </p>
    </form>
  );
}
