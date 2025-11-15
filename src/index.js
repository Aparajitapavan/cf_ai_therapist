// -----------------------------------------------------------------------------
// cf_ai_therapist — Single-file Cloudflare Worker
// Features:
//   • Minimal HTML chat UI (GET "/")
//   • AI therapist replies via Workers AI (POST "/")
//   • Short-term per-session memory in KV (binding: CHAT)
//   • Session cookie for anonymous users
// -----------------------------------------------------------------------------

/** ====== Configuration ====== */
const MODEL = "@cf/meta/llama-3-8b-instruct"; // Available on your account
const COOKIE_NAME = "sid";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;      // 30 days
const KV_TTL_SECONDS = 60 * 60 * 24 * 7;       // 7 days
const MAX_TURNS = 10;                          // system + last 8 user/assistant messages

/** System behavior for the therapist */
const SYSTEM_PROMPT = {
  role: "system",
  content:
    "You are a compassionate, brief AI therapist. Be supportive, reflect feelings, and ask gentle follow-up questions. Keep answers under 100 words."
};

/** ====== Inline UI ====== */
const HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Edge Therapist</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { color-scheme: light dark; }
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; }
    h1 { font-size: 1.6rem; margin-bottom: 0.25rem; }
    .sub { color: #666; margin-bottom: 1rem; }
    #log { white-space: pre-wrap; background: #0b0b0b08; padding: 12px; border-radius: 10px; min-height: 220px; }
    textarea { width: 100%; padding: 10px; border-radius: 10px; border: 1px solid #ccc; }
    button { padding: 8px 14px; border-radius: 10px; border: 0; background: #111827; color: #fff; cursor: pointer; }
    button:disabled { opacity: .6; cursor: not-allowed; }
    .disclaimer { color: #888; font-size: .9rem; margin-top: 12px; }
    .row { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
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

  <div class="disclaimer">⚠️ Not a licensed therapist. Demo only.</div>

  <script>
    const log = document.getElementById('log');
    const msg = document.getElementById('msg');
    const btn = document.getElementById('send');

    function append(who, text) {
      log.textContent += "\\n" + who + ": " + (text || "").trim();
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

/** ====== Small helpers ====== */

/** Set common security/cache headers */
function withCommonHeaders(res) {
  res.headers.set("Content-Type", res.headers.get("Content-Type") || "text/plain;charset=utf-8");
  res.headers.set("Cache-Control", "no-store");
  // Minimal CSP for this simple page
  if (res.headers.get("Content-Type").startsWith("text/html")) {
    res.headers.set(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self';"
    );
  }
  return res;
}

/** Get or set an anonymous session cookie */
function getOrSetSid(request) {
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(new RegExp(`${COOKIE_NAME}=([a-zA-Z0-9_-]+)`));
  if (m) return { sid: m[1], set: null };

  const sid = crypto.randomUUID().replace(/-/g, "");
  const set = `${COOKIE_NAME}=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`;
  return { sid, set };
}

/** Load/save short chat history from KV */
async function readHistory(env, sid) {
  const raw = await env.CHAT.get(`hist:${sid}`);
  return raw ? JSON.parse(raw) : [SYSTEM_PROMPT];
}
async function writeHistory(env, sid, history) {
  await env.CHAT.put(`hist:${sid}`, JSON.stringify(history), { expirationTtl: KV_TTL_SECONDS });
}

/** Trim to system + last few turns */
function trimHistory(history) {
  if (history.length > MAX_TURNS) {
    return [history[0], ...history.slice(-1 * (MAX_TURNS - 1))];
  }
  return history;
}

/** AI call wrapper */
async function runTherapist(env, messages) {
  const aiRes = await env.AI.run(MODEL, { messages });
  // Workers AI commonly returns { response: string, ... }
  return (aiRes && (aiRes.response || aiRes.result || aiRes.output)) || String(aiRes || "");
}

/** ====== Request Handlers ====== */

async function handleUI(request) {
  const res = new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  return withCommonHeaders(res);
}

async function handleReset(request, env) {
  const { sid, set } = getOrSetSid(request);
  await env.CHAT.delete(`hist:${sid}`);
  const res = new Response("ok", { status: 200 });
  if (set) res.headers.set("Set-Cookie", set);
  return withCommonHeaders(res);
}

async function handleChat(request, env) {
  const { sid, set } = getOrSetSid(request);

  // Load / update history
  let history = await readHistory(env, sid);
  const body = await request.json().catch(() => ({}));
  const message = String(body.message || "").slice(0, 1500);
  history.push({ role: "user", content: message });
  history = trimHistory(history);

  // Get AI reply
  let replyText = "";
  try {
    replyText = await runTherapist(env, history);
  } catch (err) {
    console.error("AI error:", err);
    replyText = "I'm having trouble responding right now. Could we try again?";
  }

  // Persist and respond
  history.push({ role: "assistant", content: replyText.trim() });
  await writeHistory(env, sid, history);

  const res = new Response(JSON.stringify({ reply: replyText.trim() }), {
    headers: { "Content-Type": "application/json" }
  });
  if (set) res.headers.set("Set-Cookie", set);
  return withCommonHeaders(res);
}

/** ====== Worker entry ====== */
export default {
  async fetch(request, env) {
    const { method } = request;
    const path = new URL(request.url).pathname;

    if (method === "GET" && path === "/") return handleUI(request);
    if (method === "POST" && path === "/reset") return handleReset(request, env);
    if (method === "POST" && path === "/") return handleChat(request, env);

    return withCommonHeaders(new Response("Not found", { status: 404 }));
  }
};

