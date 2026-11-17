import { JoinForm } from "./JoinForm";
import "./welcome.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Since: you said “not yet”. Since tells you when it’s “now”." };

export default async function Welcome({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const err = (await searchParams).error;
  const booking = process.env.BOOKING_URL || null;
  return (
    <main className="w-main">
      <header className="w-top">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" width={36} height={36} style={{ borderRadius: 9 }} />
        <span className="w-brand">Since</span>
        <a href="#join" className="w-signin">Sign in</a>
      </header>

      <section className="w-hero">
        <div className="w-badge">Winner, Cala challenge · 3rd place, Context.dev · Junction 2026</div>
        <h1>
          You said &ldquo;not yet&rdquo; at Slush.<br />
          <span>Since tells you when it&rsquo;s &ldquo;now&rdquo;.</span>
        </h1>
        <p className="w-sub">
          Every &ldquo;come back when&hellip;&rdquo; becomes a condition Since watches on the live web. When a startup hits your bar,
          you get a Telegram alert with the evidence, and a ready email to get back to the founder.
        </p>
        <div className="w-cta" id="join">
          <JoinForm />
          {booking && <a className="w-ghost" href={booking} target="_blank" rel="noreferrer">Book a 10-min demo at Slush</a>}
        </div>
        {err === "link" && <p className="w-err">That sign-in link has expired or was already used. Enter your email for a new one.</p>}
        <p className="w-fine">Free 30-day pilot for Slush investors. No password: we email you a sign-in link.</p>
      </section>

      <section className="w-video">
        <video src="/since-demo.mp4" poster="/since-demo-poster.jpg" controls playsInline preload="metadata" />
      </section>

      <section className="w-steps">
        {[
          ["1", "Catch every “not yet”", "From your Granola meetings, a forwarded email, or a pasted note. Quoted word for word."],
          ["2", "Since watches", "Context.dev reads the live web, Cala tracks rounds and headcount. Founder claims and independent proof are kept apart."],
          ["3", "Get back in time", "Telegram alert with evidence the moment it’s met, then a drafted reconnect email with your own words."],
        ].map(([n, t, d]) => (
          <div key={n} className="w-step">
            <div className="w-num">{n}</div>
            <h3>{t}</h3>
            <p>{d}</p>
          </div>
        ))}
      </section>

      <footer className="w-foot">Built at Junction 2026 with Context.dev · Cala · Aiven · Granola · ElevenLabs</footer>
    </main>
  );
}
