import Link from "next/link";
import { notFound } from "next/navigation";
import { checkToken, draftCopy, loadFacts, renderEmail, smtpConfigured } from "@/lib/reconnect";
import { query } from "@/lib/db";
import { fmtTime } from "@/lib/time";
import { ReconnectEditor } from "./ReconnectEditor";

export const dynamic = "force-dynamic";

export default async function ReconnectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> }) {
  const id = Number((await params).id);
  const t = (await searchParams).t ?? "";
  if (!checkToken(id, t)) {
    return (
      <div className="glass card" style={{ maxWidth: 560 }}>
        <h2 style={{ marginTop: 0 }}>Link not valid</h2>
        <p className="muted">Open the reconnect email from the Telegram alert or the Reconnect button in Since.</p>
      </div>
    );
  }
  const f = await loadFacts(id);
  if (!f) notFound();
  const copy = await draftCopy(f);
  const { html, text } = renderEmail(f, copy);
  const sent = await query<{ sent_at: string; to_email: string }>(
    "SELECT sent_at, to_email FROM reconnects WHERE startup_id = $1 AND status = 'sent' ORDER BY sent_at DESC LIMIT 1",
    [id],
  );
  return (
    <>
      <div className="page-head">
        <div>
          <p style={{ margin: 0 }}>
            <Link href="/" className="muted">Watchlist</Link> <span className="muted">/</span> <span>{f.startup.name}</span>{" "}
            <span className="mono muted">{f.startup.display_domain ?? f.startup.domain}</span>
          </p>
          <h1 style={{ marginTop: 4 }}>Reconnect with {f.startup.founder_name ?? f.startup.name}</h1>
          <p>Every fact in this email comes from Since&rsquo;s evidence. Edit the words, preview, then send. Nothing is sent automatically.</p>
        </div>
      </div>
      {sent[0] && (
        <div className="glass banner" style={{ borderRadius: 16, marginBottom: 14 }}>
          Reconnected {fmtTime(sent[0].sent_at, { alwaysDate: true })} (to {sent[0].to_email})
        </div>
      )}
      <ReconnectEditor
        id={id}
        t={t}
        initial={{ to: f.startup.founder_email ?? "", ...copy }}
        initialHtml={html}
        initialText={text}
        canSend={smtpConfigured()}
      />
    </>
  );
}
