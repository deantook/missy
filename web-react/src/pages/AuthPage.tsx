import { useState, type FormEvent } from "react";
import { ThemeToggle } from "../components/ThemeToggle.tsx";
import { useAuth } from "../context/AuthContext.tsx";
import { isDesktopShell } from "../lib/desktop.ts";
import styles from "./AuthPage.module.css";

type AuthPageProps = {
  mode: "login" | "register";
  navigate: (path: string, replace?: boolean) => void;
};

export function AuthPage({ mode, navigate }: AuthPageProps) {
  const { login, register } = useAuth();
  const registering = mode === "register";
  const desktop = isDesktopShell();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const displayName = String(data.get("displayName") ?? "");
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");

    setSubmitting(true);
    setError("");
    try {
      if (registering) await register(displayName, email, password);
      else await login(email, password);
      navigate("/", true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.theme}>
        <ThemeToggle />
      </div>

      {desktop ? (
        <div className={styles.homeLink} aria-hidden="true">
          <span>✦</span>
          <strong>Missy</strong>
        </div>
      ) : (
        <button
          type="button"
          className={styles.homeLink}
          onClick={() => navigate("/")}
          aria-label="返回主页"
        >
          <span>✦</span>
          <strong>Missy</strong>
        </button>
      )}

      <section className={styles.brand}>
        <div className={styles.mark}>✦</div>
        <p className={styles.eyebrow}>DIDA365 · DEEP AGENT</p>
        <h1>
          让计划，真正
          <br />
          开始行动。
        </h1>
        <p>连接你的滴答清单，用自然语言安排、查询和完成每一天。</p>
      </section>

      <section className={styles.card}>
        <div>
          <p className={styles.eyebrow}>{registering ? "CREATE ACCOUNT" : "WELCOME BACK"}</p>
          <h2>{registering ? "创建你的账户" : "登录 Missy"}</h2>
          <p>{registering ? "几秒钟即可开始使用。" : "继续管理你的清单与日程。"}</p>
        </div>

        <form onSubmit={onSubmit}>
          {registering ? (
            <label>
              显示名称
              <input
                name="displayName"
                maxLength={80}
                autoComplete="name"
                placeholder="怎么称呼你"
                required
              />
            </label>
          ) : null}
          <label>
            邮箱
            <input
              name="email"
              type="email"
              maxLength={254}
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          </label>
          <label>
            密码
            <input
              name="password"
              type="password"
              minLength={registering ? 8 : 1}
              maxLength={128}
              autoComplete={registering ? "new-password" : "current-password"}
              placeholder={registering ? "至少 8 位" : "输入密码"}
              required
            />
          </label>
          <p className={styles.error} role="alert">
            {error}
          </p>
          <button type="submit" className={styles.primary} disabled={submitting}>
            {submitting ? "请稍候…" : registering ? "注册并登录" : "登录"}
          </button>
        </form>

        <p className={styles.switch}>
          {registering ? "已有账户？" : "还没有账户？"}
          <button type="button" onClick={() => navigate(registering ? "/login" : "/register")}>
            {registering ? "直接登录" : "创建账户"}
          </button>
        </p>
      </section>
    </main>
  );
}
