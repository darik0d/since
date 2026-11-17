import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Nav } from "@/components/Nav";
import { Account } from "@/components/Account";
import { currentUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Since",
  description: "Investors say “not yet” and promise to keep in touch. They never do. Since does.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser().catch(() => null);
  if (!user) {
    // logged out: the landing page, no app chrome
    return (
      <html lang="en" className={`${inter.variable} ${mono.variable}`}>
        <body>{children}</body>
      </html>
    );
  }
  const s = await getSettings(user.id);
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>
        <div className="shell">
          <aside className="glass sidebar">
            <div className="brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="Since" width={32} height={32} className="brand-logo" />
              <div>
                <div className="brand-name">Since</div>
                <div className="brand-sub">Your &ldquo;not yet&rdquo;, watched</div>
              </div>
            </div>
            <Nav isAdmin={user.is_admin} />
            <Account name={s["investor.name"] || user.email.split("@")[0]} fund={s["investor.fund"] || user.email} />
            <div className="sidebar-foot">Monitored with Context.dev &amp; Cala</div>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
