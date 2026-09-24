import { CheckCircle, Eye } from "@/components/icons";

const HIDDEN = [
  "Your balance in the pool",
  "Who you pay privately, and how much",
  "Which deposit a withdrawal came from, unless you give it away",
  "What you hold, even when dollar prices load: every asset's price comes at once",
];

const PUBLIC = [
  "Every deposit: the amount and the wallet it came from",
  "Every withdrawal: the amount and the address it lands on",
  "The timing of both, and the broadcaster fee",
];

const BREAKS = [
  {
    title: "Withdraw the amount you deposited",
    body: "Deposits and withdrawals are both public. Matching amounts link them by arithmetic alone.",
  },
  {
    title: "Withdraw to a wallet you deposited from",
    body: "That links them again, for good.",
  },
  {
    title: "Move straight through",
    body: "Withdrawing minutes after depositing links the two by timing while the pool is small.",
  },
  {
    title: "Share your pool address",
    body: "Anyone you give it to can see your deposits and the wallets they came from. To get paid privately, give out a second pool wallet you never deposit into.",
  },
];

const STOCK_POWERS = [
  {
    title: "Freeze",
    body: "Robinhood can block any address, including the pool, from moving stock tokens. If it blocks the pool, no one can deposit or withdraw stock tokens until it lifts the block.",
  },
  {
    title: "Pause",
    body: "Robinhood can pause one stock token or all of them. A paused token can't move in or out.",
  },
  {
    title: "Burn",
    body: "Robinhood can destroy stock tokens held by any address, including the pool. Then the pool couldn't pay everyone holding that stock: the first to withdraw would be paid in full, the last might not be.",
  },
  {
    title: "Splits and dividends",
    body: "These change how many shares each token represents. Your token balance stays the same; its worth in shares doesn't.",
  },
];

const DESIGNED_AGAINST = ["Balance surveillance", "Payment graph analysis", "A hostile broadcaster"];
const OUT_OF_SCOPE = [
  "IP metadata",
  "A compromised browser",
  "Amount correlation",
  "Timing correlation",
  "A pool with few users",
];

export default function PrivacyCenterPage() {
  return (
    <>
      <header className="page-head">
        <h1>Privacy Center</h1>
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-low)" }}>
          SHIELDED POOL
        </span>
      </header>
      <div className="page-body" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--text-mid)", maxWidth: 760, margin: 0 }}>
          What STELX hides and what it doesn&apos;t. The pool is small, so anything that depends on a big crowd
          doesn&apos;t hold yet.
        </p>

        <div className="grid-2" style={{ gap: 20 }}>
          <section className="card" style={{ padding: "20px 22px", borderColor: "var(--accent-border)" }}>
            <div className="mono-label" style={{ color: "var(--accent)", marginBottom: 14 }}>Hidden</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {HIDDEN.map((t) => (
                <div key={t} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ flexShrink: 0, marginTop: 2 }}><CheckCircle size={16} /></span>
                  <span style={{ fontSize: 13.5, lineHeight: 1.55 }}>{t}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="card" style={{ padding: "20px 22px" }}>
            <div className="mono-label" style={{ marginBottom: 14 }}>Stays public</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {PUBLIC.map((t) => (
                <div key={t} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ flexShrink: 0, marginTop: 2 }}><Eye size={16} /></span>
                  <span style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--text-mid)" }}>{t}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="card" style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 style={{ fontSize: 14.5, fontWeight: 650, margin: 0 }}>How to lose your privacy</h2>
          <div className="grid-2" style={{ gap: 20 }}>
            {BREAKS.map((b) => (
              <div
                key={b.title}
                style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--border)", paddingTop: 12 }}
              >
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{b.title}</span>
                <span style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--text-mid)" }}>{b.body}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card" style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 12, borderColor: "var(--amber-border)" }}>
          <h2 style={{ fontSize: 14.5, fontWeight: 650, margin: 0 }}>Stock tokens: what Robinhood can still do</h2>
          <p style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--text-mid)", margin: 0 }}>
            Robinhood issues stock tokens and keeps control of them, in the pool or not.
          </p>
          <div className="grid-2" style={{ gap: 16 }}>
            {STOCK_POWERS.map((p) => (
              <div key={p.title} style={{ display: "flex", flexDirection: "column", gap: 4, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{p.title}</span>
                <span style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--text-mid)" }}>{p.body}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-mid)", margin: 0 }}>
            Each asset&apos;s books are separate, so none of this touches your WETH or other assets. We can&apos;t
            change any of it: holding a stock token here means trusting Robinhood not to use these powers against it.
          </p>
        </section>

        <div className="grid-2" style={{ gap: 20 }}>
          <section className="card" style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 style={{ fontSize: 14.5, fontWeight: 650, margin: 0 }}>Designed against</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {DESIGNED_AGAINST.map((t) => (
                <span key={t} className="chip" style={{ color: "var(--text-mid)", fontSize: 11, padding: "6px 10px" }}>{t}</span>
              ))}
            </div>
          </section>
          <section className="card" style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 style={{ fontSize: 14.5, fontWeight: 650, margin: 0 }}>Out of scope</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {OUT_OF_SCOPE.map((t) => (
                <span key={t} className="chip muted" style={{ fontSize: 11, padding: "6px 10px" }}>{t}</span>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
