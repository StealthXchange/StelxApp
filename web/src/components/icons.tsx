import {
  CheckCircle as PhCheckCircle,
  Eye as PhEye,
  ShieldCheck as PhShield,
  Clock as PhClock,
  ArrowRight as PhArrowRight,
  ListBullets as PhList,
  ArrowsClockwise as PhRefresh,
  Warning as PhWarning,
  XLogo as PhXLogo,
  GithubLogo as PhGithubLogo,
} from "@phosphor-icons/react/dist/ssr";

interface IconProps {
  size?: number;
  color?: string;
}

const WEIGHT = "regular" as const;

export function CheckCircle({ size = 18, color = "var(--accent)" }: IconProps) {
  return <PhCheckCircle size={size} color={color} weight={WEIGHT} aria-hidden="true" />;
}
export function Eye({ size = 18, color = "var(--text-low)" }: IconProps) {
  return <PhEye size={size} color={color} weight={WEIGHT} aria-hidden="true" />;
}
export function Shield({ size = 18, color = "var(--text-mid)" }: IconProps) {
  return <PhShield size={size} color={color} weight={WEIGHT} aria-hidden="true" />;
}
export function Clock({ size = 18, color = "var(--text-mid)" }: IconProps) {
  return <PhClock size={size} color={color} weight={WEIGHT} aria-hidden="true" />;
}
export function BuyArrow({ size = 18, color = "var(--text-mid)" }: IconProps) {
  return <PhArrowRight size={size} color={color} weight={WEIGHT} aria-hidden="true" />;
}
export function RegistryList({ size = 18, color = "var(--text-mid)" }: IconProps) {
  return <PhList size={size} color={color} weight={WEIGHT} aria-hidden="true" />;
}
export function Refresh({ size = 18, color = "var(--text-mid)" }: IconProps) {
  return <PhRefresh size={size} color={color} weight={WEIGHT} aria-hidden="true" />;
}
export function AlertTriangle({ size = 16, color = "var(--amber)" }: IconProps) {
  return <PhWarning size={size} color={color} weight={WEIGHT} aria-hidden="true" />;
}

export function XLogo({ size = 18, color = "currentColor" }: IconProps) {
  return <PhXLogo size={size} color={color} weight={WEIGHT} aria-hidden="true" />;
}
export function GitHubLogo({ size = 18, color = "currentColor" }: IconProps) {
  return <PhGithubLogo size={size} color={color} weight={WEIGHT} aria-hidden="true" />;
}
export const GITHUB_URL = "https://github.com/StealthXchange/StelxApp";
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-label="STELX">
      <path d="M19.5 4.5L4.5 19.5" stroke="var(--text-hi)" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M4.5 4.5l4.6 4.6" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M14.9 14.9l4.6 4.6" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function SeveredX({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10.5" stroke="var(--accent)" strokeWidth="1.5" />
      <path d="M8.2 8.2l7.6 7.6M15.8 8.2l-7.6 7.6" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
