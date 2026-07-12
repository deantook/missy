import { useState, type KeyboardEvent } from "react";
import styles from "./Composer.module.css";

type ComposerProps = {
  pending: boolean;
  didaTokenConfigured: boolean;
  sendMessage: (message: string) => Promise<void>;
};

export function Composer({ pending, didaTokenConfigured, sendMessage }: ComposerProps) {
  const [value, setValue] = useState("");
  const disabled = !didaTokenConfigured || pending;
  const trimmed = value.trim();

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
    <form
      className={styles.wrap}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className={styles.composer}>
        <textarea
          value={value}
          disabled={disabled}
          rows={1}
          placeholder={didaTokenConfigured ? "输入消息，Enter 发送" : "先在设置中配置滴答清单 Token"}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button className={styles.send} type="submit" disabled={disabled || !trimmed} aria-label="发送">
          ↑
        </button>
      </div>
      <p className={styles.hint}>Enter 发送，Shift + Enter 换行</p>
    </form>
  );
}
