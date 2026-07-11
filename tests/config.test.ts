import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, ConfigError } from "../src/config.ts";

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

    const config = loadConfig();
    expect(config.model).toBe("openai:gpt-4.1");
    expect(config.dida365Token).toBe("token-abc");
    expect(config.dida365McpUrl).toBe("https://mcp.dida365.com");
  });

  it("throws when MODEL is missing", () => {
    delete process.env.MODEL;
    process.env.DIDA365_TOKEN = "token-abc";
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("throws when DIDA365_TOKEN is missing", () => {
    process.env.MODEL = "anthropic:claude-sonnet-4-5";
    delete process.env.DIDA365_TOKEN;
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("throws when Anthropic model has no ANTHROPIC_API_KEY", () => {
    process.env.MODEL = "anthropic:claude-sonnet-4-5";
    process.env.DIDA365_TOKEN = "token-abc";
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("throws when OpenAI model has no OPENAI_API_KEY", () => {
    process.env.MODEL = "openai:gpt-4.1";
    process.env.DIDA365_TOKEN = "token-abc";
    delete process.env.OPENAI_API_KEY;
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("allows custom DIDA365_MCP_URL", () => {
    process.env.MODEL = "openai:gpt-4.1";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.DIDA365_TOKEN = "token-abc";
    process.env.DIDA365_MCP_URL = "https://example.com/mcp";
    expect(loadConfig().dida365McpUrl).toBe("https://example.com/mcp");
  });
});
