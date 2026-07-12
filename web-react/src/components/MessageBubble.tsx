import { memo } from "react";
import { visibleAssistantContent } from "../lib/choice-prompt.ts";
import type { Turn } from "../types.ts";
import { Markdown } from "./Markdown.tsx";
import styles from "./MessageBubble.module.css";

type MessageBubbleProps = {
  turn: Turn;
  pending: boolean;
  setTurnFeedback: (turnId: string, feedback: "like" | "dislike") => Promise<void>;
};

function MessageBubbleComponent({ turn, pending, setTurnFeedback }: MessageBubbleProps) {
  const assistantText = visibleAssistantContent(turn.assistantContent);
  const failed = turn.status === "failed";
  const showTyping = turn.status === "pending" && !assistantText;
  const showFeedback = turn.status === "succeeded";

  return (
    <article className={styles.turn}>
      <div className={`${styles.message} ${styles.user}`}>
        <p className={styles.label}>你</p>
        <div className={`${styles.bubble} ${styles.userBubble}`}>{turn.userContent}</div>
      </div>
      <div className={`${styles.message} ${styles.assistant}`}>
        <p className={styles.label}>Missy</p>
        <div className={`${styles.bubble} ${styles.assistantBubble} ${failed ? styles.failed : ""}`}>
          {failed ? turn.errorMessage || "请求失败，请稍后重试。" : null}
          {showTyping ? (
            <span className={styles.typing} aria-label="Missy 正在输入">
              <i />
              <i />
              <i />
            </span>
          ) : null}
          {!failed && assistantText ? <Markdown content={assistantText} /> : null}
        </div>
        {turn.usage.totalTokens ? (
          <small className={styles.usage}>本轮约 {turn.usage.totalTokens} tokens</small>
        ) : null}
        {showFeedback ? (
          <div className={styles.feedback} aria-label="反馈">
            <button
              type="button"
              className={turn.feedback === "like" ? styles.active : ""}
              disabled={pending}
              onClick={() => void setTurnFeedback(turn.id, "like")}
            >
              赞
            </button>
            <button
              type="button"
              className={turn.feedback === "dislike" ? styles.active : ""}
              disabled={pending}
              onClick={() => void setTurnFeedback(turn.id, "dislike")}
            >
              踩
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export const MessageBubble = memo(MessageBubbleComponent);
