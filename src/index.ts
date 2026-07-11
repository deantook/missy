import { loadConfig, ConfigError } from "./config.ts";
import { connectDida365Mcp, closeMcp } from "./mcp.ts";
import { createTaskAgent } from "./agent.ts";
import { runRepl } from "./cli.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  const mcp = await connectDida365Mcp(config);

  const shutdown = async () => {
    await closeMcp(mcp);
  };

  process.on("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });

  try {
    const { agent, interruptOn } = createTaskAgent({
      model: config.model,
      tools: mcp.tools,
    });

    console.log(
      `已连接 MCP，工具数: ${mcp.tools.length}；删除确认: ${Object.keys(interruptOn).join(", ") || "(无)"}`,
    );

    await runRepl(agent);
  } finally {
    await shutdown();
  }
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
