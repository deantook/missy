import { useEffect, useRef } from "react";
import type { Turn } from "../types.ts";
import { MessageBubble } from "./MessageBubble.tsx";
import styles from "./MessageList.module.css";

const suggestions = [
  "今天有哪些待办？",
  "创建一个明天下午三点写周报的任务",
  "列出最近七天已完成的任务",
];

type MessageListProps = {
  turns: Turn[];
  pending: boolean;
  sendMessage: (message: string) => Promise<void>;
  retryTurn: (turnId: string) => Promise<void>;
  setTurnFeedback: (turnId: string, feedback: "like" | "dislike") => Promise<void>;
};

export function MessageList({ turns, pending, sendMessage, retryTurn, setTurnFeedback }: MessageListProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  if (turns.length === 0) {
    return (
      <section className={styles.messages}>
        <div className={styles.welcome}>
          <div className={styles.mark}>✦</div>
          <h1>今天想安排什么？</h1>
          <p>查询待办、创建任务、调整日程，或者完成你的清单。</p>
          <div className={styles.suggestions}>
            {suggestions.map((item) => (
              <button key={item} type="button" disabled={pending} onClick={() => void sendMessage(item)}>
                {item}
              </button>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.messages} aria-label="聊天消息">
      {turns.map((turn) => (
        <MessageBubble
          key={turn.id}
          turn={turn}
          pending={pending}
          retryTurn={retryTurn}
          setTurnFeedback={setTurnFeedback}
        />
      ))}
      <div ref={endRef} />
    </section>
  );
}
