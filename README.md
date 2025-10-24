# brandmenow-plugin

WordPress plugin for the BrandMeNow AI assistant and multi-step logo generator.

Highlights:
- Secure AI logo generation via WordPress REST route (`/wp-json/agui-chat/v1/image/generate`) using server-side Fal.ai settings.
- Client-side prompt building that leverages the selected concept image from Step 2 as a foundation for logo variations.
- Robust Step 4 UX with clear error banner, retry, and explicit slide selection before continuing.
- Plugin-safe asset URLs for concept thumbnails in `assets/logo-ideas/`.

Key files:
- `wp-agui-chat.php` — Registers REST endpoints and integrates Fal.ai with pass-through parameters.
- `assets/agui-wp.js` — Handles multi-step flow, endpoint selection, payload formatting, and rendering.
- `assets/agui-wp.css` — Styles for the multi-step form and cards.
- `preview-plugin.html` — Local preview harness to test UI and generation without WordPress.

Setup:
1. Install the WordPress plugin and ensure `FAL_KEY` and `FAL_MODEL` are configured (via settings or environment).
2. Confirm the concept thumbnails are served over HTTPS from your site: `/wp-content/plugins/wp-agui-chat/assets/logo-ideas/*`.
3. Open the plugin UI; select a concept in Step 2; verify Step 4 posts to the WordPress route with `image_url` and parameters.

Notes:
- If Fal.ai is unreachable, the server gracefully falls back to an agent proxy, then to a generated SVG data URI to keep the flow functional.
- You can override the model per-request by including `model` in the JSON body; otherwise the configured `FAL_MODEL` is used.