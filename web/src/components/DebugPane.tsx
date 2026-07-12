import { useEffect, useRef, useState } from "react";
import { useChat } from "../context/ChatContext.tsx";
import { isDebugBuild, type DebugError, type TimelineEntry } from "../lib/debug-timeline.ts";
import styles from "./DebugPane.module.css";

type DebugPaneProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

const COPY_FEEDBACK_MS = 1500;

function formatError(error: DebugError): string {
  const lines = [`[error]`, `message: ${error.message}`, `code: ${error.code}`];
  if (error.cause) lines.push(`cause:\n${error.cause}`);
  if (error.stack) lines.push(`stack:\n${error.stack}`);
  return lines.join("\n");
}

function formatEntry(entry: TimelineEntry): string {
  if (entry.kind === "thinking") {
    return `[thinking]\n${entry.text}`;
  }
  if (entry.kind === "tool_call") {
    return `[tool_call] ${entry.name}\n${JSON.stringify(entry.args ?? {}, null, 2)}`;
  }
  if (entry.kind === "tool_result") {
    return `[tool_result] ${entry.name} (${entry.ok ? "ok" : "bad"})\n${entry.preview}`;
  }
  if (entry.kind === "mcp") {
    return `[mcp] ${entry.action}${entry.detail ? ` · ${entry.detail}` : ""}`;
  }
  if (entry.kind === "phase") {
    return `[phase] ${entry.phase} · ${entry.status}${entry.detail ? ` · ${entry.detail}` : ""}`;
  }
  return `[note] ${entry.message}`;
}

function formatDebugTimeline(entries: TimelineEntry[], error: DebugError | null): string {
  const parts: string[] = [];
  if (error) parts.push(formatError(error));
  for (const entry of entries) parts.push(formatEntry(entry));
  return parts.join("\n\n");
}

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
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const node = timelineRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [debugRevision]);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
    };
  }, []);

  if (!isDebugBuild()) return null;

  const { entries, error } = debugTimeline;
  const canCopy = entries.length > 0 || error !== null;

  const handleCopy = async () => {
    if (!canCopy) return;
    const text = formatDebugTimeline(entries, error);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    } catch {
      setCopied(false);
    }
  };

  return (
    <aside className={`debug-pane ${styles.pane}`} aria-label="调试面板">
      <header className={styles.header}>
        <strong>调试</strong>
        <span className={styles.badge}>DEBUG</span>
        <div className={styles.actions}>
          <button type="button" onClick={handleCopy} disabled={!canCopy}>
            {copied ? "已复制" : "复制"}
          </button>
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
