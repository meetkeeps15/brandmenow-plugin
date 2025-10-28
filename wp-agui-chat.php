<?php
/*
Plugin Name: AG-UI Chat Embed
Description: Shortcode and admin settings to embed an AG-UI chat window and configure CRM dashboard/api endpoints. Designed to mirror the integration approach used in aaas-truva-main.
Version: 0.1.2
Author: Keeper 
*/

if (!defined('ABSPATH')) { exit; }

class WP_AGUI_Chat_Plugin {
  const OPTION_KEY = 'wp_agui_chat_settings';

  public function __construct(){
    add_action('admin_menu', [$this, 'admin_menu']);
    add_action('admin_init', [$this, 'register_settings']);
    add_action('wp_enqueue_scripts', [$this, 'enqueue_assets']);
    add_shortcode('agui_chat', [$this, 'shortcode_agui_chat']);
    add_shortcode('bm_chat', [$this, 'shortcode_bm_chat']);
    add_shortcode('bm_ms_form', [$this, 'shortcode_bm_ms_form']);
  }

  public static function defaults(){
    return [
      'sse_url' => 'https://localhost:8787/agui/sse',
      'ws_url'  => 'wss://localhost:8787/agui/ws',
      'send_url'=> 'https://localhost:8787/agui/send',
      'prefer_ws' => true,
      // Optional Agency API (FastAPI) for tools like image generation
      'fastapi_base' => 'http://127.0.0.1:8800',
      'db_token' => '',
      // Fal AI (server-side proxy from WordPress)
      'fal_key' => '43f4b24d-deeb-4ee4-ac35-cc5d02437a7b:0eb26cf70ce9cf72da2d21ac7ff472b3',
      'fal_model' => 'fal-ai/flux-pro/v1/fill',
      // Banana.dev (primary image generation)
      'banana_key' => '',
      'banana_model' => '',

      // GoHighLevel integration defaults
      'ghl_pit' => 'pit-ca167896-6606-4d07-b042-d294e6bf8d2d',
      'ghl_location_id' => 'xK1e5YGQ7gK6NjoyhyRI',
      'ghl_api_base' => 'https://services.leadconnectorhq.com',
      'ghl_version' => '2021-07-28',
      'crm_dashboards' => [
        'leads'   => 'https://brandmenow.ai/crm/leads',
        'contacts'=> 'https://brandmenow.ai/crm/contacts',
        'deals'   => 'https://brandmenow.ai/crm/deals',
        'tickets' => 'https://brandmenow.ai/crm/tickets',
      ],
      'crm_apis' => [
        'leads'   => 'https://brandmenow.ai/api/crm/leads',
        'contacts'=> 'https://brandmenow.ai/api/crm/contacts',
        'deals'   => 'https://brandmenow.ai/api/crm/deals',
        'tickets' => 'https://brandmenow.ai/api/crm/tickets',
      ],
      'fallback_url' => 'http://127.0.0.1:8000/api/ask',
    ];
  }

  public static function get_settings(){
    return wp_parse_args(get_option(self::OPTION_KEY, []), self::defaults());
  }

  public function enqueue_assets(){
    // CSS + JS copied from standalone implementation for consistent UI.
    // Add cache-busting using file modification time to avoid Chrome caching stale assets
    $css_ver = @filemtime(plugin_dir_path(__FILE__) . 'assets/agui-wp.css') ?: '0.1.2';
    $js_ver  = @filemtime(plugin_dir_path(__FILE__) . 'assets/agui-wp.js') ?: '0.1.2';
    wp_enqueue_style('agui-chat-css', plugins_url('assets/agui-wp.css', __FILE__), [], $css_ver);
    wp_enqueue_script('agui-chat-js', plugins_url('assets/agui-wp.js', __FILE__), [], $js_ver, true);

    $cfg = self::get_settings();
    // Derive agent-server image endpoint from send_url origin
    $agent_image_endpoint = '';
    if (!empty($cfg['send_url'])) {
      $parts = parse_url($cfg['send_url']);
      if ($parts && isset($parts['scheme']) && isset($parts['host'])) {
        $origin = $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
        $agent_image_endpoint = rtrim($origin, '/') . '/api/fal/generate';
      }
    }
    wp_localize_script('agui-chat-js', 'AGUiConfig', [
      'sseUrl' => $cfg['sse_url'],
      'wsUrl'  => $cfg['ws_url'],
      'sendUrl'=> $cfg['send_url'],
      'fallbackUrl' => $cfg['fallback_url'],
      // Prefer server-side proxy for SEND via WordPress to avoid TLS/mixed-content issues
      'wpSendEndpoint' => rest_url('agui-chat/v1/agent/send'),
      'preferWebSocket' => !!$cfg['prefer_ws'],
      'forceNonStreaming' => true, // Temporary: disable SSE/WS until endpoints are confirmed working
      'wpFormEndpoint' => rest_url('agui-chat/v1/ghl/contact'),
      'fastApiBase' => $cfg['fastapi_base'],
      'dbToken' => $cfg['db_token'],
      // Server-side image generation endpoint (avoids mixed-content and localhost issues)
      'wpImageEndpoint' => rest_url('agui-chat/v1/image/generate'),
      'agentImageEndpoint' => $agent_image_endpoint,
      // Live settings endpoint so frontend can synchronize in real-time
      'wpSettingsEndpoint' => rest_url('agui-chat/v1/settings'),
      'wpTagEndpoint' => rest_url('agui-chat/v1/ghl/tag'),
    ]);
  }

  public function shortcode_agui_chat($atts = [], $content = null){
    ob_start();
    ?>
    <header class="agui-header">
      <div class="branding">
        <div class="logo-dot"></div>
        <div class="title">AG‑UI Chat</div>
      </div>
      <div class="connections">
        <span id="connectionStatus" class="status">Disconnected</span>
        <span id="typingIndicator" class="typing hidden">Wizard is typing…</span>
      </div>
    </header>

    <main class="container">
      <section class="agui-card">
        <h2 class="card-title">Kickstart your brand</h2>
        <p class="card-sub">Share a few details, then continue in chat.</p>
        <form id="preChatForm" class="form-stack" autocomplete="off">
          <label class="field"><span>Name</span>
            <input type="text" name="name" placeholder="Your name" required />
          </label>
          <label class="field"><span>Email</span>
            <input type="email" name="email" placeholder="Email" required />
          </label>
          <label class="field"><span>Phone (optional)</span>
            <input type="text" name="phone" placeholder="Phone (optional)" />
          </label>
          <label class="field"><span>Brand idea</span>
            <textarea name="idea" placeholder="Tell us about your brand" rows="3"></textarea>
          </label>
          <div class="actions"><button type="submit" class="btn btn-primary">Continue</button></div>
          <div id="prechat-contact-id-line" class="contact-id-row" style="display:none; margin-top:8px; font-size:13px; color:#374151;">
            Contact ID: <span id="prechat-contact-id"></span>
          </div>
        </form>

        <div class="chat-window" id="chatCard" style="display:none">
          <div class="chat-header">
            <div class="branding"><div class="logo-dot"></div><div class="chat-title">Brand Wizard</div></div>
            <div class="connections"><span class="status">Chat Ready</span></div>
          </div>
          <div id="messages" class="messages" role="log" aria-label="Chat messages"></div>
          <div id="suggestions" class="suggestions" aria-label="Quick suggestions"></div>
          <form id="composer" class="composer" autocomplete="off">
            <input id="input" type="text" placeholder="Type your message…" />
            <button id="sendBtn" type="submit" class="btn btn-primary">Send</button>
          </form>
          <input id="fileInput" type="file" multiple style="display:none" />
        </div>
      </section>
    </main>

    <footer class="footer">
      <div>Powered by AG‑UI • WordPress plugin</div>
    </footer>
    <?php
    return ob_get_clean();
  }

