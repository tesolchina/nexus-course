// One small function that talks to any OpenAI-compatible /chat/completions API
// using Node 20's built-in fetch. No SDK, no dependency. Reused unchanged from
// fite-agent-mvp (BYOK + provider abstraction).
//
// Key resolution order (so the same code runs locally, on Replit, or with BYOK):
//   1. apiKey passed in from the request (Bring Your Own Key)
//   2. process.env.OPENAI_API_KEY
//   3. process.env.AI_INTEGRATIONS_OPENAI_API_KEY (Replit AI Integrations)

function resolveKey(byok) {
  return (
    (byok && String(byok).trim()) ||
    process.env.OPENAI_API_KEY ||
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
    ""
  );
}

function resolveBaseUrl() {
  return (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
}

export function llmConfigured() {
  return Boolean(resolveKey());
}

// messages: [{ role, content }, ...]  ->  { ok, content } | { ok:false, error }
export async function chat(messages, { model, apiKey } = {}) {
  const key = resolveKey(apiKey);
  if (!key) {
    return {
      ok: false,
      error:
        "No API key configured. Set OPENAI_API_KEY (or AI_INTEGRATIONS_OPENAI_API_KEY), or pass your own key.",
    };
  }

  const url = `${resolveBaseUrl()}/chat/completions`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: model || process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages,
        temperature: 0.4,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[llm] upstream ${res.status}: ${text.slice(0, 1000)}`);
      const generic =
        res.status === 401 || res.status === 403
          ? "The AI provider rejected the request (check the API key)."
          : res.status === 429
            ? "The AI provider is rate-limited. Please try again shortly."
            : "The AI provider returned an error. Please try again.";
      return { ok: false, error: generic };
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) return { ok: false, error: "LLM returned an empty response." };
    return { ok: true, content };
  } catch (err) {
    console.error(`[llm] network error: ${err.message}`);
    return { ok: false, error: "Could not reach the AI provider. Please try again." };
  }
}
