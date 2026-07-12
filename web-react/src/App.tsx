import { ThemeProvider } from "./context/ThemeContext.tsx";
import { ToastProvider } from "./context/ToastContext.tsx";
import { AuthProvider } from "./context/AuthContext.tsx";
import { ChatProvider } from "./context/ChatContext.tsx";
import { AppRoutes } from "./AppRoutes.tsx";
import { ToastHost } from "./components/ToastHost.tsx";

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <ChatProvider>
            <AppRoutes />
            <ToastHost />
          </ChatProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
