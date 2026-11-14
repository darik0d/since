import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Nav } from "@/components/Nav";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Since",
  description: "Investors say “not yet” and promise to keep in touch. They never do. Since does.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>
        <div className="shell">
          <aside className="glass sidebar">
            <div className="brand">
              <div className="brand-mark">S</div>
              <div>
                <div className="brand-name">Since</div>
                <div className="brand-sub">Your &ldquo;not yet&rdquo;, watched</div>
              </div>
            </div>
            <Nav />
            <div className="sidebar-foot">Monitored with Context.dev</div>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
