import { createClient } from "@supabase/supabase-js";

const env: Partial<RuntimeEnv> =
  typeof window !== "undefined"
    ? (window.__ENV__ ?? {})
    : {
        VITE_SUPABASE_URL: globalThis.process?.env?.VITE_SUPABASE_URL,
        VITE_SUPABASE_ANON_KEY: globalThis.process?.env?.VITE_SUPABASE_ANON_KEY,
      };

export const supabase = createClient(
  env.VITE_SUPABASE_URL ?? "",
  env.VITE_SUPABASE_ANON_KEY ?? "",
);
