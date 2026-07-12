import { config as loadDotenv } from "dotenv";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface AppConfig {
  model: string;
  dida365Token: string;
  dida365McpUrl: string;
}

export interface ServerConfig {
  model: string;
  dida365McpUrl: string;
  databaseUrl: string;
  httpHost: string;
  httpPort: number;
  nodeEnv: string;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ConfigError(
      `缺少环境变量 ${name}。请复制 .env.example 为 .env 并填入配置。`,
    );
  }
  return value;
}

function assertProviderKey(model: string): void {
  const lower = model.toLowerCase();
  if (lower.startsWith("anthropic:") || lower.includes("claude")) {
    if (!process.env.ANTHROPIC_API_KEY?.trim()) {
      throw new ConfigError(
        `模型 ${model} 需要 ANTHROPIC_API_KEY。请在 .env 中配置。`,
      );
    }
    return;
  }
  if (lower.startsWith("openai:") || lower.includes("gpt-")) {
    if (!process.env.OPENAI_API_KEY?.trim()) {
      throw new ConfigError(
        `模型 ${model} 需要 OPENAI_API_KEY。请在 .env 中配置。`,
      );
    }
    return;
  }
  // Other providers: rely on their own env vars; do not hard-fail here.
}

export function loadConfig(options: { loadDotenv?: boolean } = {}): AppConfig {
  if (options.loadDotenv !== false) loadDotenv();

  const model = requireEnv("MODEL");
  const dida365Token = requireEnv("DIDA365_TOKEN");
  assertProviderKey(model);

  const dida365McpUrl =
    process.env.DIDA365_MCP_URL?.trim() || "https://mcp.dida365.com";

  return { model, dida365Token, dida365McpUrl };
}

export function loadHttpConfig(
  options: { loadDotenv?: boolean } = {},
): ServerConfig {
  if (options.loadDotenv !== false) loadDotenv();
  const model = requireEnv("MODEL");
  assertProviderKey(model);
  const dida365McpUrl = process.env.DIDA365_MCP_URL?.trim() || "https://mcp.dida365.com";
  const databaseUrl = process.env.DATABASE_URL?.trim() || "postgresql://dean:postgres@localhost:5432/missy";
  const httpHost = process.env.HTTP_HOST?.trim() || "127.0.0.1";
  const rawPort = process.env.HTTP_PORT?.trim() || "3000";
  const httpPort = Number(rawPort);
  if (!Number.isInteger(httpPort) || httpPort < 1 || httpPort > 65535) {
    throw new ConfigError("HTTP_PORT 必须是 1 到 65535 之间的整数。");
  }
  return { model, dida365McpUrl, databaseUrl, httpHost, httpPort, nodeEnv: process.env.NODE_ENV?.trim() || "development" };
}
