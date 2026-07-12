import { useCallback, useEffect, useState } from "react";

export function currentPath(): string {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

export function useRouter() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onPop = () => setPath(currentPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((next: string, replace = false) => {
    if (currentPath() === next) {
      setPath(next);
      return;
    }
    if (replace) history.replaceState(null, "", next);
    else history.pushState(null, "", next);
    setPath(next);
  }, []);
  return { path, navigate };
}
