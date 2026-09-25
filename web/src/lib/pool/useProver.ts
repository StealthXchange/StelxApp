"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { POOL_CHAIN_ID, poolAddress, poolDeployBlock, POOL_RPC } from "./config.ts";

export type Stage = "idle" | "artifacts" | "scanning" | "proving" | "submitting" | "done" | "error";

export interface ProverState {
  stage: Stage;
  detail: string | null;
  downloaded: number;
  downloadTotal: number;
  elapsed: number;
  error: string | null;
  tx: { to: string; data: string; summary: string } | null;
}

const INITIAL: ProverState = {
  stage: "idle", detail: null, downloaded: 0, downloadTotal: 0, elapsed: 0, error: null, tx: null,
};

export interface ProverDeployment { rpc: string; chainId: number; pool: Address; deployBlock: bigint }

export function useProver(mnemonic: string | null, deployment?: ProverDeployment) {
  const [state, setState] = useState<ProverState>(INITIAL);
  const workerRef = useRef<Worker | null>(null);
  const startedRef = useRef<number>(0);

  useEffect(() => {
    if (state.stage === "idle" || state.stage === "done" || state.stage === "error") return;
    const t = setInterval(() => {
      setState((s) => ({ ...s, elapsed: Math.round((Date.now() - startedRef.current) / 1000) }));
    }, 1000);
    return () => clearInterval(t);
  }, [state.stage]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const build = useCallback(
    (kind: "transfer" | "unshield", token: Address, to: string, amount: bigint, broadcaster: string, broadcasterAddress: string, fee: bigint) => {
      if (!mnemonic) { setState({ ...INITIAL, stage: "error", error: "No wallet loaded." }); return; }

      workerRef.current?.terminate();
      const worker = new Worker(new URL("./prove.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      startedRef.current = Date.now();
      setState({ ...INITIAL, stage: "artifacts", detail: "Preparing" });

      worker.onmessage = (e: MessageEvent<any>) => {
        const m = e.data;
        if (m.type === "download") {
          setState((s) => ({ ...s, stage: "artifacts", downloaded: m.loaded, downloadTotal: m.total }));
        } else if (m.type === "progress") {
          setState((s) => ({ ...s, stage: m.stage as Stage, detail: m.detail ?? null }));
        } else if (m.type === "built") {
          setState((s) => ({ ...s, stage: "done", tx: m.tx, detail: null }));
        } else if (m.type === "error") {
          setState((s) => ({ ...s, stage: "error", error: m.message }));
        }
      };
      worker.onerror = (err) => {
        setState((s) => ({ ...s, stage: "error", error: err.message || "The prover failed to start." }));
      };

      worker.postMessage({
        type: "init",
        mnemonic,
        config: {
          rpc: deployment?.rpc ?? POOL_RPC,
          chainId: deployment?.chainId ?? POOL_CHAIN_ID,
          pool: deployment?.pool ?? poolAddress(),
          deployBlock: (deployment?.deployBlock ?? poolDeployBlock()).toString(),
        },
      });
      worker.postMessage({
        type: "build", kind, token, to, amount: amount.toString(), broadcaster, broadcasterAddress, fee: fee.toString(),
      });
    },
    [mnemonic, deployment],
  );

  const reset = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setState(INITIAL);
  }, []);

  const setSubmitting = useCallback(() => setState((s) => ({ ...s, stage: "submitting" })), []);

  return { state, build, reset, setSubmitting };
}

export function stageLabel(s: ProverState): string {
  switch (s.stage) {
    case "artifacts": return s.downloadTotal > 0 && s.downloaded < s.downloadTotal
      ? `Downloading proving key · ${(s.downloaded / 1e6).toFixed(1)} of ${(s.downloadTotal / 1e6).toFixed(0)} MB`
      : "Preparing the prover";
    case "scanning": return "Reading your notes from the chain";
    case "proving": return "Building the proof";
    case "submitting": return "Sending to the broadcaster";
    case "done": return "Ready";
    case "error": return "Failed";
    default: return "";
  }
}
