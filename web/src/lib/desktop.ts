export function isDesktopShell(): boolean {
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}
