import Link from "next/link";
import { CheckCircle, Eye, Mark, GITHUB_URL } from "@/components/icons";

const GUARANTEES = [
  "Value cannot be minted.",
  "A note cannot be spent twice.",
  "A broadcaster cannot alter what it submits.",
  "A full tree never locks your funds.",
  "Your seed rebuilds everything. No server holds anything.",
];

const HIDDEN = [
  "Your balance in the pool, and every note that makes it up",
  "Who you pay privately, and how much",
  "Which of the pool's deposits funded a given private send",
];

const PUBLIC = [
  "Every deposit: the amount, and the wallet it came from",
  "Every withdrawal: the amount, and the address it lands on",
  "The timing of both, and the broadcaster fee",
];

export default function ArchitecturePage() {
  return (
    <div>

      <div style={{ borderBottom: "1px solid var(--border-faint)" }}>
        <div className="container" style={{ height: 76, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 14, color: "var(--text-hi)" }}>
            <Mark size={34} />
            <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: "0.14em" }}>STELX</span>
          </Link>
          <nav className="landing-nav" aria-label="Site">
            <Link href="/" className="nav-link" style={{ color: "var(--text-mid)" }}>Home</Link>
            <Link href="/privacy" className="nav-link" style={{ color: "var(--text-mid)" }}>Privacy Center</Link>
            <Link href="/pool" className="btn btn-ghost" style={{ minHeight: 42 }}>Open the wallet</Link>
          </nav>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 80, paddingBottom: 56 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 820 }}>
          <div className="mono-label accent">Architecture</div>
          <h1 style={{ fontSize: 48, lineHeight: 1.08, fontWeight: 650, letterSpacing: "-0.02em", margin: 0 }}>
            A shielded pool, built on proven parts.
          </h1>
          <p style={{ fontSize: 17, lineHeight: 1.65, color: "var(--text-mid)", margin: 0 }}>
            Deposit once and your balance leaves the public ledger.
          </p>
          <div className="mono" style={{ fontSize: 11.5, letterSpacing: "0.1em", color: "var(--text-low)" }}>
            200+ TESTS. PROVING KEY FROM A PUBLIC CEREMONY.{" "}
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>OPEN SOURCE ON GITHUB.</a>
          </div>
        </div>
      </div>

      <div className="band" style={{ borderTop: "1px solid var(--border-faint)" }}>
        <div className="container" style={{ paddingTop: 72, paddingBottom: 72 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 36 }}>
            <div className="mono-label accent">The note</div>
            <h2 className="section-title">Your balance is a set of secrets, not an entry in a ledger</h2>
            <p style={{ fontSize: 15.5, lineHeight: 1.6, color: "var(--text-mid)", maxWidth: 720, margin: 0 }}>
              A deposit creates a <span className="mono" style={{ color: "var(--text-hi)" }}>note</span>.
              The chain stores a commitment to it. Nothing else.
            </p>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-low)", maxWidth: 760, marginTop: 20 }}>
            Spending proves you know the secrets behind one commitment in the tree, without
            revealing which. Your key never leaves the device.
          </p>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 72, paddingBottom: 72 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 36 }}>
          <div className="mono-label accent">The broadcaster problem</div>
          <h2 className="section-title">Someone else pays your gas, and still cannot touch anything</h2>
          <p style={{ fontSize: 15.5, lineHeight: 1.6, color: "var(--text-mid)", maxWidth: 760, margin: 0 }}>
            The gas payer is public, so someone else submits for you, paid from inside the pool.
            They can&apos;t change a byte of it.
          </p>
        </div>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-low)", maxWidth: 760, marginTop: 20 }}>
          Change the recipient, amount or fee and the proof fails. The worst a broadcaster can do is
          refuse, and you use another.
        </p>
      </div>

      <div className="band">
        <div className="container" style={{ paddingTop: 72, paddingBottom: 72 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 36 }}>
            <h2 className="section-title">Guarantees the system enforces, not promises we make</h2>
          </div>
          <div className="grid-2">
            {GUARANTEES.map((g) => (
              <div key={g} className="card" style={{ padding: "20px 22px", display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span style={{ flexShrink: 0, marginTop: 2 }}><CheckCircle size={18} /></span>
                <span style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-mid)" }}>{g}</span>
              </div>
            ))}
          </div>
          <div className="mono" style={{ fontSize: 12, letterSpacing: "0.06em", color: "var(--text-low)", marginTop: 24 }}>
            200+ checks, 27 adversarial cases, real proofs.
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 72, paddingBottom: 72 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 36 }}>
          <h2 className="section-title">What&apos;s hidden. What isn&apos;t.</h2>
          <p style={{ fontSize: 15.5, lineHeight: 1.6, color: "var(--text-mid)", maxWidth: 760, margin: 0 }}>
            The pool hides the middle, not the edges. Money in and out is public.
          </p>
        </div>
        <div className="grid-2">
          <div className="card" style={{ padding: 26, borderColor: "var(--accent-border)" }}>
            <div className="mono-label" style={{ color: "var(--accent)", marginBottom: 16 }}>Hidden</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {HIDDEN.map((t) => (
                <div key={t} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span style={{ flexShrink: 0, marginTop: 1 }}><CheckCircle /></span>
                  <span style={{ fontSize: 15, lineHeight: 1.55 }}>{t}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card" style={{ padding: 26 }}>
            <div className="mono-label" style={{ marginBottom: 16 }}>Stays public</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {PUBLIC.map((t) => (
                <div key={t} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span style={{ flexShrink: 0, marginTop: 1 }}><Eye /></span>
                  <span style={{ fontSize: 15, lineHeight: 1.55, color: "var(--text-mid)" }}>{t}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="band">
        <div className="container" style={{ paddingTop: 72, paddingBottom: 72 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 36 }}>
            <div className="mono-label accent">Known weaknesses</div>
            <h2 className="section-title">Written down before anyone finds them</h2>
          </div>
          <div className="grid-3">
            <TechCard
              title="Trusted setup"
              body="The proving key came from a public ceremony with 31 contributions. It holds if at least one contributor in each round destroyed their secret. That is the trust you place."
            />
            <TechCard
              title="Amount correlation"
              body="Withdraw exactly what you deposited and the two link. Fixed denominations would fix it. Not built yet."
            />
            <TechCard
              title="A small pool hides little"
              body="Privacy comes from the crowd, and the crowd is small for now."
            />
          </div>
          <div className="card" style={{ padding: "20px 26px", marginTop: 20, display: "flex", gap: 14, alignItems: "flex-start" }}>
            <span className="chip amber" style={{ flexShrink: 0 }}>EARLY</span>
            <p style={{ fontSize: 14, lineHeight: 1.65, color: "var(--text-mid)", margin: 0 }}>
              The pool is new and small, so the crowd you hide in is small. Start with amounts you can afford to
              have linked.
            </p>
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 32 }}>
            <Link href="/pool" className="btn btn-primary">Open the wallet</Link>
            <Link href="/" className="btn btn-ghost">Back to home</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function TechCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="card" style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontSize: 14.5, fontWeight: 650 }}>{title}</span>
      <span style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-mid)" }}>{body}</span>
    </div>
  );
}
