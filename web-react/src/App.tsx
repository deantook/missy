import { ThemeProvider } from "./context/ThemeContext.tsx";
import { ToastProvider } from "./context/ToastContext.tsx";
import { AuthProvider } from "./context/AuthContext.tsx";
import { ChatProvider } from "./context/ChatContext.tsx";
import { AppRoutes } from "./AppRoutes.tsx";
import { ToastHost } from "./components/ToastHost.tsx";
import { ConfirmProvider } from "./hooks/useConfirm.ts";

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <ConfirmProvider>
            <ChatProvider>
              <AppRoutes />
              <ToastHost />
            </ChatProvider>
          </ConfirmProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
