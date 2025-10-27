# BrandMeNow WordPress Plugin

Secure chat UI and AI logo generation via Fal.ai, embedded in WordPress pages with simple shortcodes. Includes a guided multi‑step flow (BMMS cards), concept selection, and server‑side image generation to avoid mixed‑content and localhost issues.

## Shortcodes & Usage

You can embed the plugin’s UI into any WordPress Page or Post using these shortcodes. Each shortcode renders a complete UI section. For best results, place only one of these shortcodes per page.

- [agui_chat]
  - What it does: Renders the AG‑UI chat experience with a pre‑chat form at the top (Name, Email, Phone, Brand Idea) and a chat window that appears after submission.
  - When to use: If you want users to share contact details before chatting, and then continue the conversation in the same page.
  - How to use:
    1) In WordPress, go to Pages → Add New.
    2) Give it a title, e.g., “Brand Wizard”.
    3) Add a Shortcode block and enter: [agui_chat]
    4) Publish.
  - What users see: A pre‑chat form at the top and, after submission, a chat window with suggestions and the ability to send messages or attach files.

- [bm_chat]
  - What it does: Renders the chat UI (sidebar + message pane) without the pre‑chat form.
  - When to use: If you prefer a direct chat interface or you already collect contact details elsewhere.
  - How to use:
    1) Create a new page (e.g., “AI Chat”).
    2) Add a Shortcode block with: [bm_chat]
    3) Publish.
  - What users see: A modern chat interface with a conversation list panel, message area, composer, and action buttons.

- [bm_ms_form]
  - What it does: Renders the multi‑step logo creation flow (BMMS cards) with 5 steps, including AI image generation.
  - Steps:
    - Step 1: Collect basic info (Name, Email, Business description).
    - Step 2: Choose an icon foundation (Lightning, Gauge, Rocket, Custom).
    - Step 3: Enter logo text (optional) to combine with the icon.
    - Step 4: Generate variations via the WordPress REST route (Fal.ai primary, Agent/ FastAPI fallbacks). A small banner shows the active endpoint.
    - Step 5: Preview the selected logo and download as PNG.
  - How to use:
    1) Create a new page (e.g., “Logo Maker”).
    2) Add a Shortcode block with: [bm_ms_form]
    3) Publish.
  - Requirements: For AI generation, set Fal API Key/Model in Admin → AG‑UI CRM. The plugin prefers the WordPress REST path by default, reducing CORS issues.

Notes
- These shortcodes don’t currently support attributes; the UI is pre‑configured by the plugin’s settings. We can add attributes later (e.g., to hide the pre‑chat form or set a custom title) if you need them.
- If a builder/theme caches content aggressively, shortcodes may appear delayed; clear caches and reload.
- Place only one of these shortcodes per page to avoid ID collisions (e.g., some elements share IDs such as “suggestions”).

## Configuration (Admin → AG‑UI CRM)

- Fal AI (Server‑side)
  - Fal API Key: your server key
  - Fal Model: e.g. fal-ai/flux/schnell
  - The WordPress REST route /wp-json/agui-chat/v1/image/generate calls Fal.ai server‑side.

