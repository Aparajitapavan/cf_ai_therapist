# cf_ai_therapist

**A tiny, privacy-first AI therapist chat built entirely on Cloudflare's edge.**  
- **LLM:** Llama 3.3 via **Workers AI**  
- **Coordination:** Cloudflare **Worker**  
- **User Input:** Minimal HTML chat UI  
- **Memory/State:** **KV** (per-session short history)  

> ⚠️ Disclaimer: Demo only; not licensed therapy.

## Run locally
```bash
npm install
wrangler login
npm run dev
