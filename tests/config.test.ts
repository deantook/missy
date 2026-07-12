import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, loadHttpConfig, ConfigError } from "../src/config.ts";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("loadConfig", () => {
  it("loads required fields from env", () => {
    process.env.MODEL = "openai:gpt-4.1";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.DIDA365_TOKEN = "token-abc";
    delete process.env.DIDA365_MCP_URL;

    const config = loadConfig({ loadDotenv: false });
    expect(config.model).toBe("openai:gpt-4.1");
    expect(config.dida365Token).toBe("token-abc");
    expect(config.dida365McpUrl).toBe("https://mcp.dida365.com");
  });

  it("throws when MODEL is missing", () => {
    delete process.env.MODEL;
    process.env.DIDA365_TOKEN = "token-abc";
    expect(() => loadConfig({ loadDotenv: false })).toThrow(ConfigError);
  });

  it("throws when DIDA365_TOKEN is missing", () => {
    process.env.MODEL = "anthropic:claude-sonnet-4-5";
    delete process.env.DIDA365_TOKEN;
    expect(() => loadConfig({ loadDotenv: false })).toThrow(ConfigError);
  });

  it("throws when Anthropic model has no ANTHROPIC_API_KEY", () => {
    process.env.MODEL = "anthropic:claude-sonnet-4-5";
    process.env.DIDA365_TOKEN = "token-abc";
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => loadConfig({ loadDotenv: false })).toThrow(ConfigError);
  });

  it("throws when OpenAI model has no OPENAI_API_KEY", () => {
    process.env.MODEL = "openai:gpt-4.1";
    process.env.DIDA365_TOKEN = "token-abc";
    delete process.env.OPENAI_API_KEY;
    expect(() => loadConfig({ loadDotenv: false })).toThrow(ConfigError);
  });

  it("allows custom DIDA365_MCP_URL", () => {
    process.env.MODEL = "openai:gpt-4.1";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.DIDA365_TOKEN = "token-abc";
    process.env.DIDA365_MCP_URL = "https://example.com/mcp";
    expect(loadConfig({ loadDotenv: false }).dida365McpUrl).toBe("https://example.com/mcp");
  });

  it("loads HTTP defaults and overrides", () => {
    process.env.MODEL = "openai:gpt-4.1";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.DIDA365_TOKEN = "token-abc";
    process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
    delete process.env.HTTP_HOST;
    delete process.env.HTTP_PORT;
    const defaults = loadHttpConfig({ loadDotenv: false });
    expect(defaults.httpHost).toBe("127.0.0.1");
    expect(defaults.httpPort).toBe(3000);
    expect(defaults.databaseUrl).toBe("postgresql://test:test@localhost/test");

    process.env.HTTP_HOST = "0.0.0.0";
    process.env.HTTP_PORT = "8080";
    const custom = loadHttpConfig({ loadDotenv: false });
    expect(custom.httpHost).toBe("0.0.0.0");
    expect(custom.httpPort).toBe(8080);
  });

  it("does not require HTTP_API_KEY or DIDA token for HTTP and validates HTTP_PORT", () => {
    process.env.MODEL = "openai:gpt-4.1";
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.DIDA365_TOKEN;
    delete process.env.HTTP_API_KEY;
    expect(() => loadHttpConfig({ loadDotenv: false })).not.toThrow();
    process.env.HTTP_PORT = "70000";
    expect(() => loadHttpConfig({ loadDotenv: false })).toThrow(ConfigError);
  });

  it("parses CORS_ORIGINS and defaults for development", () => {
    process.env.MODEL = "openai:gpt-4.1";
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.CORS_ORIGINS;
    process.env.NODE_ENV = "development";
    const dev = loadHttpConfig({ loadDotenv: false });
    expect(dev.corsOrigins).toContain("http://127.0.0.1:5173");
    expect(dev.corsOrigins).toContain("tauri://localhost");

    process.env.NODE_ENV = "production";
    expect(loadHttpConfig({ loadDotenv: false }).corsOrigins).toEqual([]);

    process.env.CORS_ORIGINS = "https://app.example.com, https://api.example.com ";
    expect(loadHttpConfig({ loadDotenv: false }).corsOrigins).toEqual([
      "https://app.example.com",
      "https://api.example.com",
    ]);
  });
});
