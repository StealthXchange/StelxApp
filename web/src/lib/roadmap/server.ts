import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const URL_ = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

export const configured = () =>
  Boolean(URL_ && TOKEN && handles().length > 0 && (process.env.ROADMAP_PASSWORD ?? "").length >= 12);

export const handles = () => (process.env.ROADMAP_TEAM ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export function passwordOk(given: unknown): boolean {
  const want = process.env.ROADMAP_PASSWORD ?? "";
  if (typeof given !== "string" || want.length < 12) return false;
  const h = (x: string) => createHash("sha256").update(x).digest();
  return timingSafeEqual(h(given), h(want));
}

export function visitor(req: Request): string {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  return createHash("sha256").update(`${process.env.ROADMAP_PASSWORD ?? ""}:${TOKEN ?? ""}:${ip}`).digest("hex").slice(0, 32);
}

export async function limited(key: string, max: number, seconds = 3600): Promise<boolean> {
  const n = await redis<number>("INCR", key);
  if (n === 1) await redis("EXPIRE", key, seconds);
  return n > max;
}

export async function redis<T = unknown>(...cmd: (string | number)[]): Promise<T> {
  if (!URL_ || !TOKEN) throw new Error("roadmap storage is not set up");
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error ?? `storage ${r.status}`);
  return j.result as T;
}

export const newId = () => randomBytes(9).toString("base64url");

const SESSION = "stelx_rm";
const DAYS = 30;

export async function startSession(handle: string): Promise<void> {
  const token = randomBytes(24).toString("base64url");
  await redis("SET", `rm:sess:${token}`, handle, "EX", DAYS * 86400);
  (await cookies()).set(SESSION, token, {
    httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: DAYS * 86400,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION)?.value;
  if (token) await redis("DEL", `rm:sess:${token}`).catch(() => {});
  jar.delete(SESSION);
}

export async function whoami(): Promise<string | null> {
  if (!configured()) return null;
  const token = (await cookies()).get(SESSION)?.value;
  if (!token || !/^[\w-]{20,64}$/.test(token)) return null;
  const handle = await redis<string | null>("GET", `rm:sess:${token}`);
  return handle && handles().includes(handle) ? handle : null;
}

export function sameSiteJson(req: Request): boolean {
  const ct = req.headers.get("content-type") ?? "";
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  return ct.startsWith("application/json") && (!origin || new URL(origin).host === host);
}

export const clean = (s: unknown, max: number) =>
  typeof s === "string" ? s.replace(/\r/g, "").trim().slice(0, max) : "";

export function mentionsIn(text: string): string[] {
  const names = handles();
  const found = new Set<string>();
  for (const m of text.matchAll(/@([A-Za-z0-9_]+)/g)) {
    const hit = names.find((n) => n.toLowerCase() === m[1].toLowerCase());
    if (hit) found.add(hit);
  }
  return [...found];
}
