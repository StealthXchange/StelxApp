export function GeoVisual({ variant }: { variant: "signature" | "crowd" | "vault" }) {
  return (
    <div className="geo">
      <svg viewBox="0 0 400 300" width="100%" height="100%" role="img" aria-label="" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#F4F3F0" />
            <stop offset="1" stopColor="#DAD8D2" />
          </linearGradient>
          <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#BFBDB7" />
            <stop offset="1" stopColor="#9C9A94" />
          </linearGradient>
        </defs>
        <rect width="400" height="300" fill="url(#g1)" />
        {variant === "signature" ? (
          <g>
            <polygon points="40,220 250,90 330,130 120,260" fill="url(#g2)" />
            <polygon points="120,260 330,130 330,150 120,280" fill="#7E7C76" />
            <polygon points="80,170 230,80 292,110 142,200" fill="#EDEBE6" />
            <rect x="150" y="128" width="130" height="10" rx="1" transform="rotate(-31 215 133)" fill="#E8551E" />
          </g>
        ) : null}
        {variant === "crowd" ? (
          <g stroke="#8F8D87" strokeWidth="3" strokeLinecap="round" fill="none">
            {[0, 1, 2, 3].map((r) =>
              [0, 1, 2, 3, 4].map((c) => {
                const x = 60 + c * 70;
                const y = 55 + r * 60;
                const hot = r === 1 && c === 2;
                return (
                  <g key={`${r}-${c}`} stroke={hot ? "#E8551E" : undefined}>
                    <path d={`M${x + 14} ${y - 14}L${x - 14} ${y + 14}`} />
                    <path d={`M${x - 14} ${y - 14}l8.6 8.6`} />
                    <path d={`M${x + 5.4} ${y + 5.4}l8.6 8.6`} />
                  </g>
                );
              }),
            )}
          </g>
        ) : null}
        {variant === "vault" ? (
          <g fill="none" stroke="#8F8D87" strokeWidth="2">
            <rect x="60" y="40" width="280" height="220" />
            <rect x="100" y="70" width="200" height="160" />
            <rect x="140" y="100" width="120" height="100" />
            <rect x="180" y="130" width="40" height="40" stroke="#E8551E" strokeWidth="3" />
          </g>
        ) : null}
      </svg>
    </div>
  );
}
