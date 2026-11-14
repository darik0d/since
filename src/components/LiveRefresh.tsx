"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-render the server page every few seconds so webhook-driven changes appear without a reload. */
export function LiveRefresh({ everyMs = 3000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => clearInterval(t);
  }, [router, everyMs]);
  return null;
}
