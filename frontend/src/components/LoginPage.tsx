import { useState } from "react";
import { SentinelaLogo } from "@/components/SentinelaLogo";

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1"  y="1"  width="9" height="9" fill="#F25022"/>
      <rect x="11" y="1"  width="9" height="9" fill="#7FBA00"/>
      <rect x="1"  y="11" width="9" height="9" fill="#00A4EF"/>
      <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
    </svg>
  );
}

interface Props {
  onSignIn: (email: string, password: string) => Promise<{ error: { message: string } | null }>;
  onSignInWithMicrosoft: () => Promise<{ error: { message: string } | null }>;
}

export function LoginPage({ onSignIn, onSignInWithMicrosoft }: Props) {
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [error, setError]         = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);
  const [msLoading, setMsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: err } = await onSignIn(email, password);
    if (err) setError(err.message);
    setLoading(false);
  }

  async function handleMicrosoft() {
    setError(null);
    setMsLoading(true);
    const { error: err } = await onSignInWithMicrosoft();
    if (err) { setError(err.message); setMsLoading(false); }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{
        background: "radial-gradient(ellipse at 50% 30%, #0f2044 0%, #07091a 70%)",
      }}
    >
      {/* Subtle grid overlay */}
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(#0077C2 1px, transparent 1px), linear-gradient(90deg, #0077C2 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative w-full max-w-sm">
        <div
          className="rounded-2xl border border-[#1a3a6a] px-8 pt-10 pb-8 shadow-2xl"
          style={{ background: "rgba(10, 18, 40, 0.90)", backdropFilter: "blur(16px)" }}
        >
          {/* Logo + tagline fluindo direto no card */}
          <div className="flex flex-col items-center mb-8">
            <SentinelaLogo className="w-52 rounded-lg" />
            <p className="text-[11px] text-[#0077C2] tracking-[0.25em] font-semibold mt-2 uppercase">
              Ituran · Security Analytics
            </p>
          </div>

          {/* Microsoft SSO */}
          <button
            type="button"
            onClick={handleMicrosoft}
            disabled={msLoading}
            className="w-full flex items-center justify-center gap-3 rounded-lg border border-[#1e3a6a] bg-white px-4 py-2.5 text-sm font-semibold text-[#1a1a1a] hover:bg-gray-100 disabled:opacity-60 transition-colors mb-5"
          >
            {msLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#1a1a1a] border-t-transparent" />
            ) : (
              <MicrosoftIcon />
            )}
            {msLoading ? "Redirecionando…" : "Entrar com Microsoft"}
          </button>

          <div className="relative mb-5">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-[#1e3a6a]" />
            </div>
            <div className="relative flex justify-center text-[11px]">
              <span
                className="px-3 text-slate-500"
                style={{ background: "rgba(10, 18, 40, 0.90)" }}
              >
                ou com e-mail
              </span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">E-mail</label>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-[#1e3a6a] bg-[#050d1f] px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-[#0077C2] transition-shadow"
                placeholder="usuario@ituran.com.br"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Senha</label>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-[#1e3a6a] bg-[#050d1f] px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-[#0077C2] transition-shadow"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2.5">
                <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-red-500" />
                <p className="text-xs text-red-400 leading-relaxed">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-[#0077C2] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0066a8] disabled:opacity-50 transition-colors shadow-lg shadow-[#0077C2]/20 mt-1"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Entrando…
                </span>
              ) : (
                "Entrar"
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-slate-600 mt-5 tracking-wide">
          Uso exclusivo Ituran — acesso monitorado
        </p>
      </div>
    </div>
  );
}
