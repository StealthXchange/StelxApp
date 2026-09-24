"use client";

import Image from "next/image";
import { useState } from "react";

const SHOTS = [
  { key: "deposit", label: "DEPOSIT", src: "/shots/5-deposit-v2.png", note: "Wrap, approve, deposit. Public, and it says so." },
  { key: "overview", label: "BALANCE", src: "/shots/4-overview-v2.png", note: "Rebuilt from the chain each time you open it." },
  { key: "send", label: "SEND", src: "/shots/6-send-v2.png", note: "To a pool address. No sender, recipient or amount on chain." },
  { key: "withdraw", label: "WITHDRAW", src: "/shots/7-withdraw-v2.png", note: "Out to any public address. Destination and amount are public." },
] as const;

export function ShotStrip() {
  const [active, setActive] = useState(1);
  const shot = SHOTS[active];

  return (
    <div className="shots">
      <div className="shots-tabs" role="tablist" aria-label="Wallet screens">
        {SHOTS.map((s, i) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={i === active}
            className={i === active ? "shots-tab active" : "shots-tab"}
            onClick={() => setActive(i)}
          >
            <span className="mono">// {s.label}</span>
          </button>
        ))}
      </div>

      <div className="shots-frame">
        <Image
          src={shot.src}
          alt={`STELX wallet: ${shot.label.toLowerCase()}`}
          width={1400}
          height={950}
          priority={active === 1}
          className="shots-img"
        />
      </div>
      <p className="shots-note mono">{shot.note}</p>
    </div>
  );
}
