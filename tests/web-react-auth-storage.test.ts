// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { clearAuthToken, readAuthToken, writeAuthToken } from "../web-react/src/api/auth-storage.ts";

afterEach(() => clearAuthToken());

describe("auth-storage", () => {
  it("reads and writes missy.authToken", () => {
    expect(readAuthToken()).toBeNull();
    writeAuthToken("abc");
    expect(readAuthToken()).toBe("abc");
    clearAuthToken();
    expect(readAuthToken()).toBeNull();
  });
});
