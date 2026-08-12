// Level-3 voice fallback: a free server-side TTS proxy (no API key).
//
// The three-level degradation ladder (from the architecture doc):
//   1. Web Speech API  -> client native, free, no network (primary)
//   2. Local WASM voice -> on-device model, offline (future: sherpa-onnx)
//   3. This proxy      -> free Google Translate TTS endpoint, keyless
//
// The proxy keeps the browser simple: GET /api/tts?text=...&lang=... returns
// an audio/mpeg stream. Production swap: Microsoft Edge-TTS (also keyless)
// or a platform-managed TTS service; the client does not need to change.

const TTS_ENDPOINT =
  "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&ttsspeed=1";

export async function proxyTts(text, lang) {
  const url = `${TTS_ENDPOINT}&tl=${encodeURIComponent(lang || "en")}&q=${encodeURIComponent(
    text.slice(0, 500),
  )}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
      Referer: "https://translate.google.com/",
    },
  });
  if (!res.ok) {
    return { ok: false, error: `TTS upstream ${res.status}` };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) return { ok: false, error: "TTS returned empty audio" };
  return { ok: true, audio: buf, type: res.headers.get("content-type") || "audio/mpeg" };
}
