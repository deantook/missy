import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Database } from "./db.ts";

const scrypt = promisify(scryptCallback);
const SESSION_DAYS = 30;

export type UserRecord = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  dida_mcp_token: string | null;
  created_at: Date;
  updated_at: Date;
};

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64) as Buffer;
  return `scrypt:${salt.toString("base64")}:${key.toString("base64")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltValue, keyValue] = encoded.split(":");
  if (algorithm !== "scrypt" || !saltValue || !keyValue) return false;
  const expected = Buffer.from(keyValue, "base64");
  const actual = await scrypt(password, Buffer.from(saltValue, "base64"), expected.length) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function readBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

export async function createSession(database: Database, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await database.query(
    "INSERT INTO auth_sessions(user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [userId, tokenHash(token), expiresAt],
  );
  return { token, expiresAt };
}

export async function userFromBearer(
  database: Database,
  authorization: string | undefined,
): Promise<UserRecord | null> {
  const token = readBearerToken(authorization);
  if (!token) return null;
  const result = await database.query<UserRecord>(
    `UPDATE auth_sessions s SET last_seen_at = now()
     FROM users u WHERE s.token_hash = $1 AND s.expires_at > now() AND u.id = s.user_id
     RETURNING u.*`,
    [tokenHash(token)],
  );
  return result.rows[0] ?? null;
}

export async function deleteSessionByToken(database: Database, token: string): Promise<void> {
  await database.query("DELETE FROM auth_sessions WHERE token_hash = $1", [tokenHash(token)]);
}

export function publicUser(user: UserRecord) {
  const token = user.dida_mcp_token;
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    didaTokenConfigured: Boolean(token),
    didaTokenHint: token ? `••••${token.slice(-4)}` : null,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}
