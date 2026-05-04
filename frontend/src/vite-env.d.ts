/// <reference types="vite/client" />

declare global {
  interface RuntimeEnv {
    VITE_SUPABASE_URL: string;
    VITE_SUPABASE_ANON_KEY: string;
  }
  interface Window {
    __ENV__?: RuntimeEnv;
  }
}

export {};
