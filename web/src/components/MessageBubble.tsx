import { memo } from "react";
import { visibleAssistantContent } from "../lib/choice-prompt.ts";
import type { Turn } from "../types.ts";
import { Markdown } from "./Markdown.tsx";
import styles from "./MessageBubble.module.css";

type MessageBubbleProps = {
  turn: Turn;
  pending: boolean;
  retryTurn: (turnId: string) => Promise<void>;
  setTurnFeedback: (turnId: string, feedback: "like" | "dislike") => Promise<void>;
};

function MessageBubbleComponent({ turn, pending, retryTurn, setTurnFeedback }: MessageBubbleProps) {
  const assistantText = visibleAssistantContent(turn.assistantContent);
  const failed = turn.status === "failed";
  const canceled = turn.status === "canceled";
  const unknown = turn.status === "unknown";
  const showTyping = turn.status === "pending" && !assistantText;
  const showFeedback = turn.status === "succeeded";
  const like = turn.feedback === "like";
  const dislike = turn.feedback === "dislike";

  return (
    <div className={styles.turn}>
      <article className={`${styles.message} ${styles.user}`}>
        <div>
          <p className={styles.label}>你</p>
          <div className={`${styles.bubble} ${styles.userBubble}`}>{turn.userContent}</div>
        </div>
      </article>
      <article className={`${styles.message} ${styles.assistant}`}>
        <div className={styles.content}>
          <p className={styles.label}>Missy</p>
          <div className={`${styles.bubble} ${styles.assistantBubble} ${failed || unknown ? styles.failed : ""} ${canceled ? styles.canceled : ""}`}>
            {failed ? `请求失败：${turn.errorMessage || "未知错误"}` : null}
            {canceled ? turn.errorMessage || "已停止行动" : null}
            {unknown ? `结果未知：${turn.errorMessage || "请刷新会话确认执行结果。"}` : null}
            {showTyping ? (
              <span className={styles.typing} aria-label="Missy 正在输入">
                <i />
                <i />
                <i />
              </span>
            ) : null}
            {!failed && !canceled && !unknown && assistantText ? <Markdown content={assistantText} /> : null}
          </div>
          {failed ? (
            <button
              type="button"
              className={styles.retry}
              disabled={pending}
              onClick={() => void retryTurn(turn.id)}
            >
              重试
            </button>
          ) : null}
          {showFeedback ? (
            <div className={styles.feedback} role="group" aria-label="回复评价">
              <button
                type="button"
                className={`${styles.feedbackBtn} ${like ? styles.active : ""}`}
                title="有帮助"
                aria-label="点赞"
                aria-pressed={like}
                disabled={pending}
                onClick={() => void setTurnFeedback(turn.id, "like")}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M2 21h4V9H2v12zm20-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L13.17 1 6.59 7.59C6.22 7.95 6 8.45 6 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"
                  />
                </svg>
              </button>
              <button
                type="button"
                className={`${styles.feedbackBtn} ${dislike ? styles.active : ""}`}
                title="没帮助"
                aria-label="点踩"
                aria-pressed={dislike}
                disabled={pending}
                onClick={() => void setTurnFeedback(turn.id, "dislike")}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M22 3h-4v12h4V3zM2 14c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L10.83 23l6.58-6.59c.37-.36.59-.86.59-1.41V5c0-1.1-.9-2-2-2H7c-.83 0-1.54.5-1.84 1.22L2.14 11.27c-.09.23-.14.47-.14.73v2z"
                  />
                </svg>
              </button>
            </div>
          ) : null}
        </div>
      </article>
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleComponent);
