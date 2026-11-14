"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// The signed-in investor (single-user app): name + fund from Settings → Email signature.
export function Account() {
  const [a, setA] = useState({ name: "Daria Matviichuk", fund: "Northstar Ventures" });
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((j) => j.settings && setA({ name: j.settings["investor.name"] || a.name, fund: j.settings["investor.fund"] || a.fund }))
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const initials = a.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <Link href="/settings" className="account" title="Signed in">
      <span className="account-avatar">{initials}</span>
      <span style={{ minWidth: 0 }}>
        <span className="account-name">{a.name}</span>
        <span className="account-fund">{a.fund}</span>
      </span>
    </Link>
  );
}