  public function shortcode_bm_chat($atts = [], $content = null){
    ob_start();
    ?>
    <div class="bm-chat-app">
      <aside class="sidebar bm-sidebar" aria-label="Sidebar">
        <div class="sidebar-header bm-sidebar-header">
          <button id="sidebar-toggle" class="icon-btn toggle-btn" aria-label="Toggle sidebar" title="Toggle sidebar">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M9 6l6 6-6 6"/></svg>
          </button>
          <div class="title bm-sidebar-title">Custom GPT</div>
          <button id="new-chat" class="icon-btn plus-btn" aria-label="New Chat" title="New Chat">
            <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="img" width="18" height="18" viewBox="0 0 24 24">
              <path fill="currentColor" d="M7.007 12a.75.75 0 0 1 .75-.75h3.493V7.757a.75.75 0 0 1 1.5 0v3.493h3.493a.75.75 0 1 1 0 1.5H12.75v3.493a.75.75 0 0 1-1.5 0V12.75H7.757a.75.75 0 0 1-.75-.75"/>
              <path fill="currentColor" fill-rule="evenodd" d="M7.317 3.769a42.5 42.5 0 0 1 9.366 0c1.827.204 3.302 1.643 3.516 3.48c.37 3.157.37 6.346 0 9.503c-.215 1.837-1.69 3.275-3.516 3.48a42.5 42.5 0 0 1-9.366 0c-1.827-.205-3.302-1.643-3.516-3.48a41 41 0 0 1 0-9.503c.214-1.837 1.69-3.276 3.516-3.48m9.2 1.49a41 41 0 0 0-9.034 0A2.486 2.486 0 0 0 5.29 7.424a39.4 39.4 0 0 0 0 9.154a2.486 2.486 0 0 0 2.193 2.164c2.977.332 6.057.332 9.034 0a2.486 2.486 0 0 0 2.192-2.164a39.4 39.4 0 0 0 0-9.154a2.486 2.486 0 0 0-2.192-2.163" clip-rule="evenodd"></path>
            </svg>
          </button>
        </div>
        <div id="conversation-list" class="conversation-list" role="listbox" aria-label="Conversations">
          <!-- Conversation items will be rendered here -->
        </div>
      </aside>

      <main class="bm-chat-main">
        <div id="bm-chat-messages" class="bm-chat-messages"></div>
        <div id="suggestions" class="suggestions" aria-label="Quick suggestions"></div>
        <div class="bm-input-container">
          <div class="bm-input-row">
            <textarea id="bm-user-input" placeholder="Type your message..."></textarea>
            <button id="bm-attach-button" class="bm-icon-btn" title="Attach" type="button" aria-label="Attach file">
              <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-hidden="true" role="img" class="component-iconify MuiBox-root css-9uy14h iconify iconify--eva" width="1em" height="1em" viewBox="0 0 24 24"><path fill="currentColor" d="M12 22a5.86 5.86 0 0 1-6-5.7V6.13A4.24 4.24 0 0 1 10.33 2a4.24 4.24 0 0 1 4.34 4.13v10.18a2.67 2.67 0 0 1-5.33 0V6.92a1 1 0 0 1 1-1a1 1 0 0 1 1 1v9.39a.67.67 0 0 0 1.33 0V6.13A2.25 2.25 0 0 0 10.33 4A2.25 2.25 0 0 0 8 6.13V16.3a3.86 3.86 0 0 0 4 3.7a3.86 3.86 0 0 0 4-3.7V6.13a1 1 0 1 1 2 0V16.3a5.86 5.86 0 0 1-6 5.7"></path></svg>
            </button>
            <button id="bm-voice-button" class="bm-icon-btn" title="Voice" type="button" aria-label="Voice input">
              <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-hidden="true" role="img" class="component-iconify MuiBox-root css-7l126h iconify iconify--icon-park-solid" width="1em" height="1em" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="4"><rect width="14" height="27" x="17" y="4" fill="currentColor" rx="7"></rect><path stroke-linecap="round" d="M9 23c0 8.284 6.716 15 15 15s15-6.716 15-15M24 38v6"></path></g></svg>
            </button>
            <button id="bm-send-btn" class="bm-send-btn" type="button" aria-label="Send message" title="Send">
              <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-hidden="true" role="img" class="component-iconify MuiBox-root css-1n9wuna iconify iconify--mingcute" width="1em" height="1em" viewBox="0 0 24 24"><g fill="none"><path d="m12.594 23.258l-.012.002l-.071.035l-.02.004l-.014-.004l-.071-.036q-.016-.004-.024.006l-.004.01l-.017.428l.005.02l.01.013l.104.074l.015.004l.012-.004l.104-.074l.012-.016l.004-.017l-.017-.427q-.004-.016-.016-.018m.264-.113l-.014.002l-.184.093l-.01.01l-.003.011l.018.43l.005.012l.008.008l.201.092q.019.005.029-.008l.004-.014l-.034-.614q-.005-.019-.02-.022m-.715.002a.02.02 0 0 0-.027.006l-.006.014l-.034.614q.001.018.017.024l.015-.002l.201-.093l.01-.008l.003-.011l.018-.43l-.003-.012l-.01-.01z"></path><path fill="currentColor" d="M20.235 5.686c.432-1.195-.726-2.353-1.921-1.92L3.709 9.048c-1.199.434-1.344 2.07-.241 2.709l4.662 2.699l4.163-4.163a1 1 0 0 1 1.414 1.414L9.544 15.87l2.7 4.662c.638 1.103 2.274.957 2.708-.241z"></path></g></svg>
            </button>
            <input id="bm-file-input" type="file" multiple style="display:none" />
          </div>
          <div id="bm-error" class="bm-error" style="display:none"></div>
        </div>
      </main>
    </div>
    <?php
    return ob_get_clean();
  }

