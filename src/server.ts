import type { Server } from "node:http";
import { loadHttpConfig, ConfigError } from "./config.ts";
import { connectDida365Mcp, closeMcp } from "./mcp.ts";
import { createTaskAgent } from "./agent.ts";
import { createHttpApp } from "./http.ts";

async function main(): Promise<void> {
  const config = loadHttpConfig();
  const mcp = await connectDida365Mcp(config);
  let server: Server | undefined;
  let closing: Promise<void> | undefined;

  const shutdown = (): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
      if (server) await new Promise<void>((resolve, reject) => server!.close((err) => err ? reject(err) : resolve()));
      await closeMcp(mcp);
    })();
    return closing;
  };

  try {
    const { agent } = createTaskAgent({ model: config.model, tools: mcp.tools });
    const app = createHttpApp({ agent, apiKey: config.httpApiKey, ready: () => !closing });
    server = await new Promise<Server>((resolve, reject) => {
      const listening = app.listen(config.httpPort, config.httpHost, () => resolve(listening));
      listening.once("error", reject);
    });
    console.log(`HTTP 服务已启动：http://${config.httpHost}:${config.httpPort}`);
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => void shutdown().then(() => process.exit(0), (err) => {
        console.error(err);
        process.exit(1);
      }));
    }
  } catch (error) {
    await shutdown().catch(() => undefined);
    throw error;
  }
}

main().catch((err) => {
  console.error(err instanceof ConfigError || err instanceof Error ? err.message : err);
  process.exit(1);
});
