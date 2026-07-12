import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createSession,
  deleteSessionByToken,
  readBearerToken,
  userFromBearer,
} from "../src/auth.ts";
import { createDatabase, migrate, type Database } from "../src/db.ts";

let database: Database;
const email = `auth-${Date.now()}@example.com`;
let userId: string;

beforeAll(async () => {
  database = createDatabase(process.env.TEST_DATABASE_URL || "postgresql://dean:postgres@localhost:5432/missy");
  await migrate(database);
  const inserted = await database.query<{ id: string }>(
    `INSERT INTO users(email, display_name, password_hash)
     VALUES ($1, 'Auth', 'scrypt:x:x') RETURNING id`,
    [email],
  );
  userId = inserted.rows[0]!.id;
});

afterAll(async () => {
  await database.query("DELETE FROM users WHERE email = $1", [email]);
  await database.end();
});

describe("Bearer auth helpers", () => {
  it("parses Authorization Bearer tokens", () => {
    expect(readBearerToken("Bearer abc.def")).toBe("abc.def");
    expect(readBearerToken("bearer abc")).toBe("abc");
    expect(readBearerToken("Basic abc")).toBeNull();
    expect(readBearerToken(undefined)).toBeNull();
  });

  it("resolves and deletes sessions by token", async () => {
    const session = await createSession(database, userId);
    const user = await userFromBearer(database, `Bearer ${session.token}`);
    expect(user?.id).toBe(userId);
    expect(await userFromBearer(database, "Bearer deadbeef")).toBeNull();
    await deleteSessionByToken(database, session.token);
    expect(await userFromBearer(database, `Bearer ${session.token}`)).toBeNull();
  });
});
