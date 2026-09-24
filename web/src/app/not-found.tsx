import Link from "next/link";
import { Mark } from "@/components/icons";

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        gap: 20,
        padding: "0 48px",
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      <Mark size={28} />
      <h1 style={{ fontSize: 40, fontWeight: 650, letterSpacing: "-0.02em", margin: 0 }}>
        Nothing at this address.
      </h1>
      <p style={{ fontSize: 16, lineHeight: 1.6, color: "var(--text-mid)", margin: 0 }}>
        Fitting, for a privacy product.
      </p>
      <div style={{ display: "flex", gap: 12 }}>
        <Link href="/" className="btn btn-primary">Back to home</Link>
        <Link href="/pool" className="btn btn-ghost">Open the wallet</Link>
      </div>
    </main>
  );
}