  public function shortcode_bm_ms_form($atts = [], $content = null){
    ob_start();
    ?>
    <section class="bm-ms-form bmms-theme-godaddy" id="bm-ms-form" aria-label="BrandMe multi-step logo form">
      <div class="bm-ms-form-content">

      <!-- Step 1: Describe business + Name + Email -->
      <form id="bmms-step1" class="bmms-step active" autocomplete="off">
        <div class="bmms-splash-header">
          <div class="bmms-logo-anim" aria-hidden="true">
            <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          </div>
          <h2 class="bmms-title">Hi, I'm your AI-powered assistant.</h2>
          <p class="bmms-sub">Let’s create a logo together.</p>
        </div>
        <div class="bmms-fields">
          <label class="field bmms-optional"><span>Your name</span>
            <input type="text" name="name" placeholder="Jane Doe" />
          </label>
          <label class="field bmms-optional"><span>Email</span>
            <input type="email" name="email" placeholder="you@company.com" />
          </label>
          <label class="field"><span>Describe your business</span>
            <input type="text" name="description" placeholder="brandmenow" />
          </label>
          <p class="bmms-tip">Tip: Including your business name gives me more to work with.</p>
        </div>
        <div class="bmms-actions">
          <button type="submit" class="bmms-btn bmms-btn-primary">Get Started</button>
        </div>
      </form>

      <!-- Step 2: Splash + icon options (single select) -->
      <div id="bmms-step2" class="bmms-step" data-step="2">
        <div class="bmms-splash">
          <div class="bmms-logo-anim large" aria-hidden="true"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
          <div class="bmms-splash-text">Hang tight, I’m getting your logo started</div>
        </div>
        <div class="bmms-options" style="display:none" aria-live="polite">
          <h3 class="bmms-section-title">Optional: Provide a social handle for a quick vibe scan</h3>
           <div class="bmms-fields" style="max-width:500px;margin:0 auto 12px">
             <label class="field bmms-optional"><span>Social handle (optional)</span>
               <input type="text" name="social_handle" placeholder="@brand" />
             </label>
             <div class="bmms-tip">If provided, we’ll summarize audience & vibe before proceeding.</div>
             <div class="bmms-social-summary" style="display:none"></div>
           </div>

          <!-- Icon selection removed for minimalist Step 2 UI -->

          <h3 class="bmms-section-title" style="margin-top:16px">Pick up to 3 styles</h3>
          <div class="bmms-style-grid" role="group" aria-label="Logo styles" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-width:680px;margin:8px auto">
            <button type="button" class="bmms-btn bmms-style-btn" data-style="Futuristic">Futuristic</button>
            <button type="button" class="bmms-btn bmms-style-btn" data-style="Elegant">Elegant</button>
            <button type="button" class="bmms-btn bmms-style-btn" data-style="Corporate">Corporate</button>
            <button type="button" class="bmms-btn bmms-style-btn" data-style="Classic">Classic</button>
            <button type="button" class="bmms-btn bmms-style-btn" data-style="Geometric">Geometric</button>
            <button type="button" class="bmms-btn bmms-style-btn" data-style="Abstract">Abstract</button>
            <button type="button" class="bmms-btn bmms-style-btn" data-style="Hand-draw">Hand-draw</button>
            <button type="button" class="bmms-btn bmms-style-btn" data-style="Mascot">Mascot</button>
            <button type="button" class="bmms-btn bmms-style-btn" data-style="Minimalist">Minimalist</button>
            <button type="button" class="bmms-btn bmms-style-btn" data-style="Symbolic">Symbolic</button>
            <button type="button" class="bmms-btn bmms-style-btn" data-style="Vintage">Vintage</button>
            <button type="button" class="bmms-btn bmms-style-btn" data-style="Art Deco">Art Deco</button>
            <button type="button" class="bmms-btn bmms-style-btn" data-style="Grunge">Grunge</button>
            <button type="button" class="bmms-btn bmms-style-btn" data-style="Modern">Modern</button>
            <button type="button" class="bmms-btn bmms-style-btn" data-style="Nature">Nature</button>
            <button type="button" class="bmms-btn bmms-style-btn" data-style="Monogram">Monogram</button>
            <button type="button" class="bmms-btn bmms-style-btn" data-style="Line Art">Line Art</button>
          </div>

          <div class="bmms-actions">
            <button type="button" class="bmms-btn bmms-back">Back</button>
            <button type="button" class="bmms-btn bmms-btn-primary bmms-next" data-next="3">Continue</button>
          </div>
        </div>
      </div>

      <!-- Step 3: Splash + text input -->
      <div id="bmms-step3" class="bmms-step" data-step="3">
        <div class="bmms-splash">
          <div class="bmms-logo-anim large" aria-hidden="true"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
          <div class="bmms-splash-text">Just a moment, I’m getting your logo started</div>
        </div>
        <div class="bmms-fields" style="display:none">
          <label class="field"><span>Brand name</span>
            <div class="bmms-flex-row">
              <input type="text" name="brand_text" placeholder="e.g., SwiftBoost" />
              <button type="button" class="bmms-btn bmms-generate" title="Generate options">Generate</button>
            </div>
          </label>
          <div class="bmms-name-options" style="display:none;margin:8px 0"></div>
          <label class="field"><span>Tagline (optional)</span>
            <input type="text" name="brand_tagline" placeholder="e.g., Fuel your growth" />
          </label>
          <div id="bmms-selected-styles" class="bmms-selected-styles" style="display:none;margin:6px 0 12px;color:#64748b;font-size:13px"></div>
          <label class="field"><span>Describe your brand vibe (optional)</span>
            <textarea name="brand_desc" placeholder="e.g., modern, trustworthy, energetic"></textarea>
          </label>
          <div class="bmms-actions">
            <button type="button" class="bmms-btn bmms-back">Back</button>
            <button type="button" class="bmms-btn bmms-btn-primary bmms-next" data-next="4">Continue</button>
          </div>
        </div>
      </div>

      <!-- Step 4: Splash + slider with 12 variations (3 x 4) -->
      <div id="bmms-step4" class="bmms-step" data-step="4">
        <div class="bmms-splash">
          <div class="bmms-logo-anim large" aria-hidden="true"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
          <div class="bmms-splash-text">Hold on, I’m adding your text, generating layouts…</div>
          <div class="bmms-splash-sub">This may take a few minutes. <span id="bmms-endpoint-text" style="display:block;margin-top:4px;font-size:12px;color:#64748b"></span></div>
        </div>
        <div class="bmms-slider" style="display:none">
          <button class="bmms-slide-nav prev" aria-label="Previous">‹</button>
          <button class="bmms-slide-nav next" aria-label="Next">›</button>
          <div class="bmms-slides" aria-live="polite"></div>
          <div class="bmms-actions">
            <button type="button" class="bmms-btn bmms-back">Back</button>
            <button type="button" class="bmms-btn bmms-btn-primary bmms-next" data-next="5">Continue</button>
          </div>
        </div>
      </div>

      <!-- Step 5: Final preview + zoom + download -->
      <div id="bmms-step5" class="bmms-step" data-step="5">
        <div class="bmms-splash">
          <div class="bmms-logo-anim large" aria-hidden="true"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
          <div class="bmms-splash-text">Finalizing your logo…</div>
        </div>
        <div class="bmms-final" style="display:none">
          <div class="bmms-final-view">
            <img id="bmms-final-image" alt="Final logo preview" />
            <button type="button" class="bmms-btn bmms-zoom">Zoom</button>
          </div>
          <div class="bmms-actions">
            <button type="button" class="bmms-btn bmms-back">Back</button>
            <button type="button" class="bmms-btn bmms-btn-primary bmms-next" data-next="6">Continue</button>
            <button type="button" class="bmms-btn bmms-download">Download PNG</button>
          </div>
          <div class="bmms-zoom-overlay" role="dialog" aria-modal="true" style="display:none">
            <div class="bmms-zoom-inner"><img id="bmms-zoom-image" alt="Zoomed logo" /><button class="bmms-zoom-close" aria-label="Close">×</button></div>
          </div>
        </div>
      </div>

      <!-- Step 6: Product selection -->
      <div id="bmms-step6" class="bmms-step" data-step="6">
        <div class="bmms-splash">
          <div class="bmms-logo-anim large" aria-hidden="true"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
          <div class="bmms-splash-text">Pick a product category and SKU</div>
        </div>
        <div class="bmms-fields" style="display:none">
          <h3 class="bmms-section-title">Choose a category</h3>
          <div class="bmms-category-grid" role="group" aria-label="Product categories" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-width:680px;margin:8px auto">
            <button type="button" class="bmms-btn bmms-cat" data-cat="Energy">Energy</button>
            <button type="button" class="bmms-btn bmms-cat" data-cat="Beauty">Beauty</button>
            <button type="button" class="bmms-btn bmms-cat" data-cat="Fitness">Fitness</button>
            <button type="button" class="bmms-btn bmms-cat" data-cat="Pets">Pets</button>
            <button type="button" class="bmms-btn bmms-cat" data-cat="Outdoor">Outdoor</button>
            <button type="button" class="bmms-btn bmms-cat" data-cat="Home">Home</button>
          </div>
          <div class="bmms-sku-list" style="display:none"></div>
          <div class="bmms-actions">
            <button type="button" class="bmms-btn bmms-back">Back</button>
            <button type="button" class="bmms-btn bmms-btn-primary bmms-next" data-next="7" disabled>Continue</button>
          </div>
        </div>
      </div>

      <!-- Step 7: Label preview with nudge controls -->
      <div id="bmms-step7" class="bmms-step" data-step="7">
        <div class="bmms-splash">
          <div class="bmms-logo-anim large" aria-hidden="true"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
          <div class="bmms-splash-text">Rendering your label preview…</div>
        </div>
        <div class="bmms-final" style="display:none">
          <div class="bmms-final-view">
            <img id="bmms-nudge-preview" alt="Label preview" />
          </div>
          <div class="bmms-nudges" style="display:flex;gap:8px;justify-content:center;margin:8px 0">
            <button type="button" class="bmms-btn bmms-nudge-up">Move Up</button>
            <button type="button" class="bmms-btn bmms-nudge-down">Move Down</button>
            <button type="button" class="bmms-btn bmms-nudge-bigger">Bigger Logo</button>
            <button type="button" class="bmms-btn bmms-nudge-smaller">Smaller Logo</button>
            <button type="button" class="bmms-btn bmms-nudge-bg">Change BG</button>
          </div>
          <div class="bmms-actions">
            <button type="button" class="bmms-btn bmms-back">Back</button>
            <button type="button" class="bmms-btn bmms-btn-primary bmms-next" data-next="8">Continue</button>
          </div>
        </div>
      </div>

      <!-- Step 8: Profit calculator -->
      <div id="bmms-step8" class="bmms-step" data-step="8">
        <div class="bmms-splash">
          <div class="bmms-logo-anim large" aria-hidden="true"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
          <div class="bmms-splash-text">Let’s estimate your campaign results…</div>
        </div>
        <div class="bmms-fields" style="display:none">
          <div class="bmms-grid-2" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;max-width:680px;margin:0 auto">
            <label class="field"><span>Followers</span><input type="number" name="followers" placeholder="10000" /></label>
            <label class="field"><span>Conversion %</span><input type="number" name="conv" placeholder="2" /></label>
            <label class="field"><span>Price per unit ($)</span><input type="number" name="price" placeholder="19" /></label>
            <label class="field"><span>Margin %</span><input type="number" name="margin" placeholder="50" /></label>
          </div>
          <div class="bmms-profit-result" style="text-align:center;margin:12px 0"></div>
          <div class="bmms-actions">
            <button type="button" class="bmms-btn bmms-back">Back</button>
            <button type="button" class="bmms-btn bmms-btn-primary bmms-next" data-next="9">Continue</button>
          </div>
        </div>
      </div>

      <!-- Step 9: Book calendar (GHL) -->
      <div id="bmms-step9" class="bmms-step" data-step="9">
        <div class="bmms-splash">
          <div class="bmms-logo-anim large" aria-hidden="true"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
          <div class="bmms-splash-text">Book a call to finalize</div>
        </div>
        <div class="bmms-fields" style="display:none">
          <div class="bmms-ghl-calendar" style="min-height:360px;border-radius:8px">
            <iframe src="https://api.leadconnectorhq.com/widget/booking/UL9SNgWU3gjlVPKyzTMv" style="width: 100%;border:none;overflow: hidden;min-height:360px;" scrolling="no" id="UL9SNgWU3gjlVPKyzTMv_1761625908434"></iframe>
            <script src="https://link.msgsndr.com/js/form_embed.js" type="text/javascript"></script>
          </div>
          <div class="bmms-actions">
            <button type="button" class="bmms-btn bmms-back">Back</button>
            <button type="button" class="bmms-btn bmms-btn-primary bmms-next" data-next="done">Confirm</button>
          </div>
        </div>
      </div>

      </div>
    </section>
    <?php
    return ob_get_clean();
  }