- AG‑UI Endpoints
  - SSE URL, WebSocket URL, Send URL: endpoints for your agent server.
  - Prefer WebSocket: enable if your WS endpoint works. Note: the plugin currently sets forceNonStreaming=true by default until endpoints are confirmed stable.
  - Fallback URL: optional backup (e.g., http://127.0.0.1:8000/api/ask).

- Agency API (FastAPI)
  - FastAPI Base URL and optional DB_TOKEN for local development fallbacks.

## How the Flow Works

- Step 2: Pick a logo concept from the grid (thumbnails under assets/logo-ideas). The selected concept is referenced in prompts.
- Step 4: Generates variations via the WordPress REST endpoint, which calls Fal.ai (primary), then agent proxy (fallback), then FastAPI (fallback). An endpoint banner shows which path is used.
- If generation fails, an error banner and a Retry button appear.

## Known Issues & Troubleshooting

- Disconnected SSE/WS
  - Symptom: status shows “Disconnected”; messages use fallback.
  - Fix: verify Send/SSE/WS URLs and that the agent server is reachable. Streaming may be disabled by default.

- Image generation fails (Step 4)
  - Symptom: no images; error banner with Retry.
  - Fix: check Fal API Key/Model in Admin; confirm the site can reach https://api.fal.ai; review server logs. If agent/fastapi fallbacks aren’t running, they will also fail.

- Mixed‑content (http vs https)
  - Symptom: browser blocks requests to http on an https site.
  - Fix: use same‑origin HTTPS for WordPress and server endpoints or rely on the WordPress REST route for Fal.ai.

- Thumbnails not loading or concept reference broken
  - Symptom: blank images or 404 in DevTools.
  - Fix: ensure the assets/logo-ideas files exist; the client normalizes concept URLs to absolute paths.

- CSP/Data URI blocked
  - Symptom: placeholder SVG data URI is blocked by CSP.
  - Fix: relax CSP to allow data:image/svg+xml or ensure Fal.ai connectivity to avoid placeholder.

- WordPress REST 401/403
  - Symptom: REST route denied by security plugins or missing auth.
  - Fix: ensure public access to /wp-json/agui-chat/v1/image/generate or whitelist the route in your security configuration.

- Git CRLF warnings (Windows)
  - Symptom: “LF will be replaced by CRLF”.
  - Fix: add a .gitattributes to normalize line endings if desired.

## Verification Checklist

- Admin → AG‑UI CRM shows Fal.ai settings; Banana.dev isn’t used.
- On Step 4, the endpoint banner indicates WordPress REST/Fal.ai.
- DevTools Network shows POST to /wp-json/agui-chat/v1/image/generate with prompt, image_url, size, format, guidance_scale, num_inference_steps, seed, model.
- Error/Retry path works when Fal.ai is unreachable.

## Notes

- This plugin uses Fal.ai exclusively for image generation. Agent and FastAPI are optional fallbacks for local dev.
- For deployment, ensure WordPress and all endpoints use HTTPS to avoid mixed‑content blocking.

## Quick Start: Test locally against aaas-truva and WordPress

This guide helps you run the plugin UI locally, connect it to Didac’s aaas-truva app for chat (SSE/WS/send), and proxy image generation through your WordPress site.

### 1) Requirements
- Node.js 18+ (for the local preview server)
- A local or accessible WordPress site (e.g., http://brandmenow-dev.local)
- WordPress admin → AG‑UI CRM: set Fal API Key and Model (e.g., fal-ai/flux/schnell)
- aaas-truva app running and reachable, with confirmed endpoints:
  - SSE URL (streaming events)
  - WebSocket URL (wss recommended if HTTPS)
  - Send URL (non‑streaming POST)
  - Optional: agentImageEndpoint (proxy image generation), FastAPI base (dev fallback)

### 2) Start the aaas-truva app
- Clone Didac’s app: `git clone https://github.com/jazzy-coding-flow/aaas-truva.git`
- Follow that app’s README to run the server and note its endpoints (SSE/WS/send, and any image proxy routes).

### 3) Run the plugin preview server in WordPress proxy mode
PowerShell (Windows):
```
$env:WP_ORIGIN="http://brandmenow-dev.local"; $env:PORT="5501"; node preview-server.js
```
Open http://localhost:5501/

What this does:
- Serves the plugin UI locally.
- Proxies WordPress routes like `/wp-json/agui-chat/v1/settings` and `/wp-json/agui-chat/v1/image/generate` to `WP_ORIGIN`.
- Lets you test end‑to‑end without deploying the plugin.

### 4) Configure endpoints for chat and image generation
Edit `preview-plugin.html` and set `window.AGUiConfig`:
```
window.AGUiConfig = {
  // Agent/chat endpoints (aaas-truva)
  sseUrl: "https://your-aaas-truva-app/sse",
  wsUrl: "wss://your-aaas-truva-app/ws",
  sendUrl: "https://your-aaas-truva-app/api/send",
  preferWebSocket: true,
  forceNonStreaming: true, // set to false after SSE/WS are confirmed stable
  fallbackUrl: "https://your-aaas-truva-app/api/ask", // optional

  // Image generation endpoints
  wpImageEndpoint: "/wp-json/agui-chat/v1/image/generate", // primary (WordPress REST)
  agentImageEndpoint: "https://your-aaas-truva-app/api/generate", // optional fallback
  fastApiBase: "http://127.0.0.1:8000", // optional dev fallback

  // Policy flag
  disableNonWpFallbacks: true // strict WordPress‑only testing
};
```
Notes:
- If your WordPress is HTTPS, use HTTPS/wss endpoints to avoid mixed‑content.
- Local/relative concept images are treated as local; `image_url` won’t be sent to Fal.
- To test fallbacks, set `disableNonWpFallbacks` to `false` and ensure the agent/FastAPI endpoints are reachable.

### 5) Test the flow
- Go to http://localhost:5501/
- Multi‑step logo flow:
  - Pick a concept (assets/logo-ideas).
  - Generate variations. Confirm network requests hit `/wp-json/agui-chat/v1/image/generate` (proxied to `WP_ORIGIN`).
  - If WordPress responds with images, they’ll render; otherwise you’ll see error feedback.
- Chat:
  - Send a message and confirm it uses your `sendUrl`.
  - If streaming is enabled, confirm events over SSE/WS.

### 6) Push your changes to GitHub
Ensure remote is set to your repo and push:
```
git add -A
git commit -m "Add Quick Start guide for local testing with aaas-truva and WordPress"
git push -u origin main
```

Troubleshooting
- WordPress REST 401/403: whitelist `/wp-json/agui-chat/v1/image/generate` in security plugins.
- Mixed‑content: use same‑origin HTTPS + wss or rely on WordPress REST for Fal.ai calls.
- CSP blocking `data:image/svg+xml`: allow temporarily or ensure Fal.ai connectivity.
- CORS: whitelist your WordPress and preview server origins in aaas‑truva.