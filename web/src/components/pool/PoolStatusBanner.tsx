"use client";

import { recheckPool, usePoolHealth } from "@/lib/pool/health";

export function PoolStatusBanner() {
  const health = usePoolHealth();

  if (health.status === "unconfigured") {
    return (
      <div className="notlive" role="status">
        <div className="notlive-in">
          <span className="mono notlive-tag">Pool not live yet</span>
          <p className="notlive-body">
            Look around, but nothing here can take a deposit yet.
          </p>
        </div>
      </div>
    );
  }

  if (health.status === "unreachable") {
    return (
      <div className="notlive" role="alert">
        <div className="notlive-in">
          <span className="mono notlive-tag">The pool isn&apos;t reachable right now</span>
          <p className="notlive-body">
            Deposits, sends and withdrawals are off, and your wallet won&apos;t be asked to sign anything.
          </p>
          <p className="notlive-reason mono">{health.reason}</p>
          <button className="notlive-cta" onClick={() => void recheckPool()}>
            Check again
          </button>
        </div>
      </div>
    );
  }

  return null;
}
