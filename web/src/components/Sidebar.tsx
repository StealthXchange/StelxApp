"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatedMark } from "@/components/AnimatedMark";
import { BuyArrow, RegistryList, Shield } from "@/components/icons";
import { CHAIN } from "@/lib/pool/config";
import { usePoolHealth, type PoolHealth } from "@/lib/pool/health";

const NAV = [
  { href: "/pool", label: "Shielded pool", short: "Pool", Icon: Shield },
  { href: "/pool/pay", label: "Pay anywhere", short: "Pay", Icon: BuyArrow },
  { href: "/privacy", label: "Privacy Center", short: "Privacy", Icon: RegistryList },
] as const;

function poolLine(h: PoolHealth): string {
  switch (h.status) {
    case "ok": return "POOL LIVE";
    case "checking": return "CHECKING THE POOL";
    case "unconfigured": return "POOL NOT LIVE YET";
    case "unreachable": return "POOL NOT REACHABLE";
  }
}

export function Sidebar() {
  const pathname = usePathname();
  const health = usePoolHealth();
  return (
    <aside className="sidebar">
      <Link href="/" className="sidebar-brand">
        <AnimatedMark size={32} hoverReplay={false} />
        <span>STELX</span>
      </Link>
      <nav className="sidebar-nav" aria-label="App">
        {NAV.map(({ href, label, short, Icon }) => {

          const active = href === "/pool" ? pathname.startsWith(href) && !pathname.startsWith("/pool/pay") : pathname.startsWith(href);
          const color = active ? "var(--accent)" : "var(--text-mid)";
          return (
            <Link key={href} href={href} className={active ? "nav-item active" : "nav-item"} aria-label={label} title={label}>
              <Icon color={color} />
              <span className="nav-long">{label}</span>
              <span className="nav-short">{short}</span>
            </Link>
          );
        })}
        {process.env.NEXT_PUBLIC_STELX_POOL_ADDRESS && (
          <Link href="/stelx-pool" className="nav-item" aria-label="STELX token pool" title="STELX token pool">
            <Shield color="var(--text-mid)" />
            <span className="nav-long">STELX token pool</span>
            <span className="nav-short">STELX</span>
          </Link>
        )}
      </nav>
      <div style={{ flex: 1 }} />
      <div className="sidebar-foot">
        <div
          className="mono"
          style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--text-low)", lineHeight: 1.7 }}
        >
          {poolLine(health)}
          <br />
          {CHAIN.name.toUpperCase()}
        </div>
      </div>
    </aside>
  );
}