  public function admin_menu(){
    add_menu_page('AG‑UI CRM', 'AG‑UI CRM', 'manage_options', 'agui-crm', [$this, 'render_admin'], 'dashicons-format-chat', 26);
  }

  public function register_settings(){
    register_setting('agui_crm', self::OPTION_KEY);

    add_settings_section('agui_core', 'AG‑UI Endpoints', function(){
      echo '<p>Configure AG‑UI connection endpoints (SSE/WebSocket) used by the chat UI.</p>';
    }, 'agui_crm');

    add_settings_field('sse_url', 'SSE URL', [$this, 'field_text'], 'agui_crm', 'agui_core', ['key'=>'sse_url']);
    add_settings_field('ws_url',  'WebSocket URL', [$this, 'field_text'], 'agui_crm', 'agui_core', ['key'=>'ws_url']);
    add_settings_field('send_url','Send URL', [$this, 'field_text'], 'agui_crm', 'agui_core', ['key'=>'send_url']);
    add_settings_field('prefer_ws','Prefer WebSocket', [$this, 'field_checkbox'], 'agui_crm', 'agui_core', ['key'=>'prefer_ws']);
    add_settings_field('fallback_url','Fallback URL', [$this, 'field_text'], 'agui_crm', 'agui_core', ['key'=>'fallback_url']);

    add_settings_section('agency_api', 'Agency API (FastAPI)', function(){
      echo '<p>Optional: configure your local or hosted Agency API used for image generation and advanced tools.</p>';
    }, 'agui_crm');
    add_settings_field('fastapi_base', 'FastAPI Base URL', [$this, 'field_text'], 'agui_crm', 'agency_api', ['key'=>'fastapi_base']);
    add_settings_field('db_token', 'Bearer Token (DB_TOKEN, optional)', [$this, 'field_text'], 'agui_crm', 'agency_api', ['key'=>'db_token']);

    add_settings_section('banana_ai', 'Banana.dev (Primary Image Generation)', function(){
      echo '<p>Primary: configure Banana.dev for AI image generation. This will be tried first before falling back to Fal AI or local endpoints.</p>';
    }, 'agui_crm');
    add_settings_field('banana_key', 'Banana API Key', [$this, 'field_text'], 'agui_crm', 'banana_ai', ['key'=>'banana_key']);
    add_settings_field('banana_model', 'Banana Model Key', [$this, 'field_text'], 'agui_crm', 'banana_ai', ['key'=>'banana_model']);

    add_settings_section('fal_ai', 'Fal AI (Fallback)', function(){
      echo '<p>Fallback: configure server-side Fal AI as a backup when Banana.dev is not available. This avoids mixed-content and reachability issues.</p>';
    }, 'agui_crm');
    add_settings_field('fal_key', 'Fal API Key', [$this, 'field_text'], 'agui_crm', 'fal_ai', ['key'=>'fal_key']);
    add_settings_field('fal_model', 'Fal Model', [$this, 'field_text'], 'agui_crm', 'fal_ai', ['key'=>'fal_model']);




    add_settings_section('ghl', 'GoHighLevel (Private Integration)', function(){
      echo '<p>Provide your GoHighLevel Private Integration Token (PIT) and Location ID. The plugin will use them server-side to create contacts from the pre‑chat form without exposing secrets client-side.</p>';
    }, 'agui_crm');

    add_settings_field('ghl_pit', 'Private Integration Token (PIT)', [$this, 'field_text'], 'agui_crm', 'ghl', ['key'=>'ghl_pit']);
    add_settings_field('ghl_location_id', 'Location ID', [$this, 'field_text'], 'agui_crm', 'ghl', ['key'=>'ghl_location_id']);
    add_settings_field('ghl_api_base', 'API Base', [$this, 'field_text'], 'agui_crm', 'ghl', ['key'=>'ghl_api_base']);
    add_settings_field('ghl_version', 'API Version Header', [$this, 'field_text'], 'agui_crm', 'ghl', ['key'=>'ghl_version']);

    add_settings_section('crm_dash', 'CRM Dashboards', function(){
      echo '<p>Links to current CRM dashboards for quick access.</p>';
    }, 'agui_crm');

    foreach(['leads','contacts','deals','tickets'] as $k){
      add_settings_field('dash_'.$k, ucfirst($k).' Dashboard URL', [$this, 'field_text_nested'], 'agui_crm', 'crm_dash', ['group'=>'crm_dashboards','key'=>$k]);
    }

    add_settings_section('crm_api', 'CRM API Endpoints', function(){
      echo '<p>Base API endpoints available for integration in front-end or server-side code.</p>';
    }, 'agui_crm');

    foreach(['leads','contacts','deals','tickets'] as $k){
      add_settings_field('api_'.$k, ucfirst($k).' API URL', [$this, 'field_text_nested'], 'agui_crm', 'crm_api', ['group'=>'crm_apis','key'=>$k]);
    }
  }

  public function field_text($args){
    $cfg = self::get_settings(); $key=$args['key']; $val=esc_attr($cfg[$key] ?? '');
    echo "<input type='text' name='".self::OPTION_KEY."[$key]' value='$val' class='regular-text' />";
  }

  public function field_checkbox($args){
    $cfg = self::get_settings(); $key=$args['key']; $checked = !empty($cfg[$key]) ? 'checked' : '';
    echo "<label><input type='checkbox' name='".self::OPTION_KEY."[$key]' value='1' $checked /> Prefer WebSocket</label>";
  }

  public function field_text_nested($args){
    $cfg = self::get_settings(); $group=$args['group']; $key=$args['key']; $val=esc_attr($cfg[$group][$key] ?? '');
    echo "<input type='text' name='".self::OPTION_KEY."[$group][$key]' value='$val' class='regular-text' />";
  }

  public function render_admin(){
    echo '<div class="wrap"><h1>AG‑UI CRM Settings</h1>';
    echo '<form method="post" action="options.php">';
    settings_fields('agui_crm');
    do_settings_sections('agui_crm');
    submit_button('Save Settings');
    echo '</form></div>';
  }

