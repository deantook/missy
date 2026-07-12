import styles from "./BootScreen.module.css";

export function BootScreen() {
  return (
    <main className={styles.boot} aria-busy="true">
      <div className={styles.mark} aria-hidden="true">
        *
      </div>
      <p>正在载入 Missy…</p>
    </main>
  );
}
