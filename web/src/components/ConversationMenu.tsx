import { useEffect, useRef } from "react";
import styles from "./ConversationMenu.module.css";

type ConversationMenuProps = {
  x: number;
  y: number;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export function ConversationMenu({ x, y, onRename, onDelete, onClose }: ConversationMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div ref={ref} className={styles.menu} style={{ left: x, top: y }} role="menu">
      <button type="button" role="menuitem" onClick={onRename}>
        重命名
      </button>
      <button type="button" className={styles.danger} role="menuitem" onClick={onDelete}>
        删除
      </button>
    </div>
  );
}
