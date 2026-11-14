// Telegram Bot API (token from TELEGRAM_BOT_TOKEN env var).
const api = (method: string) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

export const telegramConfigured = () => Boolean(process.env.TELEGRAM_BOT_TOKEN);

export async function tg<T = any>(method: string, body?: unknown): Promise<T> {
  if (!telegramConfigured()) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const r = await fetch(api(method), {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description ?? r.status}`);
  return j.result as T;
}

export async function botInfo() {
  return tg<{ username: string; first_name: string }>("getMe");
}

/** The most recent chat that messaged the bot (the investor sends /start, then clicks "Detect"). */
export async function detectChat(): Promise<{ id: string; title: string } | null> {
  const updates = await tg<any[]>("getUpdates", { limit: 50, allowed_updates: ["message", "my_chat_member"] });
  for (const u of [...updates].reverse()) {
    const chat = u.message?.chat ?? u.my_chat_member?.chat;
    if (chat) return { id: String(chat.id), title: chat.title ?? [chat.first_name, chat.last_name].filter(Boolean).join(" ") ?? chat.username ?? "chat" };
  }
  return null;
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function sendTelegram(chatId: string, html: string, buttons: { text: string; url: string }[] = []) {
  const usable = buttons.filter((b) => b.url.startsWith("https://")); // Telegram rejects non-https URL buttons
  return tg("sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: usable.length ? { inline_keyboard: [usable] } : undefined,
  });
}
