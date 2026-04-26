export function SentinelaLogo({ className }: { className?: string }) {
  return (
    <img
      src="/sentinela_v1_radar_pulso.svg"
      alt="Sentinela"
      className={className}
      draggable={false}
    />
  );
}

export function SentinelaIcon({ size = 28 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-label="Sentinela"
    >
      <defs>
        <linearGradient id="sent-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      {/* Shield */}
      <path
        d="M 32 6 L 54 12 L 54 36 Q 54 56 32 62 Q 10 56 10 36 L 10 12 Z"
        fill="url(#sent-bg)"
      />
      {/* Shield inner border */}
      <path
        d="M 32 10 L 51 15.5 L 51 36 Q 51 52 32 58 Q 13 52 13 36 L 13 15.5 Z"
        fill="none"
        stroke="#93c5fd"
        strokeWidth="1"
        opacity="0.35"
      />
      {/* Eye outline */}
      <ellipse cx="32" cy="35" rx="14" ry="8.5" fill="none" stroke="#bfdbfe" strokeWidth="1.5" />
      {/* Iris */}
      <circle cx="32" cy="35" r="5.5" fill="#1e3a8a" />
      {/* Pupil */}
      <circle cx="32" cy="35" r="3" fill="#0f172a" />
      {/* Glint */}
      <circle cx="34.2" cy="33" r="1.3" fill="#93c5fd" opacity="0.95" />
      {/* Lash arcs */}
      <path d="M 18 30 Q 32 20 46 30" fill="none" stroke="#93c5fd" strokeWidth="1" opacity="0.4" />
      <path d="M 18 40 Q 32 50 46 40" fill="none" stroke="#93c5fd" strokeWidth="1" opacity="0.4" />
      {/* Scan line */}
      <line x1="10" y1="35" x2="54" y2="35" stroke="#60a5fa" strokeWidth="0.7" strokeDasharray="2 4" opacity="0.3" />
    </svg>
  );
}
