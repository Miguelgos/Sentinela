import { defineConfig } from "@tanstack/react-start/config";
import tsConfigPaths from "vite-tsconfig-paths";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  vite: {
    plugins: [tsConfigPaths()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "frontend/src"),
      },
    },
  },
  server: {
    preset: "node-server",
    baseURL: "/sentinela",
  },
});
