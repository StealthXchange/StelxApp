import Link from "next/link";
import { BlockButton } from "@/components/BlockButton";
import { HeroTrack } from "@/components/HeroTrack";
import { Mark, XLogo, GitHubLogo, GITHUB_URL } from "@/components/icons";
import { ShotStrip } from "@/components/ShotStrip";
import { SiteNav } from "@/components/SiteNav";
import { SmoothScroll } from "@/components/SmoothScroll";
import { ThemeSection } from "@/components/ThemeSection";
import { WordReveal } from "@/components/WordReveal";
import { HomeRows } from "@/app/roadmap/HomeRows";

const STEPS = [
  {
    n: "01",
    title: "Deposit",
    body: "Move WETH, USDG or any stock token into the pool. This step is public: your address and the amount go on chain.",
  },
  {
    n: "02",
    title: "Send privately",
    body: "Pay any pool address. The chain sees a transaction and nothing else: no sender, recipient, amount or ticker.",
  },
  {
    n: "03",
    title: "Withdraw",
    body: "Out to any public address. The destination and amount are public again.",
  },
];

const TRUTHS = [
  {
    title: "Every ticker, one pool",
    body: "Every stock and ETF token on the chain, plus WETH and USDG, in one pool so the crowd stays big.",
  },
  {
    title: "Your balance is yours alone",
    body: "Only your phrase can spend it. What you're sent privately, only you can read.",
  },
  {
    title: "A seed phrase is the whole wallet",
    body: "Twelve words rebuild your balance and history on any device. No account, nothing on a server.",
  },
  {
    title: "Someone else pays your gas",
    body: "A broadcaster submits your transaction, paid from inside the pool. The proof seals recipient, amount and fee, so it can't change them.",
  },
];

const TOKEN_CA = "0x7a8cda6a1cab3e5146cd13cb623a3bb284fb4ad1";

export default function Landing() {
  return (
    <div className="site">
      <SmoothScroll />
      <SiteNav />

      <ThemeSection theme="brand" className="s-hero">
        <HeroTrack />
      </ThemeSection>

      <div className="explainer-wrap">
        <ThemeSection theme="dark" className="s-explainer">
          <div className="x-field" aria-hidden="true" />
          <WordReveal
            className="display explainer-copy"
            text="Every wallet is a public feed. Your balance, every payment, every counterparty, forever. STELX is a wallet where that is not true."
          />
        </ThemeSection>
      </div>

      <ThemeSection theme="light" id="wallet" className="s-shots">
        <div className="shots-head">
          <span className="mono road-label">The wallet</span>
          <h2 className="display shots-title">Shield, send, withdraw. Nothing to install.</h2>
          <p className="shots-lede">
            Runs in your browser. Keys and proofs stay on your device.
          </p>
        </div>
        <ShotStrip />
        <div className="shots-cta">
          <BlockButton href="/pool" label="Open the wallet" />
        </div>
      </ThemeSection>

      <ThemeSection theme="light" id="how" className="s-steps">
        <span className="mono road-label">How it works</span>
        <div className="steps-grid">
          {STEPS.map((s) => (
            <div key={s.n} className="step">
              <span className="mono step-n">{s.n}</span>
              <h3 className="step-title">{s.title}</h3>
              <p className="step-body">{s.body}</p>
            </div>
          ))}
        </div>
      </ThemeSection>

      <ThemeSection theme="light" id="security" className="s-truths">
        <span className="mono road-label">What holds</span>
        <div className="truths-grid">
          {TRUTHS.map((t) => (
            <div key={t.title} className="truth">
              <h3 className="truth-title">{t.title}</h3>
              <p className="truth-body">{t.body}</p>
            </div>
          ))}
        </div>
      </ThemeSection>

      <ThemeSection theme="light" className="s-status">
        <span className="mono road-label">Status</span>
        <div className="status-grid">
          <div className="status-item">
            <div className="status-value">Robinhood Chain</div>
            <div className="status-note">Read the Privacy Center before you deposit.</div>
          </div>
          <div className="status-item">
            <div className="status-value">Open source</div>
            <div className="status-note">
              Contracts, circuit, wallet and relay are on{" "}
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>GitHub</a>.
            </div>
          </div>
          <div className="status-item">
            <div className="status-value">200+ tests</div>
            <div className="status-note">
              Circuit, contracts, client and broadcaster, with real proofs verified on chain.
            </div>
          </div>
          <div className="status-item">
            <div className="status-value">Ceremony</div>
            <div className="status-note">
              Proving key made in public: 31 contributions, sealed on 22 September with Bitcoin block 968,166. One
              honest contributor is enough.
            </div>
          </div>
        </div>
        <p className="status-foot">
          Known weaknesses are listed on the Architecture page.
        </p>
      </ThemeSection>

      <ThemeSection theme="dark" navTheme="brand" id="roadmap" className="s-roadmap">
        <div className="road-panel">
          <span className="road-label">Roadmap</span>
          <div>
            <h2 className="display road-title">What we&apos;re building.</h2>
            <HomeRows />
            <div style={{ marginTop: 32 }}>
              <BlockButton href="/roadmap" label="Open the roadmap" />
            </div>
          </div>
        </div>
      </ThemeSection>

      <footer className="s-footer">
        <div className="foot-brand">
          <Mark size={18} />
          <span>STELX</span>
        </div>
        <p className="foot-note">
          STELX is not a broker, issuer or exchange of record. The pool hides your balance and private sends.
          Deposits and withdrawals are public. The token is separate from the pool.
        </p>
        <nav className="foot-links" aria-label="Footer" style={{ flexWrap: "wrap", rowGap: 14 }}>
          <Link href="/pool">Wallet</Link>
          <Link href="/architecture">Architecture</Link>
          <Link href="/roadmap">Roadmap</Link>
          <Link href="/privacy">Privacy Center</Link>
          <a href={GITHUB_URL} className="foot-x" target="_blank" rel="noopener noreferrer" aria-label="STELX on GitHub"><GitHubLogo size={16} /> GitHub</a>
          <a href="https://x.com/StelXchange" className="foot-x" target="_blank" rel="noopener noreferrer" aria-label="STELX on X"><XLogo size={16} /> @StelXchange</a>
        </nav>

        <p className="foot-ca mono">
          <span className="foot-ca-l">$STELX on Robinhood Chain</span>
          <span className="foot-ca-v" title="Contract address">{TOKEN_CA}</span>
        </p>
      </footer>
    </div>
  );
}
