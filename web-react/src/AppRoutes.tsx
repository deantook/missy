import { useEffect } from "react";
import { BootScreen } from "./components/BootScreen.tsx";
import { useAuth } from "./context/AuthContext.tsx";
import { useRouter } from "./hooks/useRouter.ts";
import { isDesktopShell } from "./lib/desktop.ts";
import { AuthPage } from "./pages/AuthPage.tsx";
import { ChatPlaceholder } from "./pages/ChatPlaceholder.tsx";
import { LandingPage } from "./pages/LandingPage.tsx";
import { SettingsPlaceholder } from "./pages/SettingsPlaceholder.tsx";

export function AppRoutes() {
  const { path, navigate } = useRouter();
  const { user, bootstrapping } = useAuth();
  const desktop = isDesktopShell();

  useEffect(() => {
    if (bootstrapping) return;
    if (!user && desktop && path !== "/login" && path !== "/register") {
      navigate("/login", true);
    }
    if (user && path !== "/" && path !== "/settings") {
      navigate("/", true);
    }
  }, [bootstrapping, desktop, navigate, path, user]);

  if (bootstrapping) return <BootScreen />;

  if (!user) {
    if (path === "/register") return <AuthPage mode="register" navigate={navigate} />;
    if (path === "/login" || desktop) return <AuthPage mode="login" navigate={navigate} />;
    return <LandingPage navigate={navigate} />;
  }

  if (path === "/settings") return <SettingsPlaceholder navigate={navigate} />;
  return <ChatPlaceholder />;
}
