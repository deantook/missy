import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { AppConfig } from "./config.ts";
import { blockedToolNames, filterAgentTools } from "./tool-policy.ts";

export type McpHandle = {
  client: MultiServerMCPClient;
  tools: Awaited<ReturnType<MultiServerMCPClient["getTools"]>>;
  filteredToolNames: string[];
};

export async function connectDida365Mcp(
  config: AppConfig,
): Promise<McpHandle> {
  const client = new MultiServerMCPClient({
    mcpServers: {
      dida365: {
        url: config.dida365McpUrl,
        headers: {
          Authorization: `Bearer ${config.dida365Token}`,
        },
        automaticSSEFallback: false,
      },
    },
  });

  try {
    const rawTools = await client.getTools();
    const filteredToolNames = blockedToolNames(rawTools);
    const tools = filterAgentTools(rawTools);
    if (!tools.length) {
      throw new Error(
        "已连接 MCP，但未获取到任何可用工具（或工具均被策略过滤）。请检查 DIDA365_TOKEN 与 DIDA365_MCP_URL。",
      );
    }
    return { client, tools, filteredToolNames };
  } catch (err) {
    await client.close().catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`无法连接滴答清单 MCP（${config.dida365McpUrl}）：${message}`);
  }
}

export async function closeMcp(handle: McpHandle): Promise<void> {
  await handle.client.close();
}
