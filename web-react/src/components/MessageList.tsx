import { useEffect, useRef } from "react";
import type { Turn } from "../types.ts";
import { MessageBubble } from "./MessageBubble.tsx";
import styles from "./MessageList.module.css";

const suggestions = [
  "帮我整理今天的滴答清单",
  "找出本周最重要的待办",
  "把这个想法拆成可执行任务",
  "提醒我检查过期任务",
];

type MessageListProps = {
  turns: Turn[];
  pending: boolean;
  sendMessage: (message: string) => Promise<void>;
  setTurnFeedback: (turnId: string, feedback: "like" | "dislike") => Promise<void>;
};

export function MessageList({ turns, pending, sendMessage, setTurnFeedback }: MessageListProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  if (turns.length === 0) {
    return (
      <section className={styles.messages}>
        <div className={styles.welcome}>
          <div className={styles.mark}>M</div>
          <h1>今天想让 Missy 帮你安排什么？</h1>
          <p>从滴答清单里找重点，或者直接说出你想推进的事。</p>
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
          setTurnFeedback={setTurnFeedback}
        />
      ))}
      <div ref={endRef} />
    </section>
  );
}
