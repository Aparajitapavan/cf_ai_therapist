# cf_ai_therapist  
**An AI-powered edge application demonstrating LLM inference, workflow coordination, and state management on Cloudflare’s global network. It demonstrates how to combine **Workers AI**, **Workers**, and **KV Storage** to deliver a real-time conversational experience directly from the edge—without any external backend or database.**

---



It includes:
- An **LLM** (via Workers AI)
- **Workflow coordination** (via Workers)
- **User input** (via chat interface)
- **Persistent memory or state** (via KV)

---



## 3. Features
- Runs entirely on Cloudflare’s global edge network  
- Real-time AI conversation powered by Workers AI  
- Short-term chat memory persisted in KV (7-day retention)  
- Stateless architecture with session-based continuity  
- Secure defaults: HTTP-only, SameSite cookies, no external API calls  
- Single-file implementation for simplicity and transparency  

---

## 4. Project Structure
```
cf_ai_therapist/
├── src/
│   └── index.js         # Worker script (UI + logic)
├── wrangler.toml        # Cloudflare configuration (AI + KV bindings)
├── package.json         # npm scripts (dev/deploy)
├── README.md            # Documentation
├── PROMPTS.md           # AI prompts used during development
└── .gitignore
```

---

## 5. Setup and Running Instructions

### Prerequisites
- Node.js (v18 or newer)
- Cloudflare account
- Wrangler CLI (`npm install -g wrangler`)
- Workers AI and KV access enabled

---

### Step 1 - Clone the Repository
```bash
git clone https://github.com/<your-username>/cf_ai_therapist.git
cd cf_ai_therapist
```

---

### Step 2 - Install Dependencies
```bash
npm install
```

---

### Step 3 - Log in to Cloudflare
Authenticate Wrangler with your Cloudflare account:
```bash
wrangler login
```

---

### Step 4 - Create a KV Namespace
Create and link a KV store for chat memory:
```bash
wrangler kv namespace create CHAT
```
Copy the generated namespace ID and paste it into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "CHAT"
id = "YOUR_KV_ID"
```

---

### Step 5 - Run Locally (with Remote AI)
To test using Workers AI remotely:
```bash
wrangler dev --remote
```

Access the local instance at:
```
http://localhost:8787
```

You should see:
```
Edge Therapist
Say hi to begin…
```

---

### Step 6 - Deploy Globally
Deploy your Worker to Cloudflare’s edge:
```bash
npm run deploy
```

Once complete, your application will be live at:
```
https://cf-ai-therapist.<your-cloudflare-subdomain>.workers.dev
```

---

## 6. Example Usage
**User:** I’m feeling overwhelmed today.  
**Therapist:** That sounds difficult. Would you like to share what’s been causing this stress lately?

---

## 7. Model Details
This application uses the Cloudflare-hosted model:

```
@cf/meta/llama-3-8b-instruct
```

**Task:** Text Generation  
**Latency:** ~100–200 ms  
**Characteristics:**  
- Chat-tuned variant of Llama 3  
- Compact enough for edge deployment  
- Ideal for empathetic, short-form responses  

---

## 8. Design Flow

**Request lifecycle:**
1. The Worker serves the static chat interface (`GET /`).  
2. Each new message (`POST /`) retrieves or creates a session cookie.  
3. The session’s chat history is loaded from KV.  
4. The message array is sent to Workers AI for inference.  
5. The response is appended to history and stored back in KV.  
6. The client displays the result immediately.  



---



## 10. Prompts Reference 
Example prompts used to shape AI behavior:
```
"You are a compassionate AI therapist. Respond briefly and empathetically."
"Reflect the user’s feelings and ask a short follow-up question."
```

---

## 11. Live Deployment Example
The live demo will be accessible at:
```
https://cf-ai-therapist.<your-subdomain>.workers.dev
```

---


