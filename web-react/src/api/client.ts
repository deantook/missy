import { clearAuthToken, readAuthToken } from "./auth-storage.ts";

export const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

export function triggerUnauthorized(): void {
  clearAuthToken();
  onUnauthorized?.();
}

export function authHeaders(extra: HeadersInit = {}): HeadersInit {
  const headers = new Headers(extra);
  const token = readAuthToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(url), {
    ...options,
    headers: options.body
      ? authHeaders({ "Content-Type": "application/json", ...(options.headers as Record<string, string>) })
      : authHeaders(options.headers),
  });
  if (response.status === 204) return undefined as T;
  if (response.status === 401) {
    const data = await response.json().catch(() => ({})) as { error?: { message?: string; code?: string } };
    if (data.error?.code === "UNAUTHORIZED" || !data.error?.code) {
      triggerUnauthorized();
    }
    throw new Error(data.error?.message || `请求失败（${response.status}）`);
  }
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message || `请求失败（${response.status}）`);
  return data;
}
