"use client";

import { useState } from "react";
import Link from "next/link";
import { usePool } from "@/lib/pool/usePool";

export default function ReceivePage() {
  const pool = usePool();
  const [copied, setCopied] = useState(false);

  if (!pool.address) {
    return (
      <div className="wallet-empty">
        <h1 className="wallet-empty-title">No wallet here yet</h1>
        <Link href="/pool/setup" className="btn">Create a wallet</Link>
      </div>
    );
  }

  return (
    <div className="wallet">
      <h1 className="pane-title">Receive</h1>

      <div className="card addr-card">
        <div className="mono field-label">Your pool address</div>
        <code className="mono addr-full">{pool.address}</code>
        <button
          className="btn"
          onClick={() => {
            navigator.clipboard?.writeText(pool.address ?? "");
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <p className="hint">Share this to be paid privately. It cannot spend.</p>
    </div>
  );
}
