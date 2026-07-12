import { useToast } from "../context/ToastContext.tsx";
import styles from "./ToastHost.module.css";

export function ToastHost() {
  const { toast } = useToast();
  if (!toast) return null;

  return (
    <div
      className={`${styles.toast} ${toast.error ? styles.error : ""}`}
      role="status"
      aria-live="polite"
    >
      {toast.message}
    </div>
  );
}
