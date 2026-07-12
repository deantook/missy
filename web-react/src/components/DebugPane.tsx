import { useEffect, useRef } from "react";
import { useChat } from "../context/ChatContext.tsx";
import { isDebugBuild, type DebugError, type TimelineEntry } from "../lib/debug-timeline.ts";
import styles from "./DebugPane.module.css";

type DebugPaneProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

function ErrorBlock({ error }: { error: DebugError }) {
  return (
    <div className={styles.error}>
      <span className={styles.tag}>error</span>
      <pre>
        {error.message}
        {"\n"}code: {error.code}
        {error.cause ? `\ncause:\n${error.cause}` : ""}
        {error.stack ? `\nstack:\n${error.stack}` : ""}
      </pre>
    </div>
  );
}

function TimelineItem({ entry }: { entry: TimelineEntry }) {
  if (entry.kind === "thinking") {
    return (
      <div className={`${styles.item} ${styles.thinking}`}>
        <span className={styles.tag}>thinking</span>
        <pre>{entry.text}</pre>
      </div>
    );
  }
  if (entry.kind === "tool_call") {
    return (
      <div className={`${styles.item} ${styles.tool}`}>
        <span className={styles.tag}>tool_call</span>
        <strong>{entry.name}</strong>
        <pre>{JSON.stringify(entry.args ?? {}, null, 2)}</pre>
      </div>
    );
  }
  if (entry.kind === "tool_result") {
    return (
      <div className={`${styles.item} ${styles.tool} ${entry.ok ? styles.ok : styles.bad}`}>
        <span className={styles.tag}>tool_result</span>
        <strong>{entry.name}</strong>
        <pre>{entry.preview}</pre>
      </div>
    );
  }
  if (entry.kind === "mcp") {
    return (
      <div className={`${styles.item} ${styles.mcp}`}>
        <span className={styles.tag}>mcp</span>
        <span>
          {entry.action}
          {entry.detail ? ` · ${entry.detail}` : ""}
        </span>
      </div>
    );
  }
  if (entry.kind === "phase") {
    return (
      <div className={`${styles.item} ${styles.phase}`}>
        <span className={styles.tag}>phase</span>
        <span>
          {entry.phase} · {entry.status}
          {entry.detail ? ` · ${entry.detail}` : ""}
        </span>
      </div>
    );
  }
  return (
    <div className={`${styles.item} ${styles.note}`}>
      <span className={styles.tag}>note</span>
      <span>{entry.message}</span>
    </div>
  );
}

export function DebugPane({ collapsed, onToggleCollapsed }: DebugPaneProps) {
  const { debugTimeline, debugRevision, clearDebug } = useChat();
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = timelineRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [debugRevision]);

  if (!isDebugBuild()) return null;

  const { entries, error } = debugTimeline;

  return (
    <aside className={`debug-pane ${styles.pane}`} aria-label="调试面板">
      <header className={styles.header}>
        <strong>调试</strong>
        <span className={styles.badge}>DEBUG</span>
        <div className={styles.actions}>
          <button type="button" onClick={clearDebug}>
            清空
          </button>
          <button type="button" onClick={onToggleCollapsed}>
            {collapsed ? "展开" : "折叠"}
          </button>
        </div>
      </header>
      <div
        ref={timelineRef}
        className={`${styles.timeline} ${collapsed ? styles.timelineHidden : ""}`}
      >
        {error ? <ErrorBlock error={error} /> : null}
        {entries.length > 0 ? (
          entries.map((entry, index) => <TimelineItem key={index} entry={entry} />)
        ) : (
          <p className={styles.empty}>等待本轮调试事件…</p>
        )}
      </div>
    </aside>
  );
}
