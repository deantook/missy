import { ThemeProvider } from "./context/ThemeContext.tsx";
import { ToastProvider, useToast } from "./context/ToastContext.tsx";
import { ThemeToggle } from "./components/ThemeToggle.tsx";
import { ToastHost } from "./components/ToastHost.tsx";

function Scaffold() {
  const { showToast } = useToast();
  return (
    <main style={{ padding: 24 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <span>Missy React scaffold</span>
        <ThemeToggle />
        <button type="button" onClick={() => showToast("ok")}>
          toast
        </button>
      </div>
      <ToastHost />
    </main>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <Scaffold />
      </ToastProvider>
    </ThemeProvider>
  );
}
