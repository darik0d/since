"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function AutoRefresh({ everyMs = 5000 }: { everyMs?: number }) {
  const router = useRouter();
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [on, everyMs, router]);
  return (
    <button className="btn" onClick={() => setOn((v) => !v)}>
      <span className="dot-live" style={on ? undefined : { background: "#94a3b8", boxShadow: "none" }} />
      {on ? "Live" : "Paused"}
    </button>
  );
}
