import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { AppConfig } from "./config.ts";

export type McpHandle = {
  client: MultiServerMCPClient;
  tools: Awaited<ReturnType<MultiServerMCPClient["getTools"]>>;
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
      },
    },
  });

  try {
    const tools = await client.getTools();
    if (!tools.length) {
      throw new Error(
        "已连接 MCP，但未获取到任何工具。请检查 DIDA365_TOKEN 与 DIDA365_MCP_URL。",
      );
    }
    return { client, tools };
  } catch (err) {
    await client.close().catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`无法连接滴答清单 MCP（${config.dida365McpUrl}）：${message}`);
  }
}

export async function closeMcp(handle: McpHandle): Promise<void> {
  await handle.client.close();
}
