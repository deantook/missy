import { loadHttpConfig } from "./config.ts";
import { createDatabase, migrate } from "./db.ts";

const config = loadHttpConfig();
const database = createDatabase(config.databaseUrl);
try {
  await migrate(database);
  console.log("数据库迁移完成。");
} finally {
  await database.end();
}
