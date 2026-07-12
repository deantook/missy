const KEY = "missy.authToken";

export function readAuthToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeAuthToken(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearAuthToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore quota / private mode */
  }
}
