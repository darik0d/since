import Link from "next/link";

// The signed-in investor (name + fund from Settings → Email signature), with sign out.
export function Account({ name, fund }: { name: string; fund: string }) {
  const initials = name.split(/[\s.@_-]+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="account">
      <span className="account-avatar">{initials}</span>
      <Link href="/settings" style={{ minWidth: 0, flex: 1 }} title="Settings">
        <span className="account-name">{name}</span>
        <span className="account-fund">{fund}</span>
      </Link>
      <form action="/api/auth/logout" method="post">
        <button className="account-out" title="Sign out" aria-label="Sign out">⎋</button>
      </form>
    </div>
  );
}
