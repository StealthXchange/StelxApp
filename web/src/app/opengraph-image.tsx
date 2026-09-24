import { ImageResponse } from "next/og";

export const alt = "STELX: privacy stocks on Robinhood Chain";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#141416",
          color: "#F2F1EE",
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
            <path d="M19.5 4.5L4.5 19.5" stroke="#F2F1EE" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M4.5 4.5l4.6 4.6" stroke="#E8551E" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M14.9 14.9l4.6 4.6" stroke="#E8551E" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 700, letterSpacing: 6 }}>STELX</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ display: "flex", fontSize: 24, color: "#E8551E", letterSpacing: 5 }}>
            PRIVACY STOCKS ON ROBINHOOD CHAIN
          </div>
          <div style={{ display: "flex", fontSize: 66, fontWeight: 700, lineHeight: 1.05, maxWidth: 920 }}>
            Buy stocks on-chain. Nobody sees it was you.
          </div>
          <div style={{ display: "flex", fontSize: 26, color: "#A3A3A8", maxWidth: 840, lineHeight: 1.4 }}>
            Your wallet funds it. A fresh address holds it. Nothing visible connects the two.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
