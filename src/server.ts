import type { Server } from "node:http";
import { loadHttpConfig, ConfigError } from "./config.ts";
import { createDatabase, migrate } from "./db.ts";
import { UserMcpManager } from "./agent-runtime.ts";
import { createHttpApp } from "./http.ts";

async function main(): Promise<void> {
  const config = loadHttpConfig();
  const database = createDatabase(config.databaseUrl);
  await migrate(database);
  await database.query(`UPDATE chat_turns SET status = 'failed', error_message = '服务重启导致本轮中断。', completed_at = now()
    WHERE status = 'pending'`);
  const mcpManager = new UserMcpManager(config.model, config.dida365McpUrl);
  let server: Server | undefined;
  let closing: Promise<void> | undefined;

  const shutdown = (): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
      if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
      await mcpManager.close();
      await database.end();
    })();
    return closing;
  };

  try {
    const app = createHttpApp({
      database, model: config.model, dida365McpUrl: config.dida365McpUrl,
      production: config.nodeEnv === "production", mcpManager, ready: () => !closing,
    });
    server = await new Promise<Server>((resolve, reject) => {
      const listening = app.listen(config.httpPort, config.httpHost, () => resolve(listening));
      listening.once("error", reject);
    });
    console.log(`HTTP 服务已启动：http://${config.httpHost}:${config.httpPort}`);
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => void shutdown().then(() => process.exit(0), (error) => {
        console.error(error);
        process.exit(1);
      }));
    }
  } catch (error) {
    await shutdown().catch(() => undefined);
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof ConfigError || error instanceof Error ? error.message : error);
  process.exit(1);
});
