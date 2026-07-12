import { describe, expect, it } from "vitest";
import {
  validatePasswordSettings,
  validateProfileSettings,
  validateTokenSettings,
} from "../web-react/src/components/settings/validation.ts";

describe("web-react settings validation", () => {
  it("matches vanilla profile validation messages", () => {
    expect(validateProfileSettings({ displayName: " ", email: "me@example.com" })).toBe("请填写显示名称");
    expect(validateProfileSettings({ displayName: "Dean", email: "" })).toBe("请填写邮箱地址");
    expect(validateProfileSettings({ displayName: "Dean", email: "bad-email" })).toBe("请输入有效的邮箱地址");
    expect(validateProfileSettings({ displayName: "Dean", email: "me@example.com" })).toBeNull();
  });

  it("matches vanilla password validation messages", () => {
    expect(validatePasswordSettings({ currentPassword: "", newPassword: "12345678" })).toBe("请填写当前密码");
    expect(validatePasswordSettings({ currentPassword: "old-pass", newPassword: "" })).toBe("请填写新密码");
    expect(validatePasswordSettings({ currentPassword: "old-pass", newPassword: "1234567" })).toBe("新密码至少 8 位");
    expect(validatePasswordSettings({ currentPassword: "old-pass", newPassword: "12345678" })).toBeNull();
  });

  it("matches vanilla Dida token validation messages", () => {
    expect(validateTokenSettings({ token: "" })).toBe("请先粘贴 Dida MCP Token");
    expect(validateTokenSettings({ token: "1234567" })).toBe("Token 长度至少 8 位");
    expect(validateTokenSettings({ token: "12345678" })).toBeNull();
  });
});
