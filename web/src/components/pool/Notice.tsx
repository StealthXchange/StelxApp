"use client";

import Link from "next/link";
import { AlertTriangle } from "@/components/icons";

export function Notice({ children, tone }: { children: React.ReactNode; tone?: "amber" }) {
  return (
    <div
      className="card"
      style={{
        padding: "16px 20px", display: "flex", gap: 12, alignItems: "flex-start",
        borderColor: tone === "amber" ? "var(--amber-border)" : "var(--border)",
        background: tone === "amber" ? "var(--amber-dim)" : undefined,
      }}
    >
      <AlertTriangle color={tone === "amber" ? "var(--amber)" : "var(--text-low)"} />
      <div style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--text-mid)" }}>{children}</div>
    </div>
  );
}

export function NeedsWallet({ title }: { title: string }) {
  return (
    <>
      <header className="page-head"><h1>{title}</h1></header>
      <div className="page-body" style={{ maxWidth: 620 }}>
        <section className="card" style={{ padding: "24px 26px" }}>
          <p style={{ fontSize: 14.5, lineHeight: 1.65, color: "var(--text-mid)", margin: "0 0 16px" }}>
            You need a pool wallet first.
          </p>
          <Link href="/pool/setup" className="btn">Create or recover a wallet</Link>
        </section>
      </div>
    </>
  );
}
