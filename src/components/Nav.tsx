"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const icons = {
  list: <path d="M4 6h16M4 12h16M4 18h10" />,
  plus: <path d="M12 5v14M5 12h14" />,
  inbox: <path d="M4 13h4l2 3h4l2-3h4M5 5h14l2 8v6H3v-6z" />,
  bolt: <path d="M13 3 4 14h7l-1 7 9-11h-7z" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.8-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.8 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 10h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1z" />
    </>
  ),
};

const links: { href: string; label: string; icon: keyof typeof icons }[] = [
  { href: "/", label: "Watchlist", icon: "list" },
  { href: "/new", label: "New “not yet”", icon: "plus" },
  { href: "/inbox", label: "Inbox", icon: "inbox" },
  { href: "/webhooks", label: "Webhook log", icon: "bolt" },
  { href: "/admin", label: "Admin", icon: "bolt" },
  { href: "/settings", label: "Notifications", icon: "gear" },
];

export function Nav({ isAdmin = false }: { isAdmin?: boolean }) {
  const path = usePathname();
  const [pending, setPending] = useState(0);
  useEffect(() => {
    const load = () => fetch("/api/inbound").then((r) => r.json()).then((j) => setPending(j.pending ?? 0)).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [path]);
  return (
    <>
      {links.filter((l) => isAdmin || !["/webhooks", "/admin"].includes(l.href)).map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={`nav-link${active ? " active" : ""}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {icons[l.icon]}
            </svg>
            {l.label}
            {l.href === "/inbox" && pending > 0 && <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 650, color: "#fff", background: "#2563eb", borderRadius: 999, padding: "1px 7px" }}>{pending}</span>}
          </Link>
        );
      })}
    </>
  );
}