  // REST: capture pre‑chat info and create a GHL contact
  public function register_rest(){
    register_rest_route('agui-chat/v1', '/ghl/contact', [
      'methods' => 'POST',
      'callback' => [$this, 'rest_ghl_contact'],
      'permission_callback' => '__return_true', // public submit; consider nonce in production
    ]);

    register_rest_route('agui-chat/v1', '/image/generate', [
      'methods' => 'POST',
      'callback' => [$this, 'rest_image_generate'],
      'permission_callback' => '__return_true', // public for now; add nonce/rate-limit in production
    ]);

    // Proxy SEND to agent-server to avoid browser TLS trust issues; WP can skip SSL verification.
    register_rest_route('agui-chat/v1', '/agent/send', [
      'methods' => 'POST',
      'callback' => [$this, 'rest_agent_send'],
      'permission_callback' => '__return_true', // public for now; add nonce/rate-limit in production
    ]);

    // Expose current settings for real-time synchronization
    register_rest_route('agui-chat/v1', '/settings', [
      'methods' => 'GET',
      'callback' => [$this, 'rest_settings'],
      'permission_callback' => '__return_true', // public read; add auth in production if needed
    ]);

    // New: Tag a GHL contact for asset delivery
    register_rest_route('agui-chat/v1', '/ghl/tag', [
      'methods' => 'POST',
      'callback' => [$this, 'rest_ghl_tag'],
      'permission_callback' => '__return_true', // public for now; add nonce/rate-limit in production
    ]);
  }

  public function rest_ghl_contact($request){
    $data = $request->get_json_params();
    if(!$data){ $data = $request->get_body_params(); }
    if(!$data){
      $raw = method_exists($request,'get_body') ? $request->get_body() : '';
      if($raw){
        $decoded = json_decode($raw, true);
        if(is_array($decoded)) $data = $decoded;
      }
    }
    $cfg = self::get_settings();
    if(empty($cfg['ghl_pit']) || empty($cfg['ghl_location_id'])){
      return new WP_REST_Response(['ok'=>false,'error'=>'GHL not configured'], 400);
    }

    $payload = [
      'firstName' => isset($data['name']) ? $data['name'] : ($data['firstName'] ?? ''),
      'email' => isset($data['email']) ? trim($data['email']) : '',
      'phone' => $data['phone'] ?? '',
      'locationId' => $cfg['ghl_location_id'],
      'customFields' => [
        ['name'=>'Brand Idea','value'=>$data['idea'] ?? '']
      ]
    ];

    $token = trim($cfg['ghl_pit']);
    if(stripos($token, 'bearer ') !== 0){
      $token = 'Bearer '.$token;
    }
    $base = rtrim($cfg['ghl_api_base'],'/');

    // Create/Update contact
    $resp = wp_remote_post($base.'/contacts/', [
      'headers' => [
        'Authorization' => $token,
        'Content-Type' => 'application/json',
        'Accept' => 'application/json',
        'Version' => $cfg['ghl_version'],
      ],
      'body' => wp_json_encode($payload),
      'timeout' => 20,
    ]);
    if(is_wp_error($resp)){
      return new WP_REST_Response(['ok'=>false,'error'=>$resp->get_error_message()], 500);
    }

    $code = wp_remote_retrieve_response_code($resp);
    $body_raw = wp_remote_retrieve_body($resp);
    $body = json_decode($body_raw, true);

    // Extract possible contactId from various shapes
    $idFromCreate = '';
    if (is_array($body)) {
      if (isset($body['contactId'])) { $idFromCreate = $body['contactId']; }
      elseif (isset($body['id'])) { $idFromCreate = $body['id']; }
      elseif (isset($body['data']['contactId'])) { $idFromCreate = $body['data']['contactId']; }
      elseif (isset($body['_id'])) { $idFromCreate = $body['_id']; }
      elseif (isset($body['contact']['id'])) { $idFromCreate = $body['contact']['id']; }
      elseif (isset($body['data']['id'])) { $idFromCreate = $body['data']['id']; }
    }

    // If duplicate error OR no id returned but we have email, try to find existing contact
    $email = isset($payload['email']) ? trim($payload['email']) : '';
    $isDuplicateMsg = ($code === 400) && is_array($body) && (
      (isset($body['message']) && stripos($body['message'], 'duplicated') !== false) ||
      (isset($body['error']) && stripos($body['error'], 'duplicated') !== false)
    );

    // NEW: If duplicate and upstream provided a contactId in meta, return OK with that ID
    if ($isDuplicateMsg && isset($body['meta']) && isset($body['meta']['contactId']) && $body['meta']['contactId']) {
      return new WP_REST_Response([
        'ok' => true,
        'code' => 200,
        'data' => $body,
        'contactId' => $body['meta']['contactId'],
        'dedup' => true
      ], 200);
    }

    if (($isDuplicateMsg || !$idFromCreate) && $email) {
      $headers = [
        'Authorization' => $token,
        'Accept' => 'application/json',
        'Version' => $cfg['ghl_version'],
      ];
      $urls = [
        $base . '/contacts/search?locationId=' . urlencode($cfg['ghl_location_id']) . '&query=' . urlencode($email),
        $base . '/contacts?locationId=' . urlencode($cfg['ghl_location_id']) . '&email=' . urlencode($email),
        $base . '/contacts?email=' . urlencode($email),
        $base . '/contacts/search?query=' . urlencode($email),
      ];

      foreach ($urls as $u) {
        $res = wp_remote_get($u, [ 'headers' => $headers, 'timeout' => 20 ]);
        if (is_wp_error($res)) { continue; }
        $raw = wp_remote_retrieve_body($res);
        $json = json_decode($raw, true);
        $foundId = '';
        if (is_array($json)) {
          if (isset($json['contacts']) && is_array($json['contacts']) && isset($json['contacts'][0]['id'])) { $foundId = $json['contacts'][0]['id']; }
          elseif (isset($json['data']['contacts']) && is_array($json['data']['contacts']) && isset($json['data']['contacts'][0]['id'])) { $foundId = $json['data']['contacts'][0]['id']; }
          elseif (isset($json['contact']['id'])) { $foundId = $json['contact']['id']; }
          elseif (isset($json['id'])) { $foundId = $json['id']; }
          elseif (isset($json['data']['id'])) { $foundId = $json['data']['id']; }
          elseif (isset($json['result']['contacts']) && is_array($json['result']['contacts']) && isset($json['result']['contacts'][0]['id'])) { $foundId = $json['result']['contacts'][0]['id']; }
        }
        if ($foundId) {
          return new WP_REST_Response(['ok'=>true,'code'=>200,'data'=>$json,'contactId'=>$foundId,'dedup'=>true], 200);
        }
      }
    }

    // Fallback to normal response
    $contactId = $idFromCreate;
    return new WP_REST_Response(['ok'=>($code>=200 && $code<300),'code'=>$code,'data'=>$body,'contactId'=>$contactId], $code);
  }

