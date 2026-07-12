import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

const debug = process.argv.includes("--debug");
const debugIndex = process.argv.indexOf("--debug");
if (debugIndex !== -1) {
  process.argv.splice(debugIndex, 1);
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  define: {
    "import.meta.env.VITE_DEBUG": JSON.stringify(debug ? "true" : "false"),
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/health": "http://127.0.0.1:3000",
      "/v1": "http://127.0.0.1:3000",
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
