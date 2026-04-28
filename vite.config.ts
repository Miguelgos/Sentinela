import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tsConfigPaths from "vite-tsconfig-paths";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  publicDir: path.resolve(__dirname, "frontend/public"),
  server: {
    host: "0.0.0.0",
    port: 5173,
    hmr: { clientPort: 5173 },
    headers: {
      "Content-Security-Policy": [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self' https://*.supabase.co wss://*.supabase.co ws://localhost:5173 ws://172.23.147.145:5173 http://localhost:3001",
        "frame-ancestors 'none'",
      ].join("; "),
    },
  },
  plugins: [
    tanstackStart({
      srcDirectory: "app",
      router: {
        basepath: "/sentinela",
        routesDirectory: "routes",
        generatedRouteTree: "routeTree.gen.ts",
      },
    }),
    viteReact(),
    tsConfigPaths(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "frontend/src"),
    },
  },
});
