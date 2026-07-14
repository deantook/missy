import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import styles from "./Composer.module.css";

type ComposerProps = {
  pending: boolean;
  didaTokenConfigured: boolean;
  sendMessage: (message: string) => Promise<void>;
  stopMessage: () => Promise<void>;
};

export function Composer({ pending, didaTokenConfigured, sendMessage, stopMessage }: ComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const disabled = !didaTokenConfigured || pending;
  const trimmed = value.trim();

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const submit = () => {
    if (disabled || !trimmed) return;
    setValue("");
    void sendMessage(trimmed);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submit();
  };

  return (
    <div className={styles.wrap}>
      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={textareaRef}
          value={value}
          disabled={disabled}
          maxLength={4000}
          rows={1}
          placeholder="给 Missy 发送消息…"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {pending ? (
          <button className={styles.stop} type="button" onClick={() => void stopMessage()} aria-label="停止行动">
            ■
          </button>
        ) : (
          <button className={styles.send} type="submit" disabled={disabled || !trimmed} aria-label="发送">
            ↑
          </button>
        )}
      </form>
      <p className={styles.hint}>Missy 可能出错 请谨慎斟酌内容</p>
    </div>
  );
}
