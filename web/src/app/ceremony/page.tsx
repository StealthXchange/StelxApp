import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { ThemeSection } from "@/components/ThemeSection";
import { CeremonyLive } from "@/components/ceremony/CeremonyLive";

export const metadata: Metadata = {
  title: "The Ceremony · STELX",
  description: "The pool's proving key, built by a crowd, not by us. 31 contributions, sealed on 22 September with Bitcoin block 968,166.",
};

const STEPS = [
  { n: "01", title: "Add your randomness.", body: "Wiggle your mouse. That's it." },
  { n: "02", title: "Throw it away.", body: "Your secret is dropped the moment it's used. It never leaves your browser." },
  { n: "03", title: "Nobody can fake the pool.", body: "Not even us. As long as one person in the crowd was honest, the secret is gone for good." },
];

const ROUNDS = [
  {
    n: "ROUND ONE",
    title: "The foundation.",
    body: "The groundwork every proof of this kind is built on. Anyone can build on it, so it has to be right.",
    when: "Done. 12 contributions, sealed with Bitcoin block 968,040.",
  },
  {
    n: "ROUND TWO",
    title: "Our lock.",
    body: "The same idea, for the exact pool that ships.",
    when: "Done. 31 contributions on 22 September, sealed with Bitcoin block 968,166.",
  },
];

export default function CeremonyPage() {
  return (
    <div className="site">
      <SiteNav />

      <ThemeSection theme="brand" className="cer-hero">
        <div className="cer-wrap">
          <div className="mono cer-kicker">// FINISHED</div>
          <h1 className="display cer-title">The ceremony.</h1>
          <p className="cer-lede">The pool&apos;s lock was built by a crowd. Not by us.</p>
          <div className="cer-date">
            <span className="display">Sealed on 22 Sep with 31 contributions</span>
            <span className="mono">BOTH ROUNDS SEALED &middot; ROUND TWO BEACON: BITCOIN BLOCK 968,166</span>
          </div>
        </div>
      </ThemeSection>

      <ThemeSection theme="light" className="cer-section">
        <div className="cer-wrap">
          <div className="mono cer-kicker">// HOW IT WORKS</div>
          <div className="cer-steps">
            {STEPS.map((s) => (
              <div key={s.n} className="cer-step">
                <span className="mono cer-step-n">{s.n}</span>
                <div>
                  <div className="display cer-step-t">{s.title}</div>
                  <div className="cer-step-b">{s.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </ThemeSection>

      <ThemeSection theme="dark" className="cer-section">
        <div className="cer-wrap">
          <div className="mono cer-kicker">// TWO ROUNDS</div>
          <div className="cer-steps">
            {ROUNDS.map((r) => (
              <div key={r.n} className="cer-step">
                <span className="mono cer-step-n">{r.n}</span>
                <div>
                  <div className="display cer-step-t">{r.title}</div>
                  <div className="cer-step-b">{r.body}</div>
                  <div className="mono cer-step-when">{r.when}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </ThemeSection>

      <ThemeSection theme="light" className="cer-section" id="rsvp">
        <div className="cer-wrap">
          <div className="mono cer-kicker">// THE COUNT</div>
          <CeremonyLive />
        </div>
      </ThemeSection>

      <ThemeSection theme="dark" className="cer-section cer-foot">
        <div className="cer-wrap">
          <div className="mono cer-kicker">// WHY</div>
          <p className="cer-why">
            The proofs that keep your balance private need a starting key. Whoever makes it alone could keep a copy and fake money out of the pool.
            So a crowd made it. Everyone added a twist and threw theirs away. A thief would need every one.
          </p>
          <p className="cer-why cer-why-small">
            Every contribution was checked before it was accepted, and the list is published with a hash for each, so you can find your own.
          </p>
        </div>
      </ThemeSection>
    </div>
  );
}
