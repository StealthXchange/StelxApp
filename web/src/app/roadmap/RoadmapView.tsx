"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mark, GITHUB_URL } from "@/components/icons";
import s from "./roadmap.module.css";
import { CATEGORIES, DEVS, ITEMS, STATUS_LABEL, type CategoryId, type Dev, type Item, type Note, type Status } from "./items";

const ORDER: Status[] = ["live", "building", "next", "later"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const when = (n: { at?: number; date: string }) => n.at ?? Date.UTC(2026, MONTHS.indexOf(n.date.split(" ")[1]), Number(n.date.split(" ")[0]), 12);
const dayOf = (ms: number) => { const d = new Date(ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

interface LiveNote extends Note { id?: string; at?: number }
interface Chat { id: string; by: string; at: number; text: string; mentions: string[] }
interface Reply { id: string; idea: string; by: string; at: number; text: string }
interface Idea { id: string; text: string; from: string; at: number; approved: boolean; votes: number; replies?: Reply[] }
interface State {
  ready: boolean; me?: string | null; ideas?: Idea[];
  notes?: { id: string; itemId: string; by: string; at: number; text: string }[];
  ticks?: Record<string, string>; status?: Record<string, Status>; dev?: Record<string, Dev>;
  chat?: Chat[]; seen?: number;
}

async function api(path: string, method: string, body?: unknown) {
  const r = await fetch(`/api/roadmap/${path}`, {
    method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Failed (${r.status})`);
  return j;
}

function World() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const N = 640;
    c.width = c.height = N;
    const k = c.getContext("2d");
    if (!k) return;
    const im = k.createImageData(N, N), d = im.data;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const nx = (x - N / 2) / (N / 2 - 2), ny = (y - N / 2) / (N / 2 - 2), rr = nx * nx + ny * ny;
      if (rr > 1) continue;
      const z = Math.sqrt(1 - rr);
      const v = Math.sin(nx * 8 + ny * 3 + z * 4) + 0.54 * Math.sin(nx * 21 - ny * 13 + z * 11) + 0.22 * Math.sin(nx * 63 + ny * 44);
      let h = ((x * 73856093) ^ (y * 19349663)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
      const noise = (h & 65535) / 65535;
      const light = Math.min(1, Math.max(0, -nx * 0.24 - ny * 0.57 + z * 0.74));
      const contour = Math.pow(0.5 + 0.5 * Math.sin(v * 13 + ny * 9), 20);
      const a = 0.3 + 0.65 * light + noise * 0.12 - contour * 0.27;
      const i = (y * N + x) * 4;
      d[i] = 253 * a; d[i + 1] = 97 * a; d[i + 2] = 49 * a;
      d[i + 3] = Math.min(1, (1 - Math.sqrt(rr)) * N / 2) * 255;
    }
    k.putImageData(im, 0, 0);
  }, []);
  return <canvas ref={ref} className={`${s.world} roadmap-world`} aria-hidden />;
}

function Bar({ done, total }: { done: number; total: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const lit = Math.round((done / total) * 20);
  return (
    <div className={s.bar} ref={ref}>
      <div className={s.dots} aria-label={`${done} of ${total} milestones done`}>
        {Array.from({ length: 20 }, (_, i) => (
          <span key={i} className={s.dotCell} data-on={seen && i < lit} style={{ transitionDelay: `${i * 45}ms` }} />
        ))}
      </div>
      <span className={s.frac}>{done} / {total}</span>
    </div>
  );
}

function WithMentions({ text }: { text: string }) {
  return <>{text.split(/(@[A-Za-z0-9_]+)/g).map((p, i) => p.startsWith("@") ? <b key={i} className={s.mention}>{p}</b> : p)}</>;
}

interface View { item: Item; status: Status; dev: Dev; ticks: boolean[]; notes: LiveNote[] }

function Card({ v, open, onToggle, me, onChange }: {
  v: View; open: boolean; onToggle: () => void; me: string | null; onChange: () => void;
}) {
  const { item } = v;
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const done = v.ticks.filter(Boolean).length;

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setErr(null);
    try { await fn(); onChange(); } catch (e) { setErr(String((e as Error).message)); } finally { setBusy(false); }
  }

  return (
    <div className={s.card} data-status={v.status} data-open={open}>
      <div role="button" tabIndex={0} className={s.cardHit} onClick={onToggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }} aria-expanded={open}>
        <div className={s.cardTop}>
          <span className={s.chip} data-status={v.status}>{STATUS_LABEL[v.status]}</span>
          <span className={s.who}><span className={s.devDot} /><b>{v.dev}</b></span>
        </div>
        <h3 className={s.cardTitle}>{item.title}</h3>
        <p className={s.cardLine}>{item.line}</p>
        {(v.status === "building" || v.status === "live") && <Bar done={done} total={item.milestones.length} />}
        {!open && v.notes.length > 0 && (
          <div className={s.notesLabel} style={{ marginTop: 14, marginBottom: 0 }}>{v.notes.length} NOTE{v.notes.length > 1 ? "S" : ""}</div>
        )}
      </div>

      {open && (
        <>
          <ul className={s.steps}>
            {item.milestones.map(([t], idx) => (
              <li key={t} className={s.step} data-done={v.ticks[idx]}>
                {me ? (
                  <button className={s.tick} disabled={busy} aria-label={v.ticks[idx] ? `Untick ${t}` : `Tick ${t}`}
                    onClick={() => act(() => api("items", "POST", { itemId: item.id, milestone: idx, done: !v.ticks[idx] }))}>
                    {v.ticks[idx] ? "✓" : ""}
                  </button>
                ) : <span className={s.tick}>{v.ticks[idx] ? "✓" : ""}</span>}
                {t}
              </li>
            ))}
          </ul>

          {me && (
            <div className={s.editRow}>
              <select className={s.select} value={v.status} disabled={busy}
                onChange={(e) => act(() => api("items", "POST", { itemId: item.id, status: e.target.value }))}>
                {ORDER.map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
              </select>
              <select className={s.select} value={v.dev} disabled={busy}
                onChange={(e) => act(() => api("items", "POST", { itemId: item.id, dev: e.target.value }))}>
                {DEVS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}

          {(v.notes.length > 0 || me) && (
            <div className={s.notes}>
              <div className={s.notesLabel}>NOTES</div>
              {v.notes.map((n) => (
                <p key={(n.id ?? n.date) + n.text.slice(0, 12)} className={s.note}>
                  <span className={s.noteMeta}>
                    {n.date} · {n.by}
                    {me && n.id && n.by === me && (
                      <button className={s.linkBtn} disabled={busy} onClick={() => act(() => api("notes", "DELETE", { id: n.id }))}>delete</button>
                    )}
                  </span>
                  <WithMentions text={n.text} />
                </p>
              ))}
              {me && (
                <div className={s.compose}>
                  <textarea className={s.textarea} rows={2} maxLength={1000} placeholder="add a note…" value={draft} onChange={(e) => setDraft(e.target.value)} />
                  <button className={s.post} disabled={busy || !draft.trim()}
                    onClick={() => act(async () => { await api("notes", "POST", { itemId: item.id, text: draft }); setDraft(""); })}>
                    Post
                  </button>
                </div>
              )}
            </div>
          )}
          {err && <p className={s.err}>{err}</p>}
        </>
      )}
    </div>
  );
}

function Ideas({ ideas, me, onChange, bare = false }: { ideas: Idea[]; me: string | null; onChange: () => void; bare?: boolean }) {
  const [text, setText] = useState("");
  const [from, setFrom] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [voted, setVoted] = useState<Set<string>>(new Set());

  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reply, setReply] = useState("");

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true); setMsg(null);
    try { await fn(); if (ok) setMsg(ok); onChange(); } catch (e) { setMsg(String((e as Error).message)); } finally { setBusy(false); }
  }

  return (
    <section className={s.feed} aria-label="Suggest and browse ideas">
      {!bare && <h2 className={s.feedHead}>Community ideas</h2>}
      <div className={s.ideaForm}>
        <textarea className={s.textarea} rows={3} maxLength={500} aria-label="Your idea" placeholder="what should we build next?" value={text} onChange={(e) => setText(e.target.value)} />
        <div className={s.ideaRow}>
          <input className={s.input} maxLength={30} aria-label="Your X handle (optional)" placeholder="your X handle (optional)" value={from} onChange={(e) => setFrom(e.target.value)} />
          <button className={s.post} disabled={busy || text.trim().length < 6}
            onClick={() => act(async () => { await api("ideas", "POST", { text, from }); setText(""); setFrom(""); }, "Thanks. It shows here once the team has read it.")}>
            Suggest
          </button>
        </div>
        {msg && <p className={s.ideaMsg} role="status">{msg}</p>}
      </div>
      <div className={s.feedList}>
        {ideas.length === 0 && <p className={s.chatEmpty}>no ideas yet, be the first</p>}
        {ideas.map((i) => (
          <div key={i.id} className={s.idea} data-pending={!i.approved}>
            <button className={s.vote} disabled={busy || !i.approved || voted.has(i.id)} aria-label="Upvote"
              onClick={() => act(async () => { await api("ideas", "POST", { vote: i.id }); setVoted((v) => new Set(v).add(i.id)); })}>
              <span>▲</span>{i.votes}
            </button>
            <div>
              <p className={s.feedText}>{i.text}</p>
              <div className={s.feedWhen}>
                {i.from ? `${i.from.startsWith("@") ? "" : "@"}${i.from}` : "anon"} · {dayOf(i.at)}
                {!i.approved && " · waiting for approval"}
              </div>
              {(i.replies ?? []).length > 0 && (
                <div className={s.replies}>
                  {(i.replies ?? []).map((r) => (
                    <div key={r.id} className={s.reply}>
                      <p className={s.replyText}>{r.text}</p>
                      <div className={s.feedWhen}>
                        {r.by} · team · {dayOf(r.at)}
                        {me === r.by && (
                          <button className={s.linkBtn} disabled={busy} onClick={() => act(() => api("ideas", "POST", { unreply: `${i.id}:${r.id}` }))}>remove</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {me && replyTo === i.id && (
                <div className={s.replyForm}>
                  <textarea className={s.textarea} rows={2} maxLength={500} aria-label="Your reply" placeholder="reply as the team…" autoFocus
                    value={reply} onChange={(e) => setReply(e.target.value)} />
                  <div className={s.ideaRow}>
                    <button className={s.post} disabled={busy || !reply.trim()}
                      onClick={() => act(async () => { await api("ideas", "POST", { reply: i.id, text: reply }); setReply(""); setReplyTo(null); })}>
                      Reply
                    </button>
                    <button className={s.linkBtn} disabled={busy} onClick={() => { setReplyTo(null); setReply(""); }}>cancel</button>
                  </div>
                </div>
              )}
              {me && (
                <div className={s.ideaTeam}>
                  {replyTo !== i.id && <button className={s.linkBtn} disabled={busy} onClick={() => { setReplyTo(i.id); setReply(""); }}>reply</button>}
                  {!i.approved && <button className={s.linkBtn} disabled={busy} onClick={() => act(() => api("ideas", "POST", { approve: i.id }))}>approve</button>}
                  <button className={s.linkBtn} disabled={busy} onClick={() => act(() => api("ideas", "POST", { remove: i.id }))}>remove</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TeamChat({ me, chat: initial, seen, active, onChange }: { me: string | null; chat: Chat[]; seen: number; active: boolean; onChange: () => void }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [fresh, setFresh] = useState<Chat[] | null>(null);
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/roadmap/chat", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!stop && Array.isArray(j.chat)) setFresh(j.chat); }).catch(() => {});
    };
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 4000);
    return () => { stop = true; clearTimeout(first); clearInterval(t); };
  }, [active]);
  const chat = fresh && (fresh[0]?.at ?? 0) >= (initial[0]?.at ?? 0) ? fresh : initial;
  const list = [...chat].reverse();
  const latestId = chat[0]?.id;
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [active, latestId]);

  useEffect(() => {
    if (active && me) void api("chat", "POST", { seen: true }).then(onChange).catch(() => {});
  }, [active, me, latestId, onChange]);

  async function send() {
    if (busy || !draft.trim()) return;
    setBusy(true); setErr(null);
    try { await api("chat", "POST", { text: draft }); setDraft(""); onChange(); }
    catch (e) { setErr(String((e as Error).message)); } finally { setBusy(false); }
  }

  return (
    <section className={s.chat} aria-label="Team conversation">
      <div className={s.chatList} role="log" aria-label="Team messages">
        {list.length === 0 && <p className={s.chatEmpty}>nothing yet</p>}
        {list.map((m) => (
          <div key={m.id} className={s.msg} data-me={m.by === me} data-new={!!me && m.mentions.includes(me) && m.at > seen}>
            <span className={s.msgMeta}>{m.by} · {dayOf(m.at)} {new Date(m.at).toISOString().slice(11, 16)} UTC</span>
            <span className={s.msgText}><WithMentions text={m.text} /></span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {me ? (
        <>
          <div className={s.mentionRow}>
            {DEVS.filter((d) => d !== me).map((d) => (
              <button key={d} className={s.mentionBtn} onClick={() => setDraft((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}@${d.toLowerCase()} `)}>@{d.toLowerCase()}</button>
            ))}
          </div>
          <div className={s.compose}>
            <textarea className={s.textarea} rows={3} maxLength={1000} aria-label="Message the team" placeholder="spitball an idea, @ someone…" value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
            <button className={s.post} disabled={busy || !draft.trim()} onClick={send}>Send</button>
          </div>
        </>
      ) : (
        <p className={s.chatNote} style={{ marginTop: 12 }}>Only Rome, Kaka and Eddy can post here. Got an idea? Add it to Community ideas.</p>
      )}
      {err && <p className={s.err} role="alert">{err}</p>}
    </section>
  );
}

