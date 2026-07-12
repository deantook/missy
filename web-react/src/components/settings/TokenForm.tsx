import { useState, type FormEvent } from "react";
import { api } from "../../api/client.ts";
import { useAuth } from "../../context/AuthContext.tsx";
import { useToast } from "../../context/ToastContext.tsx";
import type { User } from "../../types.ts";
import { validateTokenSettings } from "./validation.ts";
import styles from "./TokenForm.module.css";

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
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={styles.card} onSubmit={submit} noValidate>
      <div className={styles.heading}>
        <div>
          <span>Dida MCP Token</span>
          <p>连接滴答清单，让 Missy 可以安全地管理你的任务</p>
        </div>
        <b className={configured ? styles.ok : ""}>{configured ? "已连接" : "未配置"}</b>
      </div>
      <label className={styles.tokenField}>
        {configured ? "更新 Token" : "添加 Token"}
        <input
          name="token"
          type="password"
          value={token}
          placeholder="粘贴 Dida MCP Token"
          autoComplete="off"
          onChange={(event) => setToken(event.target.value)}
        />
        <small>{configured ? user?.didaTokenHint : "安全加密保存"}</small>
      </label>
      <button type="submit" disabled={saving}>
        验证并保存
      </button>
      <p className={styles.privacy}>
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
      </p>
    </form>
  );
}
