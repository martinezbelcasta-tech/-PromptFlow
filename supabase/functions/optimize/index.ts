import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// La key vive SOLO como secreto de Supabase, nunca en el código.
// Se configura en: dashboard → Edge Functions → Secrets → GEMINI_API_KEY
const GEMINI_KEY = (Deno.env.get("GEMINI_API_KEY") ?? "").trim();

// Modelo lite: rápido y con límite gratuito alto (el 3.6-flash solo daba 20/día).
const MODEL = "gemini-flash-lite-latest";
const MAX_CHARS = 5000;

const SYSTEM_OPTIMIZE =
  "Sos un optimizador de prompts. Comprimí y corregí el texto del usuario en " +
  "español: eliminá cortesías, muletillas y redundancias, corregí ortografía y " +
  "tildes, sin perder NADA de la información ni de las instrucciones. Devolvé " +
  "SOLO el texto optimizado, sin comillas, sin explicaciones, sin preámbulos.";

const SYSTEM_ASK =
  "Sos un asistente útil que responde en español. Respondé la pregunta del " +
  "usuario de forma clara, precisa y concisa.";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function geminiBody(system: string, text: string) {
  return JSON.stringify({
    system_instruction: { parts: [{ text: system }] },
    contents: [{ parts: [{ text }] }],
  });
}

// Extrae los deltas de texto de una línea SSE "data: {...}" de Gemini.
function textFromSSELine(line: string): string {
  const t = line.trim();
  if (!t.startsWith("data:")) return "";
  const payload = t.slice(5).trim();
  if (!payload || payload === "[DONE]") return "";
  try {
    const obj = JSON.parse(payload);
    const parts = obj?.candidates?.[0]?.content?.parts ?? [];
    return parts
      .filter((p: { text?: string; thought?: boolean }) => p?.text && !p?.thought)
      .map((p: { text: string }) => p.text)
      .join("");
  } catch {
    return "";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!GEMINI_KEY) return json({ error: "missing_key" }, 500);

  let text: unknown;
  let mode: unknown;
  try {
    const body = await req.json();
    text = body.text;
    mode = body.mode;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (typeof text !== "string" || !text.trim()) {
    return json({ error: "empty_text" }, 400);
  }
  if (text.length > MAX_CHARS) {
    return json({ error: "too_long", max: MAX_CHARS }, 400);
  }

  // ── PREGUNTA: respuesta en streaming (texto plano, token por token) ──
  if (mode === "ask") {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: geminiBody(SYSTEM_ASK, text) },
    );
    if (!upstream.ok || !upstream.body) {
      return json({ error: "gemini_error", status: upstream.status }, 502);
    }
    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body!.getReader();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        let buffer = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const chunk = textFromSSELine(line);
              if (chunk) controller.enqueue(encoder.encode(chunk));
            }
          }
          const last = textFromSSELine(buffer);
          if (last) controller.enqueue(encoder.encode(last));
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: { ...cors, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
    });
  }

  // ── OPTIMIZAR: respuesta JSON de una sola vez ──
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: geminiBody(SYSTEM_OPTIMIZE, text) },
    );
    if (!r.ok) return json({ error: "gemini_error", status: r.status }, 502);
    const data = await r.json();
    const optimized = (data?.candidates?.[0]?.content?.parts ?? [])
      .filter((p: { text?: string; thought?: boolean }) => p?.text && !p?.thought)
      .map((p: { text: string }) => p.text)
      .join("")
      .trim();
    if (!optimized) return json({ error: "empty_response" }, 502);
    return json({ optimized });
  } catch {
    return json({ error: "upstream_failure" }, 502);
  }
});
