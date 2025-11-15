// Single-file Worker that serves a tiny chat UI (GET "/")
// and handles chat posts (POST "/").
// Memory is stored per-session in Cloudflare KV (binding: CHAT).
// LLM is Llama 3 via Workers AI (binding: AI).

const MODEL = "@cf/meta/llama-3-8b-instruct"; // confirmed available in your account

// ============ HTML UI ============ //
const HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Edge Therapist</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; }
    h1 { font-size: 1.6rem; margin-bottom: 0.25rem; }
    .sub { color: #666; margin-bottom: 1rem; }
    #log { white-space: pre-wrap; background:#0b0b0b08; padding:12px; border-radius:10px; min-height:220px; }
    textarea { width: 100%; padding: 10px; border-radius: 10px; border: 1px solid #ccc; }
    button { padding: 8px 14px; border-radius: 10px; border: 0; background: #111827; color: #fff; cursor: pointer; }
    button:disabled { opacity: .6; cursor: not-allowed; }
    .disclaimer { color:#888; font-size:.9rem; margin-top:12px }
    .row { display:flex; gap:8px; align-items:center; margin-top:8px }
  </style>
</head>
<body>
  <h1>💬 Edge Therapist</h1>
  <div class="sub">A tiny, privacy-friendly AI therapist running entirely on Cloudflare's edge.</div>

  <div id="log">Say hi to begin…</div>
  <div class="row">
    <textarea id="msg" rows="3" placeholder="How are you feeling today? (Ctrl/Cmd+Enter to send)"></textarea>
    <button id="send" onclick="send()">Send</button>
  </div>
  <div class="row">
    <button onclick="resetMem()">Clear Memory</button>
  </div>

  <div class="disclaimer">
    ⚠️ Not a licensed therapist. Demo only.
  </div>

  <script>
    const log = document.getElementById('log');
    const msg = document.getElementById('msg');
    const btn = document.getElementById('send');

    function append(who, text) {
      log.textContent += "\\n" + who + ": " + (text||"").trim();
      log.scrollTop = log.scrollHeight;
    }

    async function send() {
      const text = msg.value.trim();
      if (!text) return;
      append("You", text);
      btn.disabled = true;
      msg.value = "";
      try {
        const res = await fetch("/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text })
        });
        const data = await res.json();
        append("Therapist", data.reply || "(no reply)");
      } catch {
        append("System", "Error talking to AI.");
      } finally {
        btn.disabled = false;
        msg.focus();
      }
    }

    async function resetMem() {
      await fetch("/reset", { method: "POST" });
      log.textContent += "\\n(System: memory cleared)";
    }

    msg.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
    });
  </script>
</body>
</html>`;

// ============ UTILITIES ============ //
function getOrSetSid(request) {
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(/sid=([a-zA-Z0-9_-]+)/);
  if (m) return { sid: m[1], set: null };
  const sid = crypto.randomUUID().replace(/-/g, "");
  const set = `sid=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60*60*24*30}`;
  return { sid, set };
}

const SYSTEM_PROMPT = {
  role: "system",
  content:
    "You are a compassionate, brief AI therapist. Be supportive, reflect feelings, ask gentle follow-up questions. Keep answers under 100 words."
};

// ============ WORKER HANDLER ============ //
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Serve UI
    if (request.method === "GET" && url.pathname === "/") {
      const { set } = getOrSetSid(request);
      const res = new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      if (set) res.headers.set("Set-Cookie", set);
      return res;
    }

    // Reset memory
    if (request.method === "POST" && url.pathname === "/reset") {
      const { sid, set } = getOrSetSid(request);
      await env.CHAT.delete(`hist:${sid}`);
      const res = new Response("ok", { status: 200 });
      if (set) res.headers.set("Set-Cookie", set);
      return res;
    }

    // Chat route
    if (request.method === "POST" && url.pathname === "/") {
      const { sid, set } = getOrSetSid(request);
      let histRaw = await env.CHAT.get(`hist:${sid}`);
      let history = histRaw ? JSON.parse(histRaw) : [SYSTEM_PROMPT];

      const body = await request.json().catch(() => ({}));
      const message = String(body.message || "").slice(0, 1500);
      history.push({ role: "user", content: message });

      // keep short memory: system + last 8
      if (history.length > 10) history = [history[0], ...history.slice(-9)];

      let replyText = "";
      try {
        const aiRes = await env.AI.run(MODEL, { messages: history });
        replyText = (aiRes && (aiRes.response || aiRes.result || aiRes.output)) || String(aiRes || "");
      } catch (e) {
        console.error("AI error:", e); // logs to wrangler tail
        replyText = "I'm having trouble responding right now. Could we try again?";
      }

      history.push({ role: "assistant", content: replyText.trim() });
      await env.CHAT.put(`hist:${sid}`, JSON.stringify(history), { expirationTtl: 60*60*24*7 }); // keep 7 days

      const res = new Response(JSON.stringify({ reply: replyText.trim() }), {
        headers: { "Content-Type": "application/json" }
      });
      if (set) res.headers.set("Set-Cookie", set);
      return res;
    }

    // Fallback
    return new Response("Not found", { status: 404 });
  }
};