export function RoadmapView() {
  const [cat, setCat] = useState<CategoryId | "all">("all");
  const [dev, setDev] = useState<Dev | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [live, setLive] = useState<State>({ ready: false });
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);
  const teamDialog = useRef<HTMLDialogElement>(null);
  const me = live.me ?? null;
  const teamVisible = teamOpen;
  const [ideasOpen, setIdeasOpen] = useState(false);
  const ideasDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ideasDialog.current;
    if (!ideasOpen || !dialog) return;
    const overflow = document.body.style.overflow;
    if (!dialog.open) dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = overflow;
    };
  }, [ideasOpen]);

  useEffect(() => {
    const dialog = teamDialog.current;
    if (!teamVisible || !dialog) return;
    const overflow = document.body.style.overflow;
    if (!dialog.open) dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = overflow;
    };
  }, [teamVisible]);

  const load = useCallback(async () => {
    try { setLive(await api("state", "GET")); } catch {  }
  }, []);
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), 20_000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [load]);

  const [showLogin, setShowLogin] = useState(false);
  const [who, setWho] = useState<Dev>("Rome");
  const [pw, setPw] = useState("");
  async function signIn() {
    setLoginErr(null);
    try {
      await api("login", "POST", { name: who, password: pw });
      setPw(""); setShowLogin(false);
      await load();
    } catch (e) { setLoginErr(String((e as Error).message)); }
  }
  async function signOut() { await api("login", "DELETE").catch(() => {}); await load(); }

  const views: View[] = useMemo(() => ITEMS.map((item) => ({
    item,
    status: live.status?.[item.id] ?? item.status,
    dev: live.dev?.[item.id] ?? item.dev,
    ticks: item.milestones.map(([, d], idx) => { const t = live.ticks?.[`${item.id}:${idx}`]; return t === undefined ? d : t === "1"; }),
    notes: [
      ...(live.notes ?? []).filter((n) => n.itemId === item.id).map((n) => ({ id: n.id, at: n.at, by: n.by as Dev, date: dayOf(n.at), text: n.text })),
      ...(item.notes ?? []),
    ],
  })), [live]);

  const counts = ORDER.map((st) => [st, views.filter((v) => v.status === st).length] as const);
  const shown = (c: CategoryId) =>
    views.filter((v) => v.item.cat === c && (!dev || v.dev === dev)).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const feed = views.flatMap((v) => v.notes.map((n) => ({ ...n, item: v.item })))
    .sort((a, b) => when(b) - when(a))
    .slice(0, 10);
  const unread = me && live.chat ? live.chat.filter((m) => m.mentions.includes(me) && m.at > (live.seen ?? 0)).length : 0;

  return (
    <div className={s.page}>
      <World />
      <div className={s.inner}>
        <header className={s.top} data-team={live.ready}>
          <Link href="/" className={s.brand}><Mark size={30} /> STELX</Link>
          <nav className={s.topLinks}>
            <Link href="/pool">Wallet</Link>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
            {live.ready && (me ? (
              <button className={s.teamBtn} onClick={signOut}>
                @{me.toLowerCase()} · sign out
              </button>
            ) : (
              <button className={s.teamBtn} onClick={() => setShowLogin(!showLogin)}>Team</button>
            ))}
          </nav>
          {live.ready && (
            <div className={s.launches}>
              <button type="button" className={s.teamLaunch} aria-haspopup="dialog" aria-controls="team-ideas"
                aria-expanded={teamVisible} onClick={() => setTeamOpen(true)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                  <path d="M7 9h10M7 13h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                Team ideas
                {unread > 0 && <span className={s.badge} aria-label={`${unread} unread mentions`}>{unread}</span>}
              </button>
              <button type="button" className={s.teamLaunch} data-variant="ghost" aria-haspopup="dialog" aria-controls="community-ideas"
                aria-expanded={ideasOpen} onClick={() => setIdeasOpen(true)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.9V16h5v-.2c0-.8.4-1.5 1-1.9A6 6 0 0 0 12 3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                </svg>
                Community ideas
                {me && (live.ideas ?? []).some((i) => !i.approved) && (
                  <span className={s.badge} style={{ background: "var(--r-orange)", color: "#fff" }} aria-label="Ideas waiting for approval">
                    {(live.ideas ?? []).filter((i) => !i.approved).length}
                  </span>
                )}
              </button>
            </div>
          )}
        </header>
        {showLogin && !me && (
          <form className={s.login} onSubmit={(e) => { e.preventDefault(); void signIn(); }}>
            <select className={s.select} value={who} onChange={(e) => setWho(e.target.value as Dev)} aria-label="Who are you">
              {DEVS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <input className={s.input} type="password" autoComplete="current-password" placeholder="team password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <button className={s.post} disabled={!pw}>Sign in</button>
          </form>
        )}
        {loginErr && <p className={s.err} style={{ textAlign: "right" }}>{loginErr}</p>}

        <section className={s.hero}>
          <div className={s.kicker}>STELX · WHAT WE&apos;RE BUILDING</div>
          <h1 className={s.title}>ROAD<span>MAP</span></h1>
          <p className={s.lede}>What&apos;s live, what&apos;s being built, and who&apos;s on it. Progress moves only when a step is done.</p>
          <div className={s.counts}>
            {counts.map(([st, n]) => (
              <span key={st} className={s.count}><b>{n}</b>{STATUS_LABEL[st].toUpperCase()}</span>
            ))}
          </div>
        </section>

        <div className={s.controls}>
          <div className={s.tabs} role="tablist">
            {([["all", "All"], ...CATEGORIES.map((c) => [c.id, c.name])] as [CategoryId | "all", string][]).map(([id, name]) => (
              <button key={id} className={s.tab} data-on={cat === id} onClick={() => setCat(id)} role="tab" aria-selected={cat === id}>{name}</button>
            ))}
          </div>
          <div className={s.devs}>
            {DEVS.map((d) => (
              <button key={d} className={s.dev} data-on={dev === d} onClick={() => setDev(dev === d ? null : d)}>
                <span className={s.devDot} />{d} · {views.filter((v) => v.dev === d).length}
              </button>
            ))}
          </div>
        </div>

        {CATEGORIES.filter((c) => cat === "all" || cat === c.id).map((c) => {
          const list = shown(c.id);
          if (list.length === 0) return null;
          return (
            <section key={c.id} className={s.cat}>
              <div className={s.catHead}>
                <h2 className={s.catName}>{c.name}</h2>
                <p className={s.catLine}>{c.line}</p>
                <span className={s.catNum}>{list.filter((v) => v.status === "live").length} / {list.length} LIVE</span>
              </div>
              <div className={s.grid}>
                {list.map((v) => (
                  <Card key={v.item.id} v={v} me={me} onChange={load}
                    open={open === v.item.id} onToggle={() => setOpen(open === v.item.id ? null : v.item.id)} />
                ))}
              </div>
            </section>
          );
        })}

        <section className={s.feed}>
          <h2 className={s.feedHead}>Notes</h2>
          <div className={s.feedList}>
            {feed.map((n) => (
              <div key={(n.id ?? n.item.id) + n.text.slice(0, 12)} className={s.feedItem}>
                <div>
                  <div className={s.feedWhat}>{n.item.title}</div>
                  <div className={s.feedWhen}>{n.date} · {n.by}</div>
                </div>
                <p className={s.feedText}><WithMentions text={n.text} /></p>
              </div>
            ))}
          </div>
        </section>

        <p className={s.foot}>Tap a card for its steps and notes. Follow along on <a href="https://x.com/StelXchange" target="_blank" rel="noopener noreferrer">X</a>.</p>
      </div>
      <dialog ref={teamDialog} id="team-ideas" className={s.teamDialog} aria-labelledby="team-ideas-title"
        data-lenis-prevent onClose={(e) => { if (!e.currentTarget.open) setTeamOpen(false); }}
        onClick={(e) => { if (e.target === e.currentTarget) setTeamOpen(false); }}>
        <div className={s.teamPanel}>
          <div className={s.teamHeader}>
            <div>
              <h2 id="team-ideas-title">Team ideas</h2>
              <p>Spitballing, in the open. Only Rome, Kaka and Eddy can post.</p>
            </div>
            <button type="button" className={s.teamClose} aria-label="Close team ideas" autoFocus
              onClick={() => setTeamOpen(false)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <TeamChat key={me ?? "public"} me={me} chat={live.chat ?? []} seen={live.seen ?? 0} active={teamVisible} onChange={load} />
        </div>
      </dialog>
      <dialog ref={ideasDialog} id="community-ideas" className={s.teamDialog} aria-labelledby="community-ideas-title"
        data-lenis-prevent onClose={(e) => { if (!e.currentTarget.open) setIdeasOpen(false); }}
        onClick={(e) => { if (e.target === e.currentTarget) setIdeasOpen(false); }}>
        <div className={s.teamPanel}>
          <div className={s.teamHeader}>
            <div>
              <h2 id="community-ideas-title">Community ideas</h2>
              <p>What should we build next? Upvote the ones you want.</p>
            </div>
            <button type="button" className={s.teamClose} aria-label="Close community ideas" onClick={() => setIdeasOpen(false)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className={s.ideasBody}>
            <Ideas ideas={live.ideas ?? []} me={me} onChange={load} bare />
          </div>
        </div>
      </dialog>
      <style>{`@keyframes roadmapSpin{to{transform:translateX(-50%) rotate(360deg)}}.roadmap-world{animation:roadmapSpin 240s linear infinite}@media (prefers-reduced-motion:reduce){.roadmap-world{animation:none}}`}</style>
    </div>
  );
}
