import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const env: Partial<RuntimeEnv> =
  typeof window !== "undefined"
    ? (window.__ENV__ ?? {})
    : {
        VITE_SUPABASE_URL: globalThis.process?.env?.VITE_SUPABASE_URL,
        VITE_SUPABASE_ANON_KEY: globalThis.process?.env?.VITE_SUPABASE_ANON_KEY,
      };

// Lazy: createClient instancia RealtimeClient internamente, que requer
// WebSocket nativo (Node 22+). No SSR do dev (Node 20) isso quebra. Como todos
// os usos de `supabase` em useAuth.ts são dentro de useEffect/handlers (sempre
// client-side), o Proxy adia a criação até o primeiro acesso real.
let _client: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(env.VITE_SUPABASE_URL ?? "", env.VITE_SUPABASE_ANON_KEY ?? "");
  }
  return _client;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
});