  public function rest_ghl_tag($request){
    $data = $request->get_json_params();
    if(!$data){ $data = $request->get_body_params(); }
    if(!$data){
      $raw = method_exists($request,'get_body') ? $request->get_body() : '';
      if($raw){ $decoded = json_decode($raw, true); if(is_array($decoded)) $data = $decoded; }
    }

    $cfg = self::get_settings();
    if(empty($cfg['ghl_pit']) || empty($cfg['ghl_location_id'])){
      return new WP_REST_Response(['ok'=>false,'error'=>'GHL not configured'], 400);
    }

    $token = trim($cfg['ghl_pit']);
    if(stripos($token, 'bearer ') !== 0){ $token = 'Bearer '.$token; }
    $base = rtrim($cfg['ghl_api_base'],'/');

    $contactId = '';
    if(isset($data['contact_id']) && $data['contact_id']){ $contactId = $data['contact_id']; }
    elseif(isset($data['contactId']) && $data['contactId']){ $contactId = $data['contactId']; }

    $email = isset($data['email']) ? trim($data['email']) : '';

    // If no contactId, try to locate by email
    if(!$contactId && $email){
      $headers = [
        'Authorization' => $token,
        'Accept' => 'application/json',
        'Version' => $cfg['ghl_version'],
      ];
      $urls = [
        $base . '/contacts/search?locationId=' . urlencode($cfg['ghl_location_id']) . '&query=' . urlencode($email),
        $base . '/contacts?locationId=' . urlencode($cfg['ghl_location_id']) . '&email=' . urlencode($email),
        $base . '/contacts?email=' . urlencode($email),
        $base . '/contacts/search?query=' . urlencode($email),
      ];
      foreach ($urls as $u) {
        $res = wp_remote_get($u, [ 'headers' => $headers, 'timeout' => 20 ]);
        if (is_wp_error($res)) { continue; }
        $raw = wp_remote_retrieve_body($res);
        $json = json_decode($raw, true);
        if (is_array($json)) {
          if (isset($json['contacts'][0]['id'])) { $contactId = $json['contacts'][0]['id']; }
          elseif (isset($json['data']['contacts'][0]['id'])) { $contactId = $json['data']['contacts'][0]['id']; }
          elseif (isset($json['contact']['id'])) { $contactId = $json['contact']['id']; }
          elseif (isset($json['id'])) { $contactId = $json['id']; }
          elseif (isset($json['data']['id'])) { $contactId = $json['data']['id']; }
          elseif (isset($json['result']['contacts'][0]['id'])) { $contactId = $json['result']['contacts'][0]['id']; }
        }
        if ($contactId) break;
      }
    }

    if(!$contactId){
      return new WP_REST_Response(['ok'=>false,'error'=>'Contact not found'], 404);
    }

    $tag = '';
    if(isset($data['tag']) && $data['tag']){ $tag = trim($data['tag']); }
    elseif(isset($data['tagName']) && $data['tagName']){ $tag = trim($data['tagName']); }
    if(!$tag){ $tag = 'AGUI_AssetsReady'; }

    $headers_common = [
      'Authorization' => $token,
      'Content-Type' => 'application/json',
      'Accept' => 'application/json',
      'Version' => $cfg['ghl_version'],
    ];

    // Attempt 1: POST /contacts/tags
    $body1 = [
      'contactId' => $contactId,
      'tags' => [$tag],
      'locationId' => $cfg['ghl_location_id'],
    ];
    $resp1 = wp_remote_post($base.'/contacts/tags', [
      'headers' => $headers_common,
      'body' => wp_json_encode($body1),
      'timeout' => 20,
    ]);
    if(!is_wp_error($resp1)){
      $code1 = wp_remote_retrieve_response_code($resp1);
      $raw1 = wp_remote_retrieve_body($resp1);
      $json1 = json_decode($raw1, true);
      if($code1>=200 && $code1<300){
        return new WP_REST_Response(['ok'=>true,'code'=>$code1,'data'=>$json1,'contactId'=>$contactId,'tag'=>$tag], 200);
      }
    }

    // Attempt 2: POST /contacts/{id}/tags
    $body2 = [ 'tags' => [$tag] ];
    $resp2 = wp_remote_post($base.'/contacts/'.$contactId.'/tags', [
      'headers' => $headers_common,
      'body' => wp_json_encode($body2),
      'timeout' => 20,
    ]);
    if(!is_wp_error($resp2)){
      $code2 = wp_remote_retrieve_response_code($resp2);
      $raw2 = wp_remote_retrieve_body($resp2);
      $json2 = json_decode($raw2, true);
      if($code2>=200 && $code2<300){
        return new WP_REST_Response(['ok'=>true,'code'=>$code2,'data'=>$json2,'contactId'=>$contactId,'tag'=>$tag], 200);
      }
    }

    // Attempt 3: Alternate body { tag: "" }
    $body3 = [ 'tag' => $tag ];
    $resp3 = wp_remote_post($base.'/contacts/'.$contactId.'/tags', [
      'headers' => $headers_common,
      'body' => wp_json_encode($body3),
      'timeout' => 20,
    ]);
    if(!is_wp_error($resp3)){
      $code3 = wp_remote_retrieve_response_code($resp3);
      $raw3 = wp_remote_retrieve_body($resp3);
      $json3 = json_decode($raw3, true);
      if($code3>=200 && $code3<300){
        return new WP_REST_Response(['ok'=>true,'code'=>$code3,'data'=>$json3,'contactId'=>$contactId,'tag'=>$tag], 200);
      }
      return new WP_REST_Response(['ok'=>false,'code'=>$code3,'error'=>$raw3,'contactId'=>$contactId,'tag'=>$tag], $code3);
    }

    // Network error on all attempts
    return new WP_REST_Response(['ok'=>false,'error'=>is_wp_error($resp1)?$resp1->get_error_message():'Unknown error','contactId'=>$contactId,'tag'=>$tag], 500);
  }

  // Helper: try Banana.dev image generation with polling
  private function try_banana_generate($api_key, $model_key, $prompt, $body_arr) {
    // Start the Banana.dev job
    $start_url = 'https://api.banana.dev/start/v4/';
    $start_headers = [
      'Content-Type' => 'application/json',
      'Authorization' => 'Bearer ' . $api_key,
    ];
    $start_body = [
      'apiKey' => $api_key,
      'modelKey' => $model_key,
      'modelInputs' => [
        'prompt' => $prompt,
        'width' => 1024,
        'height' => 1024,
        'guidance_scale' => 7.5,
        'num_inference_steps' => 20,
        'seed' => rand(1, 1000000)
      ]
    ];

    $start_resp = wp_remote_post($start_url, [
      'headers' => $start_headers,
      'body' => json_encode($start_body),
      'timeout' => 30,
    ]);

    if (is_wp_error($start_resp)) {
      return null;
    }

    $start_code = wp_remote_retrieve_response_code($start_resp);
    $start_json = json_decode(wp_remote_retrieve_body($start_resp), true);

    if ($start_code < 200 || $start_code >= 300 || !isset($start_json['callID'])) {
      return null;
    }

    $call_id = $start_json['callID'];

    // Poll for completion (max 60 seconds)
    $check_url = 'https://api.banana.dev/check/v4/';
    $check_headers = [
      'Content-Type' => 'application/json',
      'Authorization' => 'Bearer ' . $api_key,
    ];
    $check_body = [
      'apiKey' => $api_key,
      'callID' => $call_id,
    ];

    $max_attempts = 30; // 30 attempts * 2 seconds = 60 seconds max
    for ($i = 0; $i < $max_attempts; $i++) {
      sleep(2); // Wait 2 seconds between checks

      $check_resp = wp_remote_post($check_url, [
        'headers' => $check_headers,
        'body' => json_encode($check_body),
        'timeout' => 10,
      ]);

      if (is_wp_error($check_resp)) {
        continue;
      }

      $check_code = wp_remote_retrieve_response_code($check_resp);
      $check_json = json_decode(wp_remote_retrieve_body($check_resp), true);

      if ($check_code >= 200 && $check_code < 300 && isset($check_json['finished']) && $check_json['finished']) {
        // Job completed, extract image
        $img_url = $this->find_image_url($check_json);
        if ($img_url) {
          return new WP_REST_Response(['ok' => true, 'status' => 200, 'data' => ['image_url' => $img_url]], 200);
        }
      }
    }

    // Timeout - job didn't complete in time
    return null;
  }

