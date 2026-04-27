// app.config.ts
import { defineConfig } from "@tanstack/react-start/config";
import tsConfigPaths from "vite-tsconfig-paths";
import path from "path";
import { fileURLToPath } from "url";
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var app_config_default = defineConfig({
  vite: {
    plugins: [tsConfigPaths()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "frontend/src")
      }
    }
  },
  server: {
    preset: "node-server",
    baseURL: "/sentinela"
  }
});
export {
  app_config_default as default
};
