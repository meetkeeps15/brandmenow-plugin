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
      'fal_key' => '64ea8d6d-4f33-4915-8b5d-d2c5b8d6699b:7d926dbff1d130130c1cf402efccd184',
      'fal_model' => 'fal-ai/flux/schnell',

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
    <section class="bm-ms-form" id="bm-ms-form" aria-label="BrandMe multi-step logo form">
      <div class="bm-ms-form-content">
        
      <!-- Step 1: Describe business + Name + Email -->
      <form id="bmms-step1" class="bmms-step active" autocomplete="off">
        <div class="bmms-splash-header">
          <div class="bmms-logo-anim" aria-hidden="true">
            <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          </div>
          <h2 class="bmms-title">Hi, I'm Airo—your AI-powered assistant.</h2>
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
        <div class="actions">
          <button type="submit" class="btn btn-primary">Get Started</button>
        </div>
      </form>

      <!-- Step 2: Splash + icon options (single select) -->
      <div id="bmms-step2" class="bmms-step" data-step="2">
        <div class="bmms-splash">
          <div class="bmms-logo-anim large" aria-hidden="true"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
          <div class="bmms-splash-text">Hang tight, I’m getting your logo started</div>
        </div>
        <div class="bmms-options" style="display:none" aria-live="polite">
          <h3 class="bmms-section-title">Let’s start with your logo’s foundation: your icon</h3>
          <p class="bmms-help">Choose the one you like best (single selection).</p>
          <div class="bmms-icon-grid" role="radiogroup">
            <label class="bmms-icon-card"><input type="radio" name="bmms_icon" value="lightning" /><span class="icon i-lightning"></span><span class="label">Lightning</span></label>
            <label class="bmms-icon-card"><input type="radio" name="bmms_icon" value="gauge" /><span class="icon i-gauge"></span><span class="label">Gauge</span></label>
            <label class="bmms-icon-card"><input type="radio" name="bmms_icon" value="rocket" /><span class="icon i-rocket"></span><span class="label">Rocket</span></label>
            <label class="bmms-icon-card"><input type="radio" name="bmms_icon" value="custom" /><span class="icon i-custom"></span><span class="label">Make my own</span></label>
          </div>
          <div class="actions">
            <button type="button" class="btn bmms-back">Back</button>
            <button type="button" class="btn btn-primary bmms-next" data-next="3">Continue</button>
          </div>
        </div>
      </div>

      <!-- Step 3: Splash + text input -->
      <div id="bmms-step3" class="bmms-step" data-step="3">
        <div class="bmms-splash">
          <div class="bmms-logo-anim large" aria-hidden="true"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
          <div class="bmms-splash-text">Just a moment, I’m getting your logo started</div>
        </div>
        <form class="bmms-fields" style="display:none">
          <label class="field"><span>What text would you like to add to your logo?</span>
            <input type="text" name="brand_text" placeholder="I suggest using your business name" />
          </label>
          <div class="actions">
            <button type="button" class="btn bmms-back">Back</button>
            <button type="button" class="btn bmms-skip">Skip</button>
            <button type="button" class="btn btn-primary bmms-next" data-next="4">Continue</button>
          </div>
        </form>
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
          <div class="actions">
            <button type="button" class="btn bmms-back">Back</button>
            <button type="button" class="btn btn-primary bmms-next" data-next="5">Continue</button>
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
            <button type="button" class="btn bmms-zoom">Zoom</button>
          </div>
          <div class="actions">
            <button type="button" class="btn bmms-back">Back</button>
            <button type="button" class="btn btn-primary bmms-download">Download PNG</button>
          </div>
          <div class="bmms-zoom-overlay" role="dialog" aria-modal="true" style="display:none">
            <div class="bmms-zoom-inner"><img id="bmms-zoom-image" alt="Zoomed logo" /><button class="bmms-zoom-close" aria-label="Close">×</button></div>
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

    add_settings_section('fal_ai', 'Fal AI (Server-side)', function(){
      echo '<p>Recommended: configure server-side Fal AI so the browser calls WordPress (same-origin HTTPS) instead of localhost. This avoids mixed-content and reachability issues.</p>';
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

  // Helper: extract image URL from varied Fal/Agent/FastAPI response shapes
  private function find_image_url($data) {
    if (is_string($data) && preg_match('/^https?:\/\//', $data)) return $data;
    $d = is_array($data) ? $data : [];
    $candidates = [];
    $candidates[] = $d['image_url'] ?? null;
    $candidates[] = $d['url'] ?? null;
    if (isset($d['image']) && is_string($d['image'])) $candidates[] = $d['image'];
    $candidates[] = $d['data_uri'] ?? null;
    $candidates[] = $d['dataUrl'] ?? null;
    $candidates[] = $d['image_base64'] ?? null;
    $candidates[] = $d['base64'] ?? null;
    if (isset($d['images'][0]['url'])) $candidates[] = $d['images'][0]['url'];
    if (isset($d['output']['images'][0]['url'])) $candidates[] = $d['output']['images'][0]['url'];
    if (isset($d['result']['images'][0]['url'])) $candidates[] = $d['result']['images'][0]['url'];
    if (isset($d['data']['images'][0]['url'])) $candidates[] = $d['data']['images'][0]['url'];
    if (isset($d['data']['image_url'])) $candidates[] = $d['data']['image_url'];
    if (isset($d['data']['image']['url'])) $candidates[] = $d['data']['image']['url'];
    if (isset($d['image']['url'])) $candidates[] = $d['image']['url'];
    if (isset($d['image']['data_uri'])) $candidates[] = $d['image']['data_uri'];
    if (isset($d['image']['base64'])) $candidates[] = $d['image']['base64'];
    foreach ($candidates as $u) { if (is_string($u) && $u !== '') return $u; }
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
    $image_url = isset($params['image_url']) ? $params['image_url'] : '';
    // Optional advanced parameters for Fal models
    $size = isset($params['size']) ? $params['size'] : '1024x1024';
    $guidance = isset($params['guidance_scale']) ? floatval($params['guidance_scale']) : null;
    $steps = isset($params['num_inference_steps']) ? intval($params['num_inference_steps']) : null;
    $seed = isset($params['seed']) ? intval($params['seed']) : null;
    $format = isset($params['format']) ? $params['format'] : 'png';
    $model_override = isset($params['model']) ? trim($params['model']) : '';
  
    $cfg = self::get_settings();
    $fal_key = trim($cfg['fal_key'] ?? (getenv('FAL_KEY') ?: ''));
    $fal_model = trim($cfg['fal_model'] ?? (getenv('FAL_MODEL') ?: 'fal-ai/flux/schnell'));
    if(!empty($model_override)) { $fal_model = $model_override; }
  
    // Build request body with whitelisted parameters
    $body_arr = [ 'prompt' => $prompt, 'image_url' => $image_url, 'size' => $size, 'format' => $format ];
    if($guidance !== null) { $body_arr['guidance_scale'] = $guidance; }
    if($steps !== null) { $body_arr['num_inference_steps'] = $steps; }
    if($seed !== null) { $body_arr['seed'] = $seed; }



    // 1) Try Fal.ai directly if key configured
    if ($fal_key) {
      $url = 'https://api.fal.ai/' . ltrim($fal_model, '/');
      $headers = [
        'Authorization' => 'Key ' . $fal_key,
        'Content-Type' => 'application/json',
        'Accept' => 'application/json',
      ];
      $resp = wp_remote_post($url, [ 'headers' => $headers, 'body' => json_encode($body_arr), 'timeout' => 60 ]);
      if (!is_wp_error($resp)) {
        $code = wp_remote_retrieve_response_code($resp);
        $json = json_decode(wp_remote_retrieve_body($resp), true);
        if ($code >= 200 && $code < 300) {
          $img = $this->find_image_url($json);
          if ($img) {
            return new WP_REST_Response(['ok' => true, 'status' => $code, 'data' => ['image_url' => $img]], $code);
          }
          // Otherwise, do not return yet—continue to fallbacks
        }
      }
    }
  
    // 2) Fallback to local agent-server proxy
    $agent_base = getenv('AGENT_BASE') ?: 'http://127.0.0.1:8787';
    $agent_url = rtrim($agent_base, '/') . '/api/fal/generate';
    $resp2 = wp_remote_post($agent_url, [
      'headers' => [ 'Content-Type' => 'application/json' ],
      'body' => json_encode($body_arr),
      'timeout' => 60,
    ]);
    if (!is_wp_error($resp2)) {
      $code2 = wp_remote_retrieve_response_code($resp2);
      $json2 = json_decode(wp_remote_retrieve_body($resp2), true);
      if ($code2 >= 200 && $code2 < 300) {
        $data = isset($json2['data']) ? $json2['data'] : $json2;
        $img2 = $this->find_image_url($data);
        if ($img2) {
          return new WP_REST_Response(['ok' => true, 'status' => $code2, 'data' => ['image_url' => $img2]], $code2);
        }
      }
    }
  
    // 3) Final fallback: local FastAPI returns SVG data URI
    $fast_base = !empty($cfg['fastapi_base']) ? $cfg['fastapi_base'] : (getenv('FASTAPI_BASE') ?: 'http://127.0.0.1:8000');
    $fast_url = rtrim($fast_base, '/') . '/api/fal/generate';
    $headers_fast = [ 'Content-Type' => 'application/json' ];
    $db_token = !empty($cfg['db_token']) ? $cfg['db_token'] : (getenv('DB_TOKEN') ?: '');
    if ($db_token) { $headers_fast['Authorization'] = 'Bearer ' . $db_token; }
    $resp3 = wp_remote_post($fast_url, [
      'headers' => $headers_fast,
      'body' => json_encode($body_arr),
      'timeout' => 30,
    ]);
    if (!is_wp_error($resp3)) {
      $code3 = wp_remote_retrieve_response_code($resp3);
      $json3 = json_decode(wp_remote_retrieve_body($resp3), true);
      if ($code3 >= 200 && $code3 < 300) {
        $data3 = isset($json3['data']) ? $json3['data'] : $json3;
        $img3 = $this->find_image_url($data3);
        if ($img3) {
          return new WP_REST_Response(['ok' => true, 'status' => $code3, 'data' => ['image_url' => $img3]], $code3);
        }
      }
    }
  
    // 4) Local placeholder: return SVG data URI to avoid 502
    // Allow disabling fallback via env flag DISABLE_WP_IMAGE_FALLBACK
    $disable_fallback = getenv('DISABLE_WP_IMAGE_FALLBACK');
    $disable = $disable_fallback && in_array(strtolower($disable_fallback), ['1','true','yes','on']);
    if ($disable) {
      return new WP_REST_Response(['ok' => false, 'status' => 503, 'error' => 'Fal AI unavailable and image fallback disabled'], 503);
    }
    $safe_prompt = esc_html($prompt ? $prompt : 'Brand Concept');
    $svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600">'
         . '<defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#f0f4ff"/><stop offset="1" stop-color="#e2eafc"/></linearGradient></defs>'
         . '<rect width="100%" height="100%" fill="url(#g)"/>'
         . '<text x="50%" y="45%" text-anchor="middle" font-family="Inter,Arial" font-size="42" fill="#111" opacity="0.9">Brand Visual</text>'
         . '<text x="50%" y="58%" text-anchor="middle" font-family="Inter,Arial" font-size="28" fill="#333">' . $safe_prompt . '</text>'
         . '</svg>';
    $data_uri = 'data:image/svg+xml;charset=utf-8,' . rawurlencode($svg);
    // Use 'image_url' to match frontend extractImageUrl expectations
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

add_action('rest_api_init', function(){ (new WP_AGUI_Chat_Plugin())->register_rest(); });
