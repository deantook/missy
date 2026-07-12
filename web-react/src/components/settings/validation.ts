const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ProfileSettings = {
  displayName: string;
  email: string;
};

export type PasswordSettings = {
  currentPassword: string;
  newPassword: string;
};

export type TokenSettings = {
  token: string;
};

export function validateProfileSettings(values: ProfileSettings): string | null {
  const displayName = values.displayName.trim();
  const email = values.email.trim();
  if (!displayName) return "请填写显示名称";
  if (!email) return "请填写邮箱地址";
  if (!emailPattern.test(email)) return "请输入有效的邮箱地址";
  return null;
}

export function validatePasswordSettings(values: PasswordSettings): string | null {
  const currentPassword = values.currentPassword.trim();
  const newPassword = values.newPassword.trim();
  if (!currentPassword) return "请填写当前密码";
  if (!newPassword) return "请填写新密码";
  if (newPassword.length < 8) return "新密码至少 8 位";
  return null;
}

export function validateTokenSettings(values: TokenSettings): string | null {
  const token = values.token.trim();
  if (!token) return "请先粘贴 Dida MCP Token";
  if (token.length < 8) return "Token 长度至少 8 位";
  return null;
}
