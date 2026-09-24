"use client";

import { useEffect, useRef, useState } from "react";
import { CEREMONY_URL, fetchStatus, type Status } from "@/lib/ceremony/config";

type Phase =
  | { k: "idle" }
  | { k: "queued"; ticket: string; position: number }
  | { k: "entropy"; ticket: string; samples: number }
  | { k: "downloading"; ticket: string }
  | { k: "mixing"; ticket: string }
  | { k: "uploading"; ticket: string }
  | { k: "done"; index: number; sha256: string; name: string }
  | { k: "error"; msg: string };

const NEED = 220;

export function CeremonyLive() {
  const [status, setStatus] = useState<Status | null>(null);
  const [name, setName] = useState("");
  const [rsvpd, setRsvpd] = useState(false);
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const entropy = useRef<string[]>([]);
  const lastSample = useRef<number>(0);
  const padRef = useRef<HTMLCanvasElement | null>(null);
  const trail = useRef<{ x: number; y: number; t: number }[]>([]);

  useEffect(() => {
    let alive = true;
    const tick = async () => { const s = await fetchStatus(); if (alive) setStatus(s); };
    tick();
    const id = CEREMONY_URL ? setInterval(tick, 5000) : undefined;
    return () => { alive = false; if (id) clearInterval(id); };
  }, []);

  useEffect(() => {
    if (phase.k !== "queued") return;
    let alive = true;
    const id = setInterval(async () => {
      try {
        const r = await fetch(`${CEREMONY_URL}/turn?ticket=${phase.ticket}`, { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        if (!r.ok) return fail(j.error ?? "lost your place in the queue");
        if (j.yourTurn) { entropy.current = []; setPhase({ k: "entropy", ticket: phase.ticket, samples: 0 }); }
        else setPhase({ k: "queued", ticket: phase.ticket, position: j.position });
      } catch {  }
    }, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [phase]);

  useEffect(() => {
    if (phase.k !== "entropy") return;
    const pad = padRef.current;
    if (!pad) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = pad.getBoundingClientRect();
    pad.width = Math.round(rect.width * dpr);
    pad.height = Math.round(rect.height * dpr);
    const ctx = pad.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);

    const draw = () => {
      if (!ctx) return;
      ctx.clearRect(0, 0, rect.width, rect.height);
      const pts = trail.current;
      if (pts.length < 2) return;

      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const age = i / pts.length;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = `rgba(253, 97, 49, ${(0.08 + age * 0.9).toFixed(3)})`;
        ctx.lineWidth = 1 + age * 2.4;
        ctx.lineCap = "round";
        ctx.stroke();
      }
    };

    const onMove = (e: MouseEvent | TouchEvent) => {
      const pt = "touches" in e ? e.touches[0] : e;
      if (!pt) return;

      const now = performance.now();
      if (now - lastSample.current < 12) return;
      lastSample.current = now;

      const x = pt.clientX - rect.left;
      const y = pt.clientY - rect.top;
      trail.current.push({ x, y, t: now });
      if (trail.current.length > 90) trail.current.shift();
      draw();

      entropy.current.push(`${Math.round(pt.clientX)},${Math.round(pt.clientY)},${now.toFixed(2)}`);
      const n = entropy.current.length;
      setPhase({ k: "entropy", ticket: phase.ticket, samples: n });
      if (n >= NEED) {
        pad.removeEventListener("mousemove", onMove as EventListener);
        pad.removeEventListener("touchmove", onMove as EventListener);
        trail.current = [];
        contribute(phase.ticket);
      }
    };

    pad.addEventListener("mousemove", onMove as EventListener);
    pad.addEventListener("touchmove", onMove as EventListener, { passive: true });
    return () => {
      pad.removeEventListener("mousemove", onMove as EventListener);
      pad.removeEventListener("touchmove", onMove as EventListener);
    };

  }, [phase.k]);

  function explain(raw: string): { msg: string; rejoin: boolean } {
    const r = raw.toLowerCase();
    if (r.includes("not your turn") || r.includes("unknown ticket"))
      return { msg: "That turn has already been used or has expired. Joining the queue again.", rejoin: true };
    if (r.includes("not open")) return { msg: "Contributions are closed right now. The open times are at the top of this page.", rejoin: false };
    if (r.includes("slow down")) return { msg: "Too many attempts from this connection. Wait a minute and try again.", rejoin: false };
    if (r.includes("failed verification")) return { msg: "That contribution did not verify. Nothing was recorded. Try again.", rejoin: false };
    return { msg: raw, rejoin: false };
  }
  function fail(raw: string) {
    const { msg, rejoin } = explain(raw);
    if (rejoin) { setTimeout(() => { setPhase({ k: "idle" }); join(); }, 1500); }
    setPhase({ k: "error", msg });
  }

  async function rsvp() {
    try {
      await fetch(`${CEREMONY_URL}/rsvp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ handle: name }) });
      setRsvpd(true);
      setStatus(await fetchStatus());
    } catch {  }
  }

  async function join() {
    try {
      const r = await fetch(`${CEREMONY_URL}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      const j = await r.json();
      if (!r.ok) return fail(j.error ?? "could not join");
      setPhase({ k: "queued", ticket: j.ticket, position: j.position });
    } catch (e: any) { fail(String(e?.message ?? e)); }
  }

  async function contribute(ticket: string) {
    try {
      setPhase({ k: "downloading", ticket });

      const r = await fetch(`${CEREMONY_URL}/current?ticket=${ticket}`, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json()).error ?? "could not fetch the current file");
      const baton = await r.arrayBuffer();

      setPhase({ k: "mixing", ticket });

      const rnd = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
      const seed = entropy.current.join("|") + "|" + rnd;
      entropy.current = [];

      const isPhase1 = status?.phase === "phase1";
      const worker = isPhase1
        ? new Worker(new URL("../../lib/ceremony/contribute-phase1.worker.ts", import.meta.url), { type: "module" })
        : new Worker(new URL("../../lib/ceremony/contribute.worker.ts", import.meta.url), { type: "module" });
      const result = await new Promise<{ out: ArrayBuffer; hash: string }>((resolve, reject) => {
        worker.onmessage = (ev) => ("error" in ev.data ? reject(new Error(ev.data.error)) : resolve(ev.data));
        worker.onerror = (ev) => reject(new Error(ev.message));
        worker.postMessage(
          isPhase1
            ? { ptau: baton, name: name || "anon", entropy: seed }
            : { zkey: baton, name: name || "anon", entropy: seed },
          [baton],
        );
      });
      worker.terminate();

      setPhase({ k: "uploading", ticket });
      const up = await fetch(`${CEREMONY_URL}/contribute?ticket=${ticket}`, {
        method: "POST", headers: { "content-type": "application/octet-stream", "x-name": name || "anon" }, body: result.out,
      });
      const j = await up.json();
      if (!up.ok) throw new Error(j.error ?? "contribution rejected");
      setPhase({ k: "done", index: j.index, sha256: j.sha256, name: j.name });
      setStatus(await fetchStatus());
    } catch (e: any) { fail(String(e?.message ?? e)); }
  }

  const n = status?.contributions.length ?? 0;
  const closed = status?.mode === "closed";
  const shareText = phase.k === "done"
    ? `I helped build the lock. Contributor #${String(phase.index).padStart(4, "0")} of the STELX ceremony. stelx.app/ceremony`
    : "";

  return (
    <div className="cer-live">
      {closed ? (
        <div className="cer-stats">
          <div className="cer-stat"><div className="cer-stat-n">{n}</div><div className="cer-stat-l">Contributions</div></div>
          <div className="cer-stat"><div className="cer-stat-n">22 Sep</div><div className="cer-stat-l">Sealed</div></div>
          <div className="cer-stat"><div className="cer-stat-n">968,166</div><div className="cer-stat-l">Bitcoin block</div></div>
        </div>
      ) : (
        <div className="cer-stats">
          <div className="cer-stat"><div className="cer-stat-n">{status ? status.rsvps : "—"}</div><div className="cer-stat-l">RSVPs</div></div>
          <div className="cer-stat"><div className="cer-stat-n">{status ? n : "—"}</div><div className="cer-stat-l">Contributions</div></div>
          <div className="cer-stat"><div className="cer-stat-n">{status ? status.floor : "—"}</div><div className="cer-stat-l">Minimum to launch</div></div>
        </div>
      )}

      {!CEREMONY_URL && closed && <p className="cer-note">The ceremony is finished. Thank you to everyone who took part.</p>}

      {CEREMONY_URL && phase.k === "idle" && status && !status.open && (
        <p className="cer-note">
          {status.mode === "closed"
            ? "The ceremony is finished. Thank you to everyone who took part."
            : "Closed right now. Open times are at the top of this page."}
        </p>
      )}

      {CEREMONY_URL && phase.k === "idle" && (!status || status.open) && (
        <div className="cer-form">
          <input className="cer-input mono" placeholder="name or handle (it goes in the public record)" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          <button className="btn" onClick={join}>Contribute now</button>
        </div>
      )}

      {phase.k === "queued" && (
        <div className="cer-panel">
          <div className="mono cer-kicker">// IN THE QUEUE</div>
          <div className="cer-big">{phase.position === 0 ? "You're up." : `${phase.position} ahead of you`}</div>
          <p className="cer-note">Keep this tab open. Your turn starts automatically.</p>
        </div>
      )}

      {phase.k === "entropy" && (
        <div className="cer-panel">
          <div className="mono cer-kicker">// YOUR TURN</div>
          <div className="cer-big">Wiggle your mouse in the box.</div>

          <canvas ref={padRef} className="cer-pad" />
          <div className="cer-bar"><div className="cer-bar-fill" style={{ width: `${Math.min(100, (phase.samples / NEED) * 100)}%` }} /></div>
          <p className="cer-note">That movement is your randomness. It never leaves this device.</p>
        </div>
      )}

      {(phase.k === "downloading" || phase.k === "mixing" || phase.k === "uploading") && (
        <div className="cer-panel">
          <div className="mono cer-kicker">// WORKING</div>
          <div className="cer-big">
            {phase.k === "downloading" && "Fetching the file…"}
            {phase.k === "mixing" && "Mixing in your randomness…"}
            {phase.k === "uploading" && "Handing it on…"}
          </div>

          <div className="cer-bar cer-bar-indef"><div className="cer-bar-sweep" /></div>
          <p className="cer-note">
            {phase.k === "mixing"
              ? "A few seconds, on this device. Keep the tab open."
              : "Keep this tab open."}
          </p>
        </div>
      )}

      {phase.k === "done" && (
        <div className="cer-done">
          <div className="cer-card">
            <div className="cer-card-brand mono">STELX</div>
            <div className="cer-card-kicker mono">// I HELPED BUILD THE LOCK</div>
            <div className="cer-card-title display">Contributor<br />#{String(phase.index).padStart(4, "0")}</div>
            <div className="cer-card-foot mono">{phase.sha256.slice(0, 4)}…{phase.sha256.slice(-4)} · secret discarded · stelx.app/ceremony</div>
          </div>
          <a className="btn" href={`https://x.com/intent/post?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer">Share on X</a>
        </div>
      )}

      {phase.k === "error" && (
        <div className="cer-panel">
          <div className="mono cer-kicker">// SOMETHING WENT WRONG</div>
          <p className="cer-note">{phase.msg}</p>
          <button className="btn" onClick={() => setPhase({ k: "idle" })}>Try again</button>
        </div>
      )}
    </div>
  );
}