  // Helper: extract image URL from varied Fal/Agent/FastAPI response shapes
  private function find_image_url($data) {
    // Fast path: direct URL string
    if (is_string($data) && preg_match('/^https?:\/\//', $data)) return $data;

    $d = is_array($data) ? $data : [];
    $candidates = [];
    // Common flat fields
    $candidates[] = $d['image_url'] ?? null;
    $candidates[] = $d['url'] ?? null;
    if (isset($d['image']) && is_string($d['image'])) $candidates[] = $d['image'];
    $candidates[] = $d['data_uri'] ?? null;
    $candidates[] = $d['dataUrl'] ?? null;
    $candidates[] = $d['image_base64'] ?? null;
    $candidates[] = $d['base64'] ?? null;
    $candidates[] = $d['b64_json'] ?? null; // OpenAI/Fal style base64 field
    $candidates[] = $d['content'] ?? null;  // sometimes inline SVG/content

    // Nested/array shapes
    if (isset($d['images'][0]['url'])) $candidates[] = $d['images'][0]['url'];
    if (isset($d['images'][0]['b64_json'])) $candidates[] = $d['images'][0]['b64_json'];

    if (isset($d['output']['images'][0]['url'])) $candidates[] = $d['output']['images'][0]['url'];
    if (isset($d['output']['images'][0]['b64_json'])) $candidates[] = $d['output']['images'][0]['b64_json'];

    if (isset($d['result']['images'][0]['url'])) $candidates[] = $d['result']['images'][0]['url'];
    if (isset($d['result']['images'][0]['b64_json'])) $candidates[] = $d['result']['images'][0]['b64_json'];

    if (isset($d['data']['images'][0]['url'])) $candidates[] = $d['data']['images'][0]['url'];
    if (isset($d['data']['images'][0]['b64_json'])) $candidates[] = $d['data']['images'][0]['b64_json'];

    if (isset($d['data']['image_url'])) $candidates[] = $d['data']['image_url'];
    if (isset($d['data']['image']['url'])) $candidates[] = $d['data']['image']['url'];
    if (isset($d['data']['image']['base64'])) $candidates[] = $d['data']['image']['base64'];
    if (isset($d['data']['image']['data_uri'])) $candidates[] = $d['data']['image']['data_uri'];

    if (isset($d['image']['url'])) $candidates[] = $d['image']['url'];
    if (isset($d['image']['data_uri'])) $candidates[] = $d['image']['data_uri'];
    if (isset($d['image']['base64'])) $candidates[] = $d['image']['base64'];

    // Return first usable candidate
    foreach ($candidates as $u) {
      if (!is_string($u) || $u === '') continue;
      $t = trim($u);
      // Direct URL
      if (preg_match('/^https?:\/\//i', $t)) return $t;
      // Data URI
      if (preg_match('/^data:image\//i', $t)) return $t;
      // Raw SVG markup
      if (preg_match('/^<svg[\s\S]*<\/svg>$/i', $t)) {
        return 'data:image/svg+xml;charset=utf-8,' . rawurlencode($t);
      }
      // Base64 image content (long tokens)
      if (preg_match('/^[A-Za-z0-9+\/]+=*$/', $t) && strlen($t) > 100) {
        return 'data:image/png;base64,' . $t;
      }
    }

    // Deep scan: walk nested arrays/objects to find any image-like string
    $is_img_string = function($s){
      if (!is_string($s) || $s === '') return false;
      $t = trim($s);
      return preg_match('/^https?:\/\//i', $t)
          || preg_match('/^data:image\//i', $t)
          || preg_match('/^<svg[\s\S]*<\/svg>$/i', $t)
          || (preg_match('/^[A-Za-z0-9+\/]+=*$/', $t) && strlen($t) > 100);
    };
    $walk = function($v) use (&$walk, $is_img_string){
      if ($is_img_string($v)) return $v;
      if (is_array($v)) {
        // prefer common keys first
        $preferred = ['image','image_url','url','data_uri','dataUrl','base64','image_base64','b64_json','content','data','output','result','images'];
        $keys = array_keys($v);
        usort($keys, function($a,$b) use ($preferred){ return array_search($a,$preferred) - array_search($b,$preferred); });
        foreach ($keys as $k){ $res = $walk($v[$k]); if ($res) return $res; }
      }
      return '';
    };
    $found = $walk($d);
    if (is_string($found) && $found !== ''){
      $t = trim($found);
      if (preg_match('/^<svg/i', $t)) return 'data:image/svg+xml;charset=utf-8,' . rawurlencode($t);
      if (preg_match('/^[A-Za-z0-9+\/]+=*$/', $t) && strlen($t) > 100) return 'data:image/png;base64,' . $t;
      return $t;
    }

    return '';
  }

  public function rest_image_generate($request){
    $params = $request->get_json_params();
    if(!$params){ $params = $request->get_body_params(); }
    if(!$params){
      $raw = method_exists($request,'get_body') ? $request->get_body() : '';
      if($raw){ $decoded = json_decode($raw, true); if(is_array($decoded)) $params = $decoded; }
    }
    $prompt = isset($params['prompt']) ? $params['prompt'] : '';
    $prompt = is_string($prompt) ? trim($prompt) : '';
    $prompt = trim($prompt, " \t\n\r\0\x0B\"'`");
    $image_url = isset($params['image_url']) ? $params['image_url'] : '';
    $image_url = is_string($image_url) ? trim($image_url) : '';
    $image_url = trim($image_url, " \t\n\r\0\x0B\"'`");
    $mask_url = isset($params['mask_url']) ? $params['mask_url'] : '';
    $mask_url = is_string($mask_url) ? trim($mask_url) : '';
    $mask_url = trim($mask_url, " \t\n\r\0\x0B\"'`");
    // Optional advanced parameters for Fal models
    $size = isset($params['size']) ? $params['size'] : '1024x1024';
    $guidance = isset($params['guidance_scale']) ? floatval($params['guidance_scale']) : null;
    $steps = isset($params['num_inference_steps']) ? intval($params['num_inference_steps']) : null;
    $seed = isset($params['seed']) ? intval($params['seed']) : null;
    $format = isset($params['format']) ? $params['format'] : 'png';
    $model_override = isset($params['model']) ? trim($params['model']) : '';
  
    $cfg = self::get_settings();
    $banana_key = trim($cfg['banana_key'] ?? '');
    $banana_model = trim($cfg['banana_model'] ?? '');
    $fal_key = trim($cfg['fal_key'] ?? (getenv('FAL_KEY') ?: ''));
    $fal_model = trim($cfg['fal_model'] ?? (getenv('FAL_MODEL') ?: 'fal-ai/flux/schnell'));
    if(!empty($model_override)) { $fal_model = $model_override; }
    // If using a fill endpoint but mask_url is missing, fall back to a text-to-image endpoint to avoid errors
    if (stripos($fal_model, '/fill') !== false && empty($mask_url)) {
      $fal_model = 'fal-ai/flux-pro/v1.1';
    }
  
    // Build request body with whitelisted parameters
    $body_arr = [ 'prompt' => $prompt, 'size' => $size, 'format' => $format ];
    if(!empty($image_url)) { $body_arr['image_url'] = $image_url; }
    if(!empty($mask_url)) { $body_arr['mask_url'] = $mask_url; }
    // Also include output_format for endpoints that expect this key
    $body_arr['output_format'] = $format;
    // Provide width/height when size is given as WxH
    if (preg_match('/^(\d+)x(\d+)$/', $size, $m)) { $body_arr['width'] = intval($m[1]); $body_arr['height'] = intval($m[2]); }
    if($guidance !== null) { $body_arr['guidance_scale'] = $guidance; }
    if($steps !== null) { $body_arr['num_inference_steps'] = $steps; }
    if($seed !== null) { $body_arr['seed'] = $seed; }

    // Map to LogoGenerator expected payload for local /api/fal/generate endpoints
    $brand_name = isset($params['brand_name']) ? $params['brand_name'] : ($params['brand'] ?? ($params['description'] ?? 'Brand'));
    $editing = isset($params['editing']) ? (bool)$params['editing'] : false;
    $edit_logo_input = isset($params['edit_logo_input']) ? $params['edit_logo_input'] : ($params['edit_prompt'] ?? '');
    $logo_body = [
      'brand_name' => $brand_name,
      'prompt' => $prompt,
      'editing' => $editing,
      'logo_url' => $image_url ?: ($params['logo_url'] ?? ''),
      'edit_logo_input' => $edit_logo_input,
    ];

    // 1) Fast path: Fal.ai cloud (flux/schnell) if key configured
    if ($fal_key) {
      // Use fal.run HTTP endpoint for Fal models
      $url = 'https://fal.run/' . ltrim($fal_model, '/');
      $headers = [
        'Authorization' => 'Key ' . $fal_key,
        'Content-Type' => 'application/json',
        'Accept' => 'application/json',
      ];
      // Fal.run expects the payload under an "input" key
      $resp = wp_remote_post($url, [ 'headers' => $headers, 'body' => json_encode(['input' => $body_arr]), 'timeout' => 30 ]);
      if (!is_wp_error($resp)) {
        $code = wp_remote_retrieve_response_code($resp);
        $json = json_decode(wp_remote_retrieve_body($resp), true);
        if ($code >= 200 && $code < 300) {
          $img = $this->find_image_url($json);
          if ($img) {
            return new WP_REST_Response(['ok' => true, 'status' => $code, 'data' => ['image_url' => $img, 'model_used' => $fal_model]], $code);
          }
          // Otherwise, continue to faster local fallbacks
        }
      }
    }
  
    // 2) FastAPI fallback (LogoGenerator)
    $fast_base = !empty($cfg['fastapi_base']) ? $cfg['fastapi_base'] : (getenv('FASTAPI_BASE') ?: 'http://127.0.0.1:8000');
    $fast_url = rtrim($fast_base, '/') . '/api/fal/generate';
    $headers_fast = [ 'Content-Type' => 'application/json' ];
    $db_token = !empty($cfg['db_token']) ? $cfg['db_token'] : (getenv('DB_TOKEN') ?: '');
    if ($db_token) { $headers_fast['Authorization'] = 'Bearer ' . $db_token; }
    $resp3 = wp_remote_post($fast_url, [
      'headers' => $headers_fast,
      'body' => json_encode($logo_body),
      'timeout' => 20,
    ]);
    if (!is_wp_error($resp3)) {
      $code3 = wp_remote_retrieve_response_code($resp3);
      $json3 = json_decode(wp_remote_retrieve_body($resp3), true);
      if ($code3 >= 200 && $code3 < 300) {
        $data3 = isset($json3['data']) ? $json3['data'] : $json3;
        $img3 = $this->find_image_url($data3);
        if ($img3) {
          return new WP_REST_Response(['ok' => true, 'status' => $code3, 'data' => ['image_url' => $img3, 'model_used' => 'LogoGenerator']], $code3);
        }
      }
    }

    // 3) Banana.dev (short polling) if configured
    if ($banana_key && $banana_model) {
      $banana_result = $this->try_banana_generate($banana_key, $banana_model, $prompt, $size, $guidance, $steps, $seed);
      if ($banana_result) {
        return $banana_result;
      }
    }
  
    // 4) Local agent-server proxy (LogoGenerator)
    $agent_base = getenv('AGENT_BASE') ?: 'http://127.0.0.1:8787';
    $agent_url = rtrim($agent_base, '/') . '/api/fal/generate';
    $resp2 = wp_remote_post($agent_url, [
      'headers' => [ 'Content-Type' => 'application/json' ],
      'body' => json_encode($logo_body),
      'timeout' => 20,
    ]);
    if (!is_wp_error($resp2)) {
      $code2 = wp_remote_retrieve_response_code($resp2);
      $json2 = json_decode(wp_remote_retrieve_body($resp2), true);
      if ($code2 >= 200 && $code2 < 300) {
        $data = isset($json2['data']) ? $json2['data'] : $json2;
        $img2 = $this->find_image_url($data);
        if ($img2) {
          return new WP_REST_Response(['ok' => true, 'status' => $code2, 'data' => ['image_url' => $img2, 'model_used' => 'AgentLogoGenerator']], $code2);
        }
      }
    }
  
    // 5) Local placeholder: return SVG data URI to avoid 502
    // Honor both env names
$disable_fallback_env = getenv('DISABLE_WP_IMAGE_FALLBACK');
if ($disable_fallback_env === false || $disable_fallback_env === null) {
  $disable_fallback_env = getenv('DISABLE_IMAGE_FALLBACK');
}
$disable_fallback = is_string($disable_fallback_env)
  ? in_array(strtolower(trim($disable_fallback_env)), ['1','true','yes','on'])
  : (bool)$disable_fallback_env;
    if ($disable_fallback) {
      return new WP_REST_Response(['ok' => false, 'status' => 503, 'error' => 'Fal AI unavailable and image fallback disabled'], 503);
    }
    $safe_prompt = esc_html($prompt ? $prompt : 'Brand Concept');
    $svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="640">'
         . '<defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#f0f4ff"/><stop offset="1" stop-color="#e2eafc"/></linearGradient></defs>'
         . '<rect width="100%" height="100%" fill="url(#g)"/>'
         . '<text x="50%" y="45%" text-anchor="middle" font-family="Inter,Arial" font-size="42" fill="#111" opacity="0.9">Brand Visual</text>'
         . '<text x="50%" y="58%" text-anchor="middle" font-family="Inter,Arial" font-size="28" fill="#333">' . $safe_prompt . '</text>'
         . '</svg>';
    $data_uri = 'data:image/svg+xml;charset=utf-8,' . rawurlencode($svg);
    return new WP_REST_Response(['ok' => true, 'status' => 200, 'data' => ['image_url' => $data_uri, 'caption' => 'Visual concept: ' . $safe_prompt ]], 200);
  }

