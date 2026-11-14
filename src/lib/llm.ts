// OpenAI with strict JSON-schema outputs. The LLM never decides a status: it maps conditions,
// extracts claims, and writes alert sentences. Everything it returns is checked by code.
const MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";

export async function llmJson<T>(opts: {
  name: string;
  schema: Record<string, unknown>;
  system: string;
  user: string;
}): Promise<T> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      reasoning_effort: "low",
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      response_format: { type: "json_schema", json_schema: { name: opts.name, strict: true, schema: opts.schema } },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  const msg = json.choices?.[0]?.message;
  if (msg?.refusal) throw new Error(`OpenAI refused: ${msg.refusal}`);
  return JSON.parse(msg.content) as T;
}

/** Nullable JSON-schema helper for strict mode (every key required, null allowed). */
export const nullable = (t: string | Record<string, unknown>) =>
  typeof t === "string" ? { type: [t, "null"] } : { anyOf: [t, { type: "null" }] };
