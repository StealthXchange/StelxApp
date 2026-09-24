import Link from "next/link";

export function BlockButton({ href, label, invert = false }: { href: string; label: string; invert?: boolean }) {
  const cls = invert ? "blk blk-invert" : "blk";
  return (
    <Link href={href} className={cls}>
      <span className="blk-icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M19.5 4.5L4.5 19.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M4.5 4.5l4.6 4.6" stroke="var(--brand)" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M14.9 14.9l4.6 4.6" stroke="var(--brand)" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </span>
      <span className="blk-label">
        <span className="blk-slide">
          <span className="blk-text">{label}</span>
          <span className="blk-text" aria-hidden="true">{label}</span>
        </span>
      </span>
    </Link>
  );
}