  public function rest_agent_send($request){
    $data = $request->get_json_params();
    if(!$data){ $data = $request->get_body_params(); }
    if(!$data){
      $raw = method_exists($request,'get_body') ? $request->get_body() : '';
      if($raw){ $decoded = json_decode($raw, true); if(is_array($decoded)) $data = $decoded; }
    }
    if(!is_array($data)) $data = [];

    $cfg = self::get_settings();
    $agent_send = !empty($cfg['send_url']) ? $cfg['send_url'] : 'https://localhost:8787/agui/send';
    $resp = wp_remote_post($agent_send, [
      'headers' => [
        'Content-Type' => 'application/json',
        'Accept' => 'application/json',
        // Skip ngrok browser interstitial if applicable
        'ngrok-skip-browser-warning' => 'true',
      ],
      'body' => wp_json_encode($data),
      'timeout' => 30,
      // Allow self-signed localhost certs during development
      'sslverify' => false,
    ]);
    if(is_wp_error($resp)){
      return new WP_REST_Response(['ok'=>false,'error'=>$resp->get_error_message()], 502);
    }
    $code = wp_remote_retrieve_response_code($resp);
    $raw_body = wp_remote_retrieve_body($resp);
    $body = json_decode($raw_body, true);
    // Pass-through: return upstream JSON body directly if decodable, otherwise return raw string
    if($body !== null){
      return new WP_REST_Response($body, $code);
    } else {
      return new WP_REST_Response($raw_body, $code);
    }
  }

  // Fix 500s: implement /agui-chat/v1/settings to expose safe, non-secret settings
  public function rest_settings($request){
    $cfg = self::get_settings();
    // Derive agent-server image endpoint from send_url origin
    $agent_image_endpoint = '';
    if (!empty($cfg['send_url'])) {
      $parts = parse_url($cfg['send_url']);
      if ($parts && isset($parts['scheme']) && isset($parts['host'])) {
        $origin = $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
        $agent_image_endpoint = rtrim($origin, '/') . '/api/fal/generate';
      }
    }
    $public = [
      'sse_url' => $cfg['sse_url'] ?? '',
      'ws_url' => $cfg['ws_url'] ?? '',
      'send_url' => $cfg['send_url'] ?? '',
      'prefer_ws' => !empty($cfg['prefer_ws']),
      'fallback_url' => $cfg['fallback_url'] ?? '',
      'fastapi_base' => $cfg['fastapi_base'] ?? '',
      'crm_dashboards' => $cfg['crm_dashboards'] ?? [],
      'crm_apis' => $cfg['crm_apis'] ?? [],
      'ghl_location_id' => $cfg['ghl_location_id'] ?? '',
      'ghl_api_base' => $cfg['ghl_api_base'] ?? '',
      'ghl_version' => $cfg['ghl_version'] ?? '',
      // Non-secret endpoints for the frontend to use
      'wpSendEndpoint' => rest_url('agui-chat/v1/agent/send'),
      'wpFormEndpoint' => rest_url('agui-chat/v1/ghl/contact'),
      'wpImageEndpoint' => rest_url('agui-chat/v1/image/generate'),
      'wpSettingsEndpoint' => rest_url('agui-chat/v1/settings'),
      'agentImageEndpoint' => $agent_image_endpoint,
      // Helpful flags (do not expose actual tokens)
      'ghl_configured' => !empty($cfg['ghl_pit']) && !empty($cfg['ghl_location_id']),
      'fal_configured' => !empty($cfg['fal_key']),
      'version' => '0.1.2',
    ];
    return new WP_REST_Response(['ok' => true, 'data' => $public], 200);
  }
}

// Initialize the plugin
new WP_AGUI_Chat_Plugin();

// Register REST API endpoints
add_action('rest_api_init', function(){ (new WP_AGUI_Chat_Plugin())->register_rest(); });
