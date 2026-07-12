import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
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
