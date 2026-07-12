import { useEffect, useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar.tsx";
import styles from "./AppShell.module.css";

const storageKey = "missy.sidebarCollapsed";

function storedCollapsed(): boolean {
  try {
    return localStorage.getItem(storageKey) === "true";
  } catch {
    return false;
  }
}

type AppShellProps = {
  children: ReactNode;
  debug?: ReactNode;
  debugCollapsed?: boolean;
};

export function AppShell({ children, debug, debugCollapsed = false }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(storedCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const shellClass = [
    styles.shell,
    collapsed ? styles.collapsed : "",
    debug ? styles.hasDebug : "",
    debugCollapsed ? styles.debugCollapsed : "",
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(collapsed));
    } catch {
      /* localStorage may be unavailable in private contexts. */
    }
  }, [collapsed]);

  return (
    <div className={shellClass}>
      <Sidebar mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      {mobileOpen ? (
        <button className={styles.scrim} type="button" aria-label="关闭侧栏" onClick={() => setMobileOpen(false)} />
      ) : null}
      <button
        className={styles.mobileToggle}
        type="button"
        aria-label="打开侧栏"
        onClick={() => setMobileOpen(true)}
      >
        ☰
      </button>
      <button
        className={styles.edgeToggle}
        type="button"
        aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
        onClick={() => setCollapsed((value) => !value)}
      >
        {collapsed ? "›" : "‹"}
      </button>
      <main className={styles.main}>{children}</main>
      {debug}
    </div>
  );
}
