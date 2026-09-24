export const CEREMONY_URL: string = "";
const FINAL_RECORD = "/ceremony/final-status.json";

export type Phase = "phase1" | "phase2";

export type Status = {
  phase?: Phase;
  mode: "rehearsal" | "live" | "closed";
  open: boolean;
  floor: number;
  windowEnd: string | null;
  rsvps: number;
  contributions: { index: number; name: string; sha256: string; at: string }[];
  queue: number;
  turnMs: number;
};

export async function fetchStatus(): Promise<Status | null> {
  try {
    const r = await fetch(CEREMONY_URL ? `${CEREMONY_URL}/status` : FINAL_RECORD, { cache: "no-store" });
    return r.ok ? ((await r.json()) as Status) : null;
  } catch {
    return null;
  }
}
