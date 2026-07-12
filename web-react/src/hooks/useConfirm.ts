import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
};

type ConfirmState = ConfirmOptions & {
  open: boolean;
};

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setState(null);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    resolver.current?.(false);
    setState({ ...options, open: true });
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return createElement(
    ConfirmContext.Provider,
    { value },
    children,
    createElement(ConfirmDialog, {
      open: Boolean(state?.open),
      title: state?.title ?? "",
      message: state?.message ?? "",
      confirmLabel: state?.confirmLabel,
      onCancel: () => settle(false),
      onConfirm: () => settle(true),
    }),
  );
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used within ConfirmProvider");
  return confirm;
}
