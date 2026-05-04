import type { ReactNode } from "react";
import {
  Outlet,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  ScrollRestoration,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SyncBanner } from "../../frontend/src/components/SyncBanner";
import "../../frontend/src/index.css";

interface RouterContext {
  queryClient: QueryClient;
}

const getRuntimeEnv = createServerFn({ method: "GET" }).handler(
  (): RuntimeEnv => ({
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? "",
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? "",
  }),
);

// JSON.stringify pode produzir "</script>" se algum valor contiver "</",
// permitindo escape do bloco. Substituir "<" por "<" mantém o JSON
// válido e neutraliza o vetor de XSS no SSR.
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export const Route = createRootRouteWithContext<RouterContext>()({
  loader: () => getRuntimeEnv(),
  staleTime: Infinity,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Sentinela · Ituran" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/sentinela/favicon.svg" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const env = Route.useLoaderData();
  return (
    <QueryClientProvider client={queryClient}>
      <RootDocument env={env}>
        <Outlet />
      </RootDocument>
    </QueryClientProvider>
  );
}

function RootDocument({
  children,
  env,
}: Readonly<{ children: ReactNode; env: RuntimeEnv }>) {
  return (
    <html lang="pt-BR" className="dark">
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__ENV__ = ${safeJson(env)};`,
          }}
        />
      </head>
      <body>
        <ScrollRestoration />
        <SyncBanner />
        {children}
        <Scripts />
      </body>
    </html>
  );
}
