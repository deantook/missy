import styles from "./Placeholder.module.css";

type SettingsPlaceholderProps = {
  navigate: (path: string, replace?: boolean) => void;
};

export function SettingsPlaceholder({ navigate }: SettingsPlaceholderProps) {
  return (
    <main className={styles.page}>
      <div className={styles.mark}>✦</div>
      <h1>设置即将接入</h1>
      <p>账户与滴答清单配置会在后续任务中迁移。</p>
      <button type="button" onClick={() => navigate("/", true)}>
        返回聊天
      </button>
    </main>
  );
}
