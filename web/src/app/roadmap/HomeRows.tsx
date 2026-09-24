"use client";

import { useEffect, useState } from "react";
import { ITEMS, STATUS_LABEL, type Status } from "./items";

const ORDER: Status[] = ["live", "building", "next", "later"];

export function HomeRows() {
  const [status, setStatus] = useState<Record<string, Status>>({});
  useEffect(() => {
    let live = true;
    fetch("/api/roadmap/state").then((r) => r.json()).then((j) => { if (live && j.status) setStatus(j.status); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const now = ITEMS.map((i) => ({ ...i, now: status[i.id] ?? i.status }));
  return (
    <div className="road-rows">
      {ORDER.map((st) => {
        const list = now.filter((i) => i.now === st);
        const more = list.length - 2;
        return (
          <div key={st} className="road-row">
            <span className="road-num">{list.length}</span>
            <span className="road-name">{STATUS_LABEL[st]}</span>
            <span className="road-status">
              {list.slice(0, 2).map((i) => i.title).join(", ")}{more > 0 ? ` +${more}` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
