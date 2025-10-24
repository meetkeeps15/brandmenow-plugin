# BrandMeNow WordPress Plugin

Secure chat UI and AI logo generation via Fal.ai, embedded in WordPress pages with simple shortcodes. Includes a guided multi‑step flow (BMMS cards), concept selection, and server‑side image generation to avoid mixed‑content and localhost issues.

## Shortcodes & Usage

- [agui_chat]
  - Embeds the AG‑UI chat and pre‑chat form. Use this on a page to start the guided flow and chat.
  - Example: create a page “Brand Wizard” and add the shortcode to the content.

- [bm_chat]
  - Alias for the same chat UI if you prefer a shorter name.

- [bm_ms_form]
  - Embeds the micro‑service (MS) pre‑chat form only, suitable for collecting contact details before opening the chat elsewhere.

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