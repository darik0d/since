export const dynamic = "force-dynamic";

export default function Settings() {
  const telegram = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p>Where Since tells you a condition was met. Only working channels are shown.</p>
        </div>
      </div>
      <div className="grid-2">
        <div className="glass card">
          <h2>Telegram</h2>
          <p className="muted" style={{ margin: 0 }}>
            {telegram ? "Bot configured." : "Not configured yet (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)."}
          </p>
        </div>
        <div className="glass card">
          <h2>Alert me when a condition becomes</h2>
          <ul className="muted" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            <li>Confirmed: always on</li>
            <li>Reported (founder-reported): on</li>
            <li>Needs review: off</li>
          </ul>
        </div>
      </div>
    </>
  );
}
