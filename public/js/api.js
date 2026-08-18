/** نداءات الـ backend. الـ API keys كلها هناك — المتصفح مبيشوفش حاجة. */

export async function getConfig() {
  const r = await fetch("/api/config");
  if (!r.ok) throw new Error("مقدرتش أجيب الإعدادات");
  return r.json();
}

/** Blob صوت -> نص عربي */
export async function transcribe(blob, signal) {
  const form = new FormData();
  const ext = (blob.type.split("/")[1] || "webm").split(";")[0];
  form.append("audio", blob, `speech.${ext}`);
  const r = await fetch("/api/stt", { method: "POST", body: form, signal });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "فشل تحويل الصوت لنص");
  return (data.text || "").trim();
}

/**
 * يفتح SSE على /api/converse وبينادي onEvent لكل حدث.
 * بيرجّع لما الاتصال يقفل.
 */
export async function converse(messages, onEvent, signal) {
  const res = await fetch("/api/converse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(t || `السيرفر رجّع ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let sep;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const line = raw.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try { onEvent(JSON.parse(line.slice(6))); }
      catch { /* حدث مقطوع — بنعدّيه */ }
    }
  }
}
