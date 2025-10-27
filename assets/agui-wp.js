(function(){
  // Enhanced cross-browser compatibility and private browsing support
  const rawCfg = Object.assign({sendUrl: 'https://brandmenow.ai/agui/send', preferWebSocket: true, welcomeOnConnect: true}, window.AGUiConfig||{});
  
  // Allow URL param to force non-streaming mode temporarily: ?agui_nostream=1 or ?nostream=1
  try {
    const qs = new URLSearchParams(window.location.search || '');
    const noStreamParam = qs.get('agui_nostream') || qs.get('nostream');
    if (noStreamParam === '1' || noStreamParam === 'true') {
      rawCfg.forceNonStreaming = true;
    }
    const dbgParam = qs.get('agui_debug') || qs.get('debug');
    if (dbgParam === '1' || dbgParam === 'true') {
      rawCfg.aguiDebug = true;
    }
  } catch(e) {
    // Fallback for older browsers without URLSearchParams
    try {
      const search = window.location.search || '';
      if (search.includes('agui_nostream=1') || search.includes('nostream=1') || 
          search.includes('agui_nostream=true') || search.includes('nostream=true')) {
        rawCfg.forceNonStreaming = true;
      }
      if (search.includes('agui_debug=1') || search.includes('debug=1') ||
          search.includes('agui_debug=true') || search.includes('debug=true')) {
        rawCfg.aguiDebug = true;
      }
    } catch(e2) {}
  }
  
  // If the page is served over HTTPS, upgrade endpoints to https/wss to avoid mixed-content blocking.
  // We will also add runtime fallback to the opposite scheme when a connection fails (useful for localhost dev).
  try{
    if(window.location && window.location.protocol === 'https:'){
      if(rawCfg.wsUrl && /^ws:\/\//.test(rawCfg.wsUrl)) rawCfg.wsUrl = rawCfg.wsUrl.replace(/^ws:\/\//,'wss://');
      if(rawCfg.sseUrl && /^http:\/\//.test(rawCfg.sseUrl)) rawCfg.sseUrl = rawCfg.sseUrl.replace(/^http:\/\//,'https://');
      if(rawCfg.sendUrl && /^http:\/\//.test(rawCfg.sendUrl)) rawCfg.sendUrl = rawCfg.sendUrl.replace(/^http:\/\//,'https://');
    }
  }catch(e){}
  const cfg = rawCfg;
  // Sanitize endpoints to avoid trailing semicolons or spaces from settings/debug copies
  function sanitizeUrl(u){ try{ return String(u||'').trim().replace(/;+\s*$/, ''); }catch(e){ return u; } }
  cfg.wpFormEndpoint = sanitizeUrl(cfg.wpFormEndpoint || '');
  cfg.wpSettingsEndpoint = sanitizeUrl(cfg.wpSettingsEndpoint || '');
  cfg.wpSendEndpoint = sanitizeUrl(cfg.wpSendEndpoint || '');
  cfg.wpImageEndpoint = sanitizeUrl(cfg.wpImageEndpoint || '');
  // Version marker and URL param override for quick testing
  const AGUI_JS_VERSION = '0.1.3-prechat-fallback-observer';
  try {
    const q = new URLSearchParams(window.location.search || '');
    const overrideForm = q.get('wpFormEndpoint');
    if (overrideForm) {
      cfg.wpFormEndpoint = sanitizeUrl(overrideForm);
    }
  } catch(_) {}
  // Optional Agency API (FastAPI) config injected via wp_localize_script
  cfg.fastApiBase = (cfg.fastApiBase || cfg.fastapi_base || '').replace(/\/$/, '') || 'http://127.0.0.1:8800';
  cfg.dbToken = cfg.dbToken || cfg.db_token || '';
  // Agent server image proxy endpoint (derived from sendUrl origin if not provided)
  cfg.agentImageEndpoint = (cfg.agentImageEndpoint || '').replace(/\/$/, '');
  if(!cfg.agentImageEndpoint && cfg.sendUrl){
    try{ const u = new URL(cfg.sendUrl); cfg.agentImageEndpoint = `${u.protocol}//${u.host}/api/fal/generate`; }catch(e){}
  }
  const BRAND_WIZARD_GREETING_HTML = 'Hey! I’m your Brand Wizard—here to craft a standout brand together. I’ll guide you, step by step, so we can create your brand in just a few minutes!<br><br>Let’s build your brand! Would you like me to analyze your Instagram for inspiration, or should we start with your own ideas? If you share your Instagram handle, I can suggest names, palettes, and even products that match your vibe. Or, just tell me what inspires you!';
  // Random welcome variants (used when landing is completed)
  const BRAND_WIZARD_WELCOME_VARIANTS = [
    "Welcome back! Ready to craft names, palettes, and a logo together?",
    "Let’s build your brand identity step by step—name, colors, and product mockups!",
    "I can analyze your Instagram for inspiration or start from your ideas—your call!",
    "Share your vibe and I’ll suggest names, palettes, and products that match.",
    "Need a starting point? I’ll guide you through brand naming and visual style."
  ];
  function pickRandom(arr){ try{ return arr[Math.floor(Math.random()*arr.length)] }catch(e){ return arr[0]; } }
  function wordsPreview(text, n=4){
    const t = String(text||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
    const parts = t.split(' ').slice(0, n);
    return parts.join(' ');
  }
  // Resolve plugin asset URLs robustly across WordPress and preview environments
  function pluginAssetUrl(file){
    try{
      // Prefer resolving relative to the loaded agui-wp.js
      const scripts = document.getElementsByTagName('script');
      for(let i=0;i<scripts.length;i++){
        const src = scripts[i].src||'';
        if(/agui-wp\.js/.test(src)){
          const base = src.replace(/agui-wp\.js.*$/,'');
          return base + file;
        }
      }
      // Fallback: resolve relative to agui-wp.css
      const links = document.getElementsByTagName('link');
      for(let i=0;i<links.length;i++){
        const href = links[i].href||'';
        if(/agui-wp\.css/.test(href)){
          const base = href.replace(/agui-wp\.css.*$/,'');
          return base + file;
        }
      }
      // Dev preview fallback
      if(location.pathname.includes('/wp-agui-chat/')){
        return '/wp-agui-chat/assets/' + file;
      }
    }catch(e){}
    // Last resort: return as-is
    return file;
  }
  // Enhanced element selection with cross-browser compatibility
  function safeGetElement(id) {
    try {
      return document.getElementById(id);
    } catch(e) {
      try {
        return document.querySelector('#' + id);
      } catch(e2) {
        return null;
      }
    }
  }

  // Heuristic detection for prechat form across different page builders and themes
  function detectPrechatForm(){
    try{
      // Prefer explicit/landing-scoped forms first
      let f = (safeGetElement('preChatForm')
        || document.querySelector('#agentLanding form')
        || document.querySelector('#agent-landing form')
        || document.querySelector('#agentLandingForm')
        || document.querySelector('.agent-landing form')
        || document.querySelector('form[data-agui-prechat]')
        || document.querySelector('form[name="agui-prechat"]')
        || document.querySelector('form[action*="agui-chat"]')
      );
      // Exclude WP adminbar search form and generic search bars
      const isBad = (el)=>{
        if(!el) return false;
        const id = (el.id||'').toLowerCase();
        const role = (el.getAttribute && (el.getAttribute('role')||'').toLowerCase()) || '';
        const inAdminBar = !!(el.closest && el.closest('#wpadminbar'));
        if(id==='adminbarsearch') return true;
        if(role==='search') return true;
        if(inAdminBar) return true;
        return false;
      };
      if(f && !isBad(f)) return f;
      // Heuristic scan across all forms
      const forms = Array.from(document.getElementsByTagName('form')).filter(el=>!isBad(el));
      let best=null, bestScore=0;
      for(const form of forms){
        let score=0;
        const q = (sel)=>{ try{ return form.querySelector(sel); }catch(e){ return null; } };
        if(q('input[name="email"],input[type="email"]')) score+=3;
        if(q('input[name="name"],input[name="firstName"]')) score+=3;
        if(q('textarea[name="idea"],textarea')) score+=1;
        const fid = (form.id||'').toLowerCase();
        const fcl = (form.className||'').toLowerCase();
        if(fid.includes('pre') && fid.includes('chat')) score+=2;
        if(fcl.includes('pre') && fcl.includes('chat')) score+=2;
        if(q('button[type="submit"],input[type="submit"]')) score+=1;
        // Require at least one identity field to consider valid
        const hasIdentity = q('input[name="email"],input[type="email"],input[name="name"],input[name="firstName"]');
        if(!hasIdentity) continue;
        if(score>bestScore){ bestScore=score; best=form; }
      }
      return best || null;
    }catch(e){ return null; }
  }

  const els = {
    connectBtn: safeGetElement('connectBtn'),
    connectionStatus: safeGetElement('connectionStatus'),
    messages: safeGetElement('messages'),
    typing: safeGetElement('typingIndicator'),
    composer: safeGetElement('composer'),
    input: safeGetElement('input'),
    preForm: detectPrechatForm(),
    chatCard: safeGetElement('chatCard'),
    suggestions: safeGetElement('suggestions'),
    fileInput: safeGetElement('fileInput'),
  };
  // Guard against mis-detecting admin search as preForm
  try{
    if(els.preForm && (els.preForm.id==='adminbarsearch' || (els.preForm.closest && els.preForm.closest('#wpadminbar')))){
      els.preForm = null;
    }
  }catch(_){}

  // Optional debug banner to verify detection and endpoints
  try{
    if(cfg.aguiDebug){
      const container = document.querySelector('#agentLanding') || document.querySelector('.bm-chat-app') || document.body;
      const info = document.createElement('div');
      info.id = 'agui-debug';
      info.style.cssText = 'margin:8px 0;padding:6px 8px;font-size:12px;color:#1f2937;background:#e5e7eb;border-radius:6px;';
      const formDesc = els.preForm ? (els.preForm.id ? `#${els.preForm.id}` : (els.preForm.tagName||'form').toLowerCase()) : 'null';
      info.textContent = `Debug: version=${typeof AGUI_JS_VERSION!=='undefined'?AGUI_JS_VERSION:'(n/a)'}; preForm=${formDesc}; wpFormEndpoint=${cfg.wpFormEndpoint||'(unset)'}; wpSettingsEndpoint=${cfg.wpSettingsEndpoint||'(unset)'}`;
      container.appendChild(info);
    }
  }catch(e){}


  let conn = null; let transport = null;
  let pendingFirstMsg = null;

  // ===== URL helpers =====
  function toggleScheme(url){
    try{
      const u = new URL(url);
      const host = u.hostname || '';
      const isLocal = /(localhost|127\.0\.0\.1|\.local)$/i.test(host);
      // Only toggle scheme for local development hosts to avoid flipping secure ngrok/public endpoints
      if(!isLocal){
        return u.toString();
      }
      if(u.protocol==='http:') u.protocol='https:';
      else if(u.protocol==='https:') u.protocol='http:';
      else if(u.protocol==='ws:') u.protocol='wss:';
      else if(u.protocol==='wss:') u.protocol='ws:';
      return u.toString();
    }catch(e){ return ''; }
  }

  // ===== Image Generation helpers (FastAPI /api/fal/generate) =====
  function extractImageUrl(data){
    try {
      if(!data) return '';
      if(typeof data === 'string') return data;
      const candidates = [];
      candidates.push(data.image_url);
      candidates.push(data.url);
      candidates.push(typeof data.image === 'string' ? data.image : null);
      candidates.push(data.data_uri);
      candidates.push(data.dataUrl);
      candidates.push(data.image_base64);
      candidates.push(data.base64);
      candidates.push(data?.images?.[0]?.url);
      candidates.push(data?.output?.images?.[0]?.url);
      candidates.push(data?.result?.images?.[0]?.url);
      candidates.push(data?.data?.images?.[0]?.url);
      candidates.push(data?.data?.image_url);
      candidates.push(data?.data?.image?.url);
      candidates.push(typeof data?.data?.image === 'string' ? data.data.image : null);
      candidates.push(data?.image?.url);
      candidates.push(data?.image?.data_uri);
      candidates.push(data?.image?.base64);
      const found = candidates.find(u => typeof u==='string' && u);
      return found || '';
    } catch(e){ return ''; }
  }
  // Normalize image sources (URL, data URI, or base64) into a displayable src
  function normalizeImageUrl(u){
    try{
      if(!u) return '';
      if(typeof u !== 'string') return '';
      const s = u.trim();
      if(/^data:image\//i.test(s)) return s; // proper data URI
      if(/^https?:\/\//i.test(s)) return s; // http/https URL
      // If it looks like raw base64, wrap it as PNG
      if(/^[A-Za-z0-9+/=]+$/.test(s) && s.length > 100){
        return 'data:image/png;base64,' + s;
      }
      return s;
    }catch(e){ return ''; }
  }

  // ===== Formatting helpers =====
  function escapeHtml(s){
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function formatListHtml(text){
    const safe = escapeHtml(text || '');
    const lines = safe.split(/\r?\n/);
    let html = '';
    let inList = false;
    let listType = null; // 'ul' or 'ol'
    let paragraphBuffer = [];
    const flushParagraph = () => {
      if(paragraphBuffer.length){
        const pText = paragraphBuffer.join(' ');
        html += `<p>${pText}</p>`;
        paragraphBuffer = [];
      }
    };
    for(const line of lines){
      const ulMatch = line.match(/^\s*(?:[-*•])\s+(.*)$/);
      const olMatch = line.match(/^\s*(\d+[\.)])\s+(.*)$/);
      if(ulMatch){
        flushParagraph();
        if(!inList || listType !== 'ul'){
          if(inList){ html += (listType==='ol' ? '</ol>' : '</ul>'); }
          html += '<ul>';
          inList = true; listType = 'ul';
        }
        html += `<li>${ulMatch[1]}</li>`;
      } else if(olMatch){
        flushParagraph();
        if(!inList || listType !== 'ol'){
          if(inList){ html += (listType==='ul' ? '</ul>' : '</ol>'); }
          html += '<ol>';
          inList = true; listType = 'ol';
        }
        html += `<li>${olMatch[2]}</li>`;
      } else {
        if(inList){ html += (listType==='ol' ? '</ol>' : '</ul>'); inList = false; listType = null; }
        if(line.trim().length){
          paragraphBuffer.push(line);
        } else {
          flushParagraph();
        }
      }
    }
    if(inList){ html += (listType==='ol' ? '</ol>' : '</ul>'); }
    flushParagraph();
    return html || safe;
  }

  function renderImage(url, caption){
    const target = document.getElementById('bm-chat-messages') || (els && els.messages) || null;
    if(!target) return;
    const wrap = document.createElement('div');
    wrap.className = 'msg assistant';
    const dot = document.createElement('div'); dot.className = 'role';
    const bubble = document.createElement('div'); bubble.className = 'bubble';
 
    const block = document.createElement('div');
    block.className = 'image-block';
 
    const img = new Image();
    img.alt = 'Generated image';
    img.src = url;
 
    const cap = document.createElement('div');
    cap.className = 'image-caption';
    cap.textContent = caption ? String(caption) : '';
 
    // Fallbacks if data URIs or cross-origin URLs are blocked by CSP
    img.onerror = async () => {
      try {
        // If the src is a data URI, convert to Blob without network fetch
        if(/^data:image\/(png|jpeg|webp);base64,/i.test(url)){
          const m = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i);
          if(m){
            const mime = m[1];
            const b64 = m[2];
            const byteChars = atob(b64);
            const byteNums = new Array(byteChars.length);
            for(let i=0;i<byteChars.length;i++){ byteNums[i] = byteChars.charCodeAt(i); }
            const blob = new Blob([new Uint8Array(byteNums)], { type: mime });
            const blobUrl = URL.createObjectURL(blob);
            img.src = blobUrl;
            // Revoke after image loads to avoid memory leaks
            img.onload = () => { try { URL.revokeObjectURL(blobUrl); } catch(e){} };
            return;
          }
        }
        // Otherwise attempt network fetch and create a blob URL
        const res = await fetch(url);
        if(!res.ok) throw new Error('image fetch failed');
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        img.src = blobUrl;
        // Revoke after image loads to avoid memory leaks
        img.onload = () => { try { URL.revokeObjectURL(blobUrl); } catch(e){} };
      } catch(err) {
        // As a last resort, show a clickable link for the user to open/download
        const link = document.createElement('a');
        link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.textContent = 'Open image';
        block.innerHTML = '';
        block.appendChild(link);
      }
    };
 
    block.appendChild(img);
    block.appendChild(cap);
    bubble.appendChild(block);
    wrap.append(dot, bubble);
    target.appendChild(wrap);
    // Scroll to bottom when image loads
    img.onload = () => { target.scrollTop = target.scrollHeight; };
    // Also attempt to scroll immediately in case of cached images
    target.scrollTop = target.scrollHeight;
  }

  async function generateImage(prompt){
    console.log('generateImage called with prompt:', prompt);
    const endpoints = [];
    const wpEndpoint = (cfg.wpImageEndpoint || '').replace(/\/$/, '');
    const agentEndpoint = (cfg.agentImageEndpoint || '').replace(/\/$/, '');
    // Try WordPress first, then agent-server, then FastAPI
    if(wpEndpoint){
      endpoints.push(wpEndpoint);
    }
    if(agentEndpoint) {
      endpoints.push(agentEndpoint);
      // Scheme fallback: try toggled http/https variant if handshake fails
      try {
        const u = new URL(agentEndpoint);
        const toggled = (u.protocol === 'http:' ? 'https:' : 'http:') + '//' + u.host + (u.pathname || '') + (u.search || '');
        endpoints.push(toggled);
      } catch(e) {}
    }
    const fastApi = (cfg.fastApiBase || '').replace(/\/$/, '');
    if(fastApi){ endpoints.push(`${fastApi}/api/fal/generate`); }
    console.log('Image generation endpoints:', endpoints);
    try{
      const resp = await fetch(endpoints[0], { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ prompt })});
      if(!resp.ok){
        // try next
        for(let i=1;i<endpoints.length;i++){
          const r2 = await fetch(endpoints[i], { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ prompt })});
          if(r2.ok){
            const ct2 = (r2.headers.get('content-type')||'').toLowerCase();
            if(ct2.includes('application/json')){
              const data2 = await r2.json().catch(()=>({}));
              const u2 = normalizeImageUrl(extractImageUrl(data2));
              if(u2) renderImage(u2, prompt);
            } else {
              const txt2 = await r2.text().catch(()=>(''));
              const u2 = normalizeImageUrl(txt2);
              if(u2) renderImage(u2, prompt);
            }
            return;
          }
        }
        renderMessage({role:'assistant', text:'Could not generate image.'});
        return;
      }
      const ct = (resp.headers.get('content-type')||'').toLowerCase();
      if(ct.includes('application/json')){
        const data = await resp.json().catch(()=>({}));
        const url = normalizeImageUrl(extractImageUrl(data));
        if(url) renderImage(url, prompt);
      } else {
        const txt = await resp.text().catch(()=>(''));
        const url = normalizeImageUrl(txt);
        if(url) renderImage(url, prompt);
      }
    }catch(e){ 
      console.error('Image generation error:', e);
      renderMessage({role:'assistant', text:'Image generation failed.'}); 
    }
  }

  // Test function to render a sample image
  function testImageRender(){
    console.log('Testing image render with sample data URI...');
    // Create a simple 100x100 red square as a test image
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 100, 100);
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px Arial';
    ctx.fillText('TEST', 35, 55);
    const dataUrl = canvas.toDataURL('image/png');
    console.log('Generated test data URL:', dataUrl.substring(0, 50) + '...');
    renderImage(dataUrl, 'Test Image');
  }

  // Make test function available globally for debugging
  window.testImageRender = testImageRender;

  function setStatus(text, ok){ try{ els.connectionStatus.textContent = text; els.connectionStatus.className = 'status ' + (ok?'ok':''); }catch(e){} }
  function setTyping(show){ try{ els.typing.classList.toggle('hidden', !show); }catch(e){} }

  function handleEvent(raw){
    let data = null;
    try{ data = JSON.parse(raw); }catch(e){ data = { type:'assistant_message', text: raw }; }
    try{ if(!data) return; }catch(e){}
    const t = (data.type || '').toLowerCase();
    if(t==='status') setStatus(String(data.text||'Disconnected'), !!data.ok);
    else if(t==='typing') setTyping(!!data.on);
    else if(t==='assistant_message'){ renderMessage({role:'assistant', text: data.text || ''}); }
    else if(t==='assistant_html'){ renderMessage({role:'assistant', text: data.html || '', html: true}); }
    else if(t==='image'){ const src = normalizeImageUrl(extractImageUrl(data) || data.data_uri || data.image_base64 || data.base64 || data.url || ''); renderImage(src, data.caption || ''); }
    else { renderMessage({role:'assistant', text: JSON.stringify(data)}); }
  }

  function renderMessage({role, text, html}){
    try{
      const wrap = document.createElement('div'); wrap.className = 'msg ' + (role==='user'?'user':'assistant');
      const dot = document.createElement('div'); dot.className = 'role';
      const bubble = document.createElement('div'); bubble.className = 'bubble';
      bubble.innerHTML = html ? String(text||'') : formatListHtml(String(text||''));
      wrap.append(dot, bubble);
      els.messages.appendChild(wrap);
      els.messages.scrollTop = els.messages.scrollHeight;
    }catch(e){}
  }

  function startSSE(){
    if(cfg.forceNonStreaming) { setStatus('Chat ready (no streaming)', true); renderWelcome(); return; }
    if(!cfg.sseUrl) return renderMessage({role:'system', text:'SSE endpoint not configured'});
    transport='sse';
    let triedFallback = false;
    const tryConnect = (url)=>{
      try{
        if(conn){ try{ conn.close && conn.close(); }catch(e){} }
        conn = new EventSource(url, { withCredentials: false });
        conn.onopen = ()=> { setStatus('SSE connected', true); if(cfg.welcomeOnConnect) renderWelcome(); if(pendingFirstMsg){ const msg = pendingFirstMsg; pendingFirstMsg = null; sendMessage(msg); } };
        // Support both unnamed default events and named events sent by server
        conn.onmessage = (ev)=> handleEvent(ev.data);
        conn.addEventListener('message', (ev)=> handleEvent(ev.data));
        conn.addEventListener('status', (ev)=> handleEvent(ev.data));
        conn.addEventListener('typing', (ev)=> handleEvent(ev.data));
        conn.onerror = (err)=> {
          setStatus('Disconnected', false);
          if(!triedFallback){
            triedFallback = true;
            const toggled = toggleScheme(url);
            if(toggled && toggled !== url){
              renderMessage({role:'system', text:'SSE connection failed — trying alternate scheme…'});
              tryConnect(toggled);
              return;
            }
          }
          renderMessage({role:'system', text:'SSE error'});
        };
      }catch(e){
        if(!triedFallback){
          triedFallback = true;
          const toggled = toggleScheme(url);
          if(toggled && toggled !== url){
            renderMessage({role:'system', text:'SSE init failed — trying alternate scheme…'});
            tryConnect(toggled);
            return;
          }
        }
        renderMessage({role:'system', text:'Failed to start SSE'});
      }
    };
    tryConnect(cfg.sseUrl);
  }

  function startWebSocket(){
    if(cfg.forceNonStreaming) { setStatus('Chat ready (no streaming)', true); renderWelcome(); return; }
    if(!cfg.wsUrl) return startSSE();
    transport='ws';
    let triedFallback = false;
    const tryConnect = (url)=>{
      try{
        if(conn){ try{ conn.close && conn.close(); }catch(e){} }
        conn = new WebSocket(url);
        conn.onopen = ()=> { setStatus('WebSocket connected', true); if(cfg.welcomeOnConnect) renderWelcome(); if(pendingFirstMsg){ const msg = pendingFirstMsg; pendingFirstMsg = null; sendMessage(msg); } };
        conn.onmessage = (ev)=> handleEvent(ev.data);
        conn.onclose = ()=> setStatus('Disconnected', false);
        conn.onerror = (ev)=> {
          if(!triedFallback){
            triedFallback = true;
            const toggled = toggleScheme(url);
            if(toggled && toggled !== url){
              renderMessage({role:'system', text:'WebSocket error — trying alternate scheme…'});
              tryConnect(toggled);
              return;
            }
          }
          renderMessage({role:'system', text:'WebSocket error — falling back to SSE'});
          try{ conn.close && conn.close(); }catch(e){}
          startSSE();
        };
      }catch(e){
        if(!triedFallback){
          triedFallback = true;
          const toggled = toggleScheme(url);
          if(toggled && toggled !== url){
            renderMessage({role:'system', text:'WebSocket init failed — trying alternate scheme…'});
            tryConnect(toggled);
            return;
          }
        }
        renderMessage({role:'system', text:'WebSocket init failed — using SSE'});
        startSSE();
      }
    };
    tryConnect(cfg.wsUrl);
  }

  function connect(){
    try{ if(conn) conn.close && conn.close(); }catch(e){}
    // reveal chat window
    try {
      const card = document.getElementById('chatCard');
      if(card){ card.style.display='block'; card.classList.add('animate-in'); }
    } catch(e){}
    if(cfg.forceNonStreaming){
      transport = 'none';
      setStatus('Chat ready', true);
      if(cfg.welcomeOnConnect) renderWelcome();
      return;
    }
    if(cfg.preferWebSocket && 'WebSocket' in window){
      startWebSocket();
    } else if(cfg.sseUrl){
      startSSE();
    } else {
      renderMessage({role:'system', text:'No AG-UI endpoint configured'});
    }
  }

  function renderWelcome(){
    if(!els.messages) return;
    try{
      const conv = getActive(); if(!conv) return;
      // Avoid duplicate welcomes: if the conversation already has messages, skip
      const hasAny = Array.isArray(conv.history) && conv.history.length > 0;
      if(hasAny) return;
      const completed = (localStorage.getItem('agui_landing_completed') === '1');
      if(!completed){
        // Replace default welcome with Agent Landing content
        showAgentLanding();
        return;
      }
      // Personalized random welcome when landing is completed
      const userName = (conv.user && conv.user.name) ? conv.user.name : '';
      const firstName = (userName || '').split(/\s+/)[0] || userName || '';
      const variant = pickRandom(BRAND_WIZARD_WELCOME_VARIANTS);
      const welcome = firstName ? (`Hey ${firstName}! ${variant}`) : variant;
      addToHistory('assistant', welcome);
    }catch(e){
      // Fallback: show landing instead of default static welcome
      try{ showAgentLanding(); }catch(_){}
    }
  }

  async function collectAttachments(){
    const files = Array.from(els.fileInput?.files || []);
    if(!files.length) return [];
    const readers = files.map(file => new Promise((resolve)=>{
      const fr = new FileReader();
      fr.onload = ()=> resolve({ name: file.name, type: file.type, size: file.size, url: fr.result });
      fr.onerror = ()=> resolve({ name: file.name, type: file.type, size: file.size });
      fr.readAsDataURL(file);
    }));
    return Promise.all(readers);
  }

  // Build a richer image prompt combining pre-chat info and user text
  function buildImagePrompt(userText){
    let prompt = (userText || '').trim();
    try{
      const pre = JSON.parse(safeLocalStorage('get','agui_prechat') || '{}');
      const idea = (pre.idea || '').trim();
      const name = (pre.name || '').trim();
      const base = [];
      if(name) base.push(`Brand name: ${name}`);
      if(idea) base.push(`Brand idea: ${idea}`);
      const style = 'Style: modern, clean, high-contrast, scalable vector, legible at small sizes.';
      const format = 'Deliver as square or horizontal logo concept.';
      const guidance = 'Use strong typography and simple shapes. Avoid complex details.';
      const combined = [prompt, ...base, style, format, guidance].filter(Boolean).join('\n');
      return combined;
    }catch(e){ return prompt; }
  }

  async function sendMessage(text, attachments=[]){
    if(!text || !text.trim()) return;
    renderMessage({role:'user', text});
    // Opportunistic: trigger image generation for visual prompts in parallel
    try{
      const t = text.toLowerCase();
      const wantsLogo = /\b(create|design|make|generate)\b.*\blogo\b|\blogo\b|brand\s*logo|logo\s*concept|brandmark|wordmark|icon\s*logo/.test(t);
      const wantsVisual = /moodboard|palette|color\s+scheme|visual|instagram/.test(t);
      if(wantsLogo){
        generateImage(buildImagePrompt(text));
      } else if(wantsVisual){
        generateImage(buildImagePrompt(text));
      }
    }catch(e){}
    if(transport==='ws' && conn && conn.readyState===1 && !cfg.forceNonStreaming){
      // Include multiple keys for cross-backend compatibility
      try{ var _n = localStorage.getItem('agui_user_name') || ''; }catch(_){ var _n = ''; }
      try{ var _e = localStorage.getItem('agui_user_email') || ''; }catch(_){ var _e = ''; }
      try{ var _c = localStorage.getItem('agui_contact_id') || ''; }catch(_){ var _c = ''; }
      conn.send(JSON.stringify({type:'user_message', text, attachments, message: text, prompt: text, contactId: _c, user: { name: _n, email: _e, contactId: _c }}));
      return;
    }
    try{
      const postUrl = (cfg.wpSendEndpoint || cfg.sendUrl);
      let _n = ''; let _e = ''; let _c = '';
      try{ _n = localStorage.getItem('agui_user_name') || ''; }catch(_){}
      try{ _e = localStorage.getItem('agui_user_email') || ''; }catch(_){}
      try{ _c = localStorage.getItem('agui_contact_id') || ''; }catch(_){}
      const payload = {type:'user_message', text, attachments, message: text, prompt: text, contactId: _c, user: { name: _n, email: _e, contactId: _c }};
      const res = await fetch(postUrl,{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'Accept':'application/json',
          // Skip ngrok free tunnel browser warning interstitial on first request
          // See ERR_NGROK_6024 guidance
          'ngrok-skip-browser-warning':'true'
        },
        body:JSON.stringify(payload)
      });
      if(!res.ok){
        let errText = '';
        try{ errText = await res.text(); }catch(_){}
        // Attempt fallback endpoint (e.g., FastAPI /api/ask) if configured
        if(cfg.fallbackUrl){
          const r2 = await fetch(cfg.fallbackUrl, {
            method:'POST',
            headers:{
              'Content-Type':'application/json',
              'Accept':'application/json',
              'ngrok-skip-browser-warning':'true'
            },
            body: JSON.stringify({ prompt: text, context: { source: 'agui-chat', error: errText || 'primary send failed' } })
          });
          try{
            const j = await r2.json();
            const reply = j?.response || j?.answer || j?.message || j?.text || '';
            if(reply) renderMessage({role:'assistant', text: reply});
          }catch(_){/* ignore parse errors */}
        }
        if(errText){
          renderMessage({role:'system', text:`Send error: ${errText}`});
        }
      }
    }catch(e){
      renderMessage({role:'system', text:'Failed to send message'});
      // Soft fallback so conversation appears even if backend is unreachable
      renderMessage({role:'assistant', text:'Thanks! I got your message. I’ll guide you from here.'});
    }
  }

  els.connectBtn?.addEventListener('click', connect);
  els.composer?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const v = els.input?.value || '';
    if(els.input) els.input.value='';
    const atts = await collectAttachments();
    try{ els.fileInput && (els.fileInput.value=''); }catch(err){}
    const vTrim = (v||'').trim();
    // Slash commands
    if(/^\/generatelogo\b/i.test(vTrim)){
      const initialText = vTrim.replace(/^\/generatelogo\b\s*/, '');
      openLogoGenerator(initialText);
      return;
    }
    if(/^\/logo\b/i.test(vTrim)){
      const brief = vTrim.replace(/^\/logo\b\s*/, '');
      const prompt = buildImagePrompt(brief || 'Generate a logo concept');
      await generateImage(prompt);
      return;
    }
    sendMessage(v, atts);
  });
  // Enhanced initialization with better cross-browser support
  function initializeChat() {
    console.log('Initializing AG-UI Chat...', {
      preForm: !!els.preForm,
      chatCard: !!els.chatCard,
      connectionStatus: !!els.connectionStatus,
      forceNonStreaming: cfg.forceNonStreaming
    });
    
    try {
      // Set connection status using safe element selection
      const statusEl = safeGetElement('connectionStatus');
      if (statusEl) {
        statusEl.classList.add('status-off');
      }
      
      // Check for HTTPS/HTTP mismatch for FastAPI
      try{
        if(window.location && window.location.protocol==='https:' && /^http:\/\//.test(cfg.fastApiBase)){
          renderMessage({role:'system', text:'FastAPI is configured with http: while this page uses https:. Browsers may block calls. Consider using https for FastAPI or a proxy.'});
        }
      }catch(e){}
      
      // Ensure chat elements are visible and properly initialized
      if (els.chatCard && els.preForm) {
        // Check if we should skip pre-chat form (for testing or returning users)
        const skipPreChat = new URLSearchParams(window.location.search).get('skip_prechat') === '1';
        if (skipPreChat) {
          console.log('Skipping pre-chat form, showing chat directly');
          els.preForm.style.display = 'none';
          els.chatCard.style.display = 'block';
          connect();
        } else {
          console.log('Pre-chat form should be visible');
          // Ensure pre-chat form is visible
          els.preForm.style.display = 'block';
        }
      } else {
        console.warn('Missing chat elements:', { preForm: !!els.preForm, chatCard: !!els.chatCard });
      }
      
      console.log('Chat initialization completed successfully');
      
    } catch(e) {
      console.error('Chat initialization error:', e);
      // Fallback: try to show chat interface anyway
      if (els.chatCard) {
        els.chatCard.style.display = 'block';
      }
      if (els.preForm) {
        els.preForm.style.display = 'block';
      }
    }
  }

  // Multiple initialization triggers for better cross-browser support
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeChat);
  } else {
    initializeChat();
  }
  
  window.addEventListener('load', initializeChat);

  // Helper: build first user message from pre-chat info
  function buildFirstMessage(info){
    try{
      const idea = (info.idea || '').trim();
      return idea || 'I want to build my brand.';
    }catch(e){ return 'I want to build my brand.'; }
  }

  // Helper: build personalized assistant welcome after pre-chat (randomized variants)
  function buildWelcomeMessage(name, email){
    try{
      const firstName = String(name||'').trim().split(/\s+/)[0] || 'there';
      const emailAddress = String(email||'').trim();
      const emailLine = emailAddress ? `your email is ${emailAddress}\n\n` : '';

      // Synonym pools to vary phrasing
      const greets = [
        `Hey ${firstName}!`,
        `Hi ${firstName}!`,
        `Hello ${firstName}!`,
        `Yo ${firstName}!`,
        `Hey there, ${firstName}!`
      ];
      const wizardNames = [
        `Brand Wizard`,
        `brand-building guide`,
        `brand coach`,
        `creative co-pilot`,
        `branding assistant`
      ];
      const openers = [
        `I’m your {wiz} — here to help you build a standout brand.`,
        `I’ll be your {wiz} — let’s shape a brand that pops.`,
        `Your {wiz} reporting for duty — ready to craft something remarkable.`,
        `Meet your {wiz}. Together we’ll build a brand you’ll love.`
      ];
      const howWorks = [
        `Here’s how it works:`,
        `Quick game plan:`,
        `The flow is simple:`,
        `What we’ll do:`
      ];
      const steps = [
        `We’ll define your identity (name, colors, logo), pick the right products, and produce a polished mockup — one clear question at a time.`,
        `We’ll lock in your brand identity (name, palette, logo), select products, and make a slick mockup — fast and easy.`,
        `We’ll shape your identity (name, colors, logo), choose products, and deliver a clean mockup — step by step.`
      ];
      const instaPrompts = [
        `Want me to analyze your Instagram for tailored ideas, or should we start with your own brand concepts? If you’re up for the Instagram route, share your handle or profile link!`,
        `Should I pull inspiration from your Instagram, or dive straight into your brand ideas? If Instagram sounds good, just drop your username or profile URL.`,
        `Prefer a personalized take from your Instagram, or kick off with your own ideas? If Instagram, send your @handle or profile link.`
      ];

      // Pick random elements, avoiding repeating the last template index
      function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
      const greet = pick(greets);
      const opener = pick(openers).replace('{wiz}', pick(wizardNames));
      const how = pick(howWorks);
      const step = pick(steps);
      const insta = pick(instaPrompts);

      const message = `${greet} ${opener}\n\n${emailLine}${how}\n${step}\n\n${insta}`;

      // Store last welcome snippet to reduce consecutive similarity (best-effort)
      try{ safeLocalStorage('set','agui_last_welcome', String(Date.now())); }catch(_){}
      return message;
    }catch(e){
      return `Hey there! I’m your Brand Wizard—ready to help you build a standout brand.`;
    }
  }

  // Enhanced localStorage handling for private browsing compatibility
  function safeLocalStorage(action, key, value) {
    try {
      if (action === 'set') {
        localStorage.setItem(key, value);
        return true;
      } else if (action === 'get') {
        return localStorage.getItem(key);
      } else if (action === 'remove') {
        localStorage.removeItem(key);
        return true;
      }
    } catch(e) {
      // Private browsing mode or localStorage disabled
      if (action === 'get') return null;
      return false;
    }
  }

  // Extract contact ID from various possible response shapes (robust deep search)
  function extractContactId(resp){
    try{
      if(!resp) return null;
      let obj = resp;
      if(typeof obj === 'string'){
        try{ obj = JSON.parse(obj); }catch(_){ return null; }
      }
      // Direct fields
      const direct = obj.contactId || obj.contactID || obj.id || obj._id || obj.contact_id;
      if(direct){ return String(direct); }
      // Common nested paths
      const paths = [
        ['data','id'], ['data','contactId'], ['data','contactID'],
        ['result','id'], ['result','contactId'], ['result','contactID'],
        ['contact','id'], ['contact','contactId'], ['contact','contactID'],
        ['data','contact','id'], ['data','contact','contactId'], ['data','contact','contactID'],
        ['result','contact','id'], ['result','contact','contactId'], ['result','contact','contactID']
      ];
      for(const p of paths){
        let cur = obj;
        for(const k of p){
          if(cur && typeof cur === 'object' && k in cur){ cur = cur[k]; }
          else { cur = null; break; }
        }
        if(cur != null){ return String(cur); }
      }
      // Deep scan: find any string value that looks like a contact id (e.g., c_...)
      const stack = [obj];
      while(stack.length){
        const node = stack.pop();
        if(!node) continue;
        if(typeof node === 'object'){
          for(const [k,v] of Object.entries(node)){
            if(typeof v === 'string'){
              if(/^c_[a-zA-Z0-9]+$/.test(v)) return v;
            }
            if(v && typeof v === 'object') stack.push(v);
          }
        }
      }
      return null;
    }catch(e){ return null; }
  }

  // Pre-chat form submission -> create GHL contact via WP REST, then proceed to on-page chat
  // Helper: show inline alert on the landing form or container even if preForm is missing
  function showPrechatAlert(msg){
    // Non-blocking: remove any existing alert line and only log to console
    try{
      const existing = document.getElementById('prechat-alert-line');
      if(existing){ existing.remove(); }
      if(msg){ console.warn('[Prechat]', msg); }
    }catch(e){}
  }

  // If form not detected, try binding to a likely submit button and collect fields heuristically
  function detectPrechatFields(){
    try{
      const roots = [document.querySelector('#agentLanding'), document.querySelector('#agent-landing'), document.querySelector('#agentLandingForm'), document.querySelector('.agent-landing'), document.body];
      const fields = {};
      const pick = (root, sel)=>{ try{ return root && root.querySelector(sel); }catch(e){ return null; } };
      for(const r of roots){ if(!r) continue;
        fields.nameEl = fields.nameEl || pick(r,'input[name="name"],input[name="firstName"],input[placeholder*="Name"]');
        fields.emailEl = fields.emailEl || pick(r,'input[type="email"],input[name="email"],input[placeholder*="Email"]');
        fields.phoneEl = fields.phoneEl || pick(r,'input[name="phone"],input[placeholder*="Phone"],input[type="tel"]');
        fields.ideaEl  = fields.ideaEl  || pick(r,'textarea[name="idea"],textarea, input[name="idea"]');
        fields.submitEl= fields.submitEl|| pick(r,'button[type="submit"],input[type="submit"],button.btn-primary');
      }
      // Fallback global search
      const gpick = (sel)=>{ try{ return document.querySelector(sel); }catch(e){ return null; } };
      fields.nameEl = fields.nameEl || gpick('input[name="name"],input[name="firstName"],input[placeholder*="Name"],input[aria-label*="Name"]');
      fields.emailEl = fields.emailEl || gpick('input[type="email"],input[name="email"],input[placeholder*="Email"],input[aria-label*="Email"]');
      fields.phoneEl = fields.phoneEl || gpick('input[name="phone"],input[placeholder*="Phone"],input[type="tel"],input[aria-label*="Phone"]');
      fields.ideaEl  = fields.ideaEl  || gpick('textarea[name="idea"],textarea, input[name="idea"],textarea[aria-label*="Idea"],textarea[placeholder*="Idea"]');
      fields.submitEl= fields.submitEl|| gpick('button[type="submit"],input[type="submit"],button.btn-primary');
      // Additional CTA button heuristics (Elementor/Divi/etc.)
      if(!fields.submitEl){
        const candidates = Array.from(document.querySelectorAll('button, a.button, .elementor-button, input[type="button"], .btn, .btn-primary'));
        const submitLike = candidates.find(el=>{
          const t = String((el.textContent||el.value||'')).toLowerCase();
          return /start|chat|begin|continue|send|let'?s\s?go|next|submit/.test(t);
        });
        if(submitLike) fields.submitEl = submitLike;
      }
      if(fields.nameEl || fields.emailEl || fields.ideaEl || fields.submitEl) return fields;
      return null;
    }catch(e){ return null; }
  }

  let buttonBound = false;
  if(!els.preForm){
    try{
      const fields = detectPrechatFields();
      if(fields && fields.submitEl && !buttonBound){
        buttonBound = true;
        showPrechatAlert('Pre-chat form not found. Using button handler.');
        fields.submitEl.addEventListener('click', async (e)=>{
          e.preventDefault();
          const val = (el)=>{ try{ return (el && 'value' in el) ? String(el.value||'').trim() : ''; }catch(_){ return ''; } };
          const payload = { name: val(fields.nameEl), email: val(fields.emailEl), phone: val(fields.phoneEl), idea: val(fields.ideaEl) };
          safeLocalStorage('set', 'agui_prechat', JSON.stringify(payload));
          try{ localStorage.setItem('agui_user_name', (payload.name||'').trim()); }catch(_){}
          try{ localStorage.setItem('agui_user_email', (payload.email||'').trim()); }catch(_){}
          let cid = '';
          if(!cfg || !cfg.wpFormEndpoint){ console.warn('Endpoint not configured; proceeding without contactId'); }
          else {
            try{
              const resp = await fetch(cfg.wpFormEndpoint, { method:'POST', headers:{'Content-Type':'application/json','ngrok-skip-browser-warning':'true'}, body: JSON.stringify(payload) });
              let j = null; try{ const text = await resp.text(); j = JSON.parse(text); }catch(parseErr){}
              cid = extractContactId(j) || '';
              if(cid){ try{ localStorage.setItem('agui_contact_id', cid); }catch(_){} }
            }catch(err){ console.warn('Network error while creating contact. Continuing without contactId.', err); }
          }
          try{
            if(cid){
              let line = document.getElementById('prechat-contact-id-line'); let span = document.getElementById('prechat-contact-id');
              if(!line){ line = document.createElement('div'); line.id='prechat-contact-id-line'; line.className='contact-id-row'; line.style.cssText='margin-top:8px; font-size:13px; color:#374151;'; span=document.createElement('span'); span.id='prechat-contact-id'; line.innerHTML='Contact ID: '; line.appendChild(span); (document.querySelector('#agentLanding')||document.body).appendChild(line); }
              if(span){ span.textContent = cid; }
              line.style.display='block';
            }
            const card = document.getElementById('chatCard'); if(card){ card.style.display='block'; card.classList.add('animate-in'); }
          }catch(e){}
          const firstMsg = buildFirstMessage(payload); pendingFirstMsg = firstMsg; try{ els.input && (els.input.value = ''); }catch(e){}
          connect(); setTimeout(()=>{ if(pendingFirstMsg){ const msg = pendingFirstMsg; pendingFirstMsg=null; sendMessage(msg); } }, 1200);
          try{ const nm=(payload.name||'').trim(); const em=(payload.email||'').trim(); const welcome = buildWelcomeMessage(nm, em); addToHistory('assistant', welcome); }catch(_){}
          try{ updateSuggestionsVisibility(); }catch(err){}
        });
      } else {
        /* Pre-chat form not found; non-blocking mode (no alert). Chat remains usable without contactId. */
      }
      // Retry scan for dynamically-rendered forms/buttons (Elementor/Divi)
      if(!buttonBound && !els.preForm){
        let tries = 0;
        const timer = setInterval(()=>{
          if(buttonBound || els.preForm){ clearInterval(timer); return; }
          tries++;
          const f = detectPrechatForm();
          if(f && !els.preForm){
            els.preForm = f;
            try{ /* submit listener below will handle */ }catch(_){}
            clearInterval(timer);
            return;
          }
          const fs = detectPrechatFields();
          if(fs && fs.submitEl && !buttonBound){
            buttonBound = true;
            clearInterval(timer);
            showPrechatAlert('Pre-chat form detected late. Using button handler.');
            fs.submitEl.addEventListener('click', async (e)=>{
              e.preventDefault();
              const val = (el)=>{ try{ return (el && 'value' in el) ? String(el.value||'').trim() : ''; }catch(_){ return ''; } };
              const payload = { name: val(fs.nameEl), email: val(fs.emailEl), phone: val(fs.phoneEl), idea: val(fs.ideaEl) };
              safeLocalStorage('set', 'agui_prechat', JSON.stringify(payload));
              try{ localStorage.setItem('agui_user_name', (payload.name||'').trim()); }catch(_){}
              try{ localStorage.setItem('agui_user_email', (payload.email||'').trim()); }catch(_){}
              let cid = '';
              if(!cfg || !cfg.wpFormEndpoint){ console.warn('Endpoint not configured; proceeding without contactId'); }
              else {
                try{
                  const resp = await fetch(cfg.wpFormEndpoint, { method:'POST', headers:{'Content-Type':'application/json','ngrok-skip-browser-warning':'true'}, body: JSON.stringify(payload) });
                  let j = null; try{ const text = await resp.text(); j = JSON.parse(text); }catch(parseErr){}
                  cid = extractContactId(j) || '';
                  if(cid){ try{ localStorage.setItem('agui_contact_id', cid); }catch(_){} }
                }catch(err){ console.warn('Network error while creating contact. Continuing without contactId.', err); }
              }
              try{
                if(cid){
                  let line = document.getElementById('prechat-contact-id-line'); let span = document.getElementById('prechat-contact-id');
                  if(!line){ line = document.createElement('div'); line.id='prechat-contact-id-line'; line.className='contact-id-row'; line.style.cssText='margin-top:8px; font-size:13px; color:#374151;'; span=document.createElement('span'); span.id='prechat-contact-id'; line.innerHTML='Contact ID: '; line.appendChild(span); (document.querySelector('#agentLanding')||document.body).appendChild(line); }
                  if(span){ span.textContent = cid; }
                  line.style.display='block';
                }
                const card = document.getElementById('chatCard'); if(card){ card.style.display='block'; card.classList.add('animate-in'); }
              }catch(e){}
              const firstMsg = buildFirstMessage(payload); pendingFirstMsg = firstMsg; try{ els.input && (els.input.value = ''); }catch(e){}
              connect(); setTimeout(()=>{ if(pendingFirstMsg){ const msg = pendingFirstMsg; pendingFirstMsg=null; sendMessage(msg); } }, 1200);
              try{ const nm=(payload.name||'').trim(); const em=(payload.email||'').trim(); const welcome = buildWelcomeMessage(nm, em); addToHistory('assistant', welcome); }catch(_){}
              try{ updateSuggestionsVisibility(); }catch(err){}
            });
          }
          if(tries>20){ clearInterval(timer); }
        }, 600);
        setTimeout(()=>{ try{ clearInterval(timer); }catch(_){} }, 12000);
      }
    }catch(e){ /* ignore */ }
  }

  els.preForm?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(els.preForm);
    const payload = Object.fromEntries(fd.entries());
    safeLocalStorage('set', 'agui_prechat', JSON.stringify(payload));
    // Persist identity so messages include it
    try{ localStorage.setItem('agui_user_name', (payload.name||'').trim()); }catch(_){}
    try{ localStorage.setItem('agui_user_email', (payload.email||'').trim()); }catch(_){}

    let cid = '';
    // Try to create/update contact; proceed without it if unavailable
    if(!cfg || !cfg.wpFormEndpoint){
      console.warn('Endpoint not configured; proceeding without contactId');
    } else {
      try{
        console.log('🔄 Submitting to:', cfg.wpFormEndpoint, 'Payload:', payload);
        const resp = await fetch(cfg.wpFormEndpoint, { method:'POST', headers:{'Content-Type':'application/json','ngrok-skip-browser-warning':'true'}, body: JSON.stringify(payload) });
        console.log('📡 Response status:', resp.status, resp.statusText);
        let j = null;
        try{ 
          const text = await resp.text();
          console.log('📄 Raw response:', text);
          j = JSON.parse(text);
          console.log('📋 Parsed JSON:', j);
        }catch(parseErr){ 
          console.log('❌ JSON parse failed:', parseErr);
        }
        cid = extractContactId(j) || '';
        console.log('🆔 Extracted contactId:', cid);
        if(cid){ 
          try{ localStorage.setItem('agui_contact_id', cid); console.log('✅ Stored agui_contact_id:', cid); }catch(_){}
        }
      }catch(err){
        console.log('❌ Fetch error (continuing without contactId):', err);
      }
    }

    // Attach user profile to active conversation (for exports and state)
    try{
      let conv = getActive();
      if(!conv){ createConversation('New chat'); conv = getActive(); }
      if(conv){
        conv.user = { name: (payload.name||'').trim(), email: (payload.email||'').trim(), contactId: cid };
        saveState();
      }
    }catch(_){}

    // Show Contact ID on landing form (only if available), then hide with fade-out; reveal chat, and connect
    try {
      if(cid){
        let line = document.getElementById('prechat-contact-id-line');
        let span = document.getElementById('prechat-contact-id');
        // Create the Contact ID row if it's not present in the markup
        if(!line){
          line = document.createElement('div');
          line.id = 'prechat-contact-id-line';
          line.className = 'contact-id-row';
          line.style.cssText = 'margin-top:8px; font-size:13px; color:#374151;';
          span = document.createElement('span');
          span.id = 'prechat-contact-id';
          line.innerHTML = 'Contact ID: ';
          line.appendChild(span);
          if(els.preForm) els.preForm.appendChild(line);
        }
        if(span){ span.textContent = cid; }
        if(line){ line.style.display = 'block'; }
      }
      if(els.preForm) els.preForm.classList.add('fade-out');
      setTimeout(()=>{ if(els.preForm) els.preForm.style.display='none'; }, 2000);
      const card = document.getElementById('chatCard');
      if(card){ card.style.display='block'; card.classList.add('animate-in'); }
    } catch(e){}

    // Brand idea as the initial message in chat (queue until connected)
    const firstMsg = buildFirstMessage(payload);
    pendingFirstMsg = firstMsg;
    try{ els.input && (els.input.value = ''); }catch(e){}
    connect();
    setTimeout(()=>{ if(pendingFirstMsg){ const msg = pendingFirstMsg; pendingFirstMsg=null; sendMessage(msg); } }, 1200);

    // Show a system confirmation including Contact ID if available (pre-chat flow)
    try{
      const nm = (payload.name||'').trim();
      const em = (payload.email||'').trim();
      const sysMsg = cid ? `Saved your details — Name: ${nm}, Email: ${em}, Contact ID: ${cid}` : `Saved your details — Name: ${nm}, Email: ${em}`;
      addToHistory('system', sysMsg);
    }catch(_){}

    // Render quick suggestions (only after user has initiated)
    try{ updateSuggestionsVisibility(); }catch(err){}
  });
  // ===== Logo Generator Plugin =====
  let lgOverlay = null;
  function initLogoGenerator(){
    if(lgOverlay) return;
    lgOverlay = document.createElement('div');
    lgOverlay.className = 'lg-overlay';
    lgOverlay.innerHTML = `
      <div class="lg-modal">
        <div class="lg-left">
          <div class="lg-title">Logo Generator</div>
          <div class="lg-controls">
            <div class="lg-field"><label>Brand Name</label><input id="lgText" type="text" placeholder="Your Brand"></div>
            <div class="lg-field"><label>Tagline</label><input id="lgTagline" type="text" placeholder="Optional"></div>
            <div class="lg-field"><label>Font</label>
              <select id="lgFont">
                <option value="Figtree, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial">Figtree</option>
                <option value="Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial">Inter</option>
                <option value="Roboto, system-ui, -apple-system, Segoe UI, Helvetica, Arial">Roboto</option>
                <option value="Georgia, serif">Georgia</option>
              </select>
            </div>
            <div class="lg-field"><label>Layout</label>
              <select id="lgLayout">
                <option value="icon-left">Icon Left</option>
                <option value="icon-top">Icon Top</option>
                <option value="icon-right">Icon Right</option>
                <option value="wordmark">Wordmark</option>
                <option value="monogram">Monogram</option>
              </select>
            </div>
            <div class="lg-row">
              <div class="lg-field"><label>Scheme</label>
                <select id="lgScheme">
                  <option value="ocean">Ocean</option>
                  <option value="sunset">Sunset</option>
                  <option value="forest">Forest</option>
                  <option value="mono">Monochrome</option>
                </select>
              </div>
              <div class="lg-field"><label>Primary</label><input id="lgPrimary" type="color" value="#0ea5e9"></div>
              <div class="lg-field"><label>Secondary</label><input id="lgSecondary" type="color" value="#7aa2f7"></div>
            </div>
            <div class="lg-field"><label>Icon</label>
              <div id="lgIcons" class="lg-icons"></div>
            </div>
          </div>
          <div class="lg-actions">
            <button class="btn btn-primary" id="lgInsert">Insert into Chat</button>
            <button class="btn" id="lgSvg">Download SVG</button>
            <button class="btn" id="lgPng">Download PNG</button>
            <button class="btn" id="lgClose">Close</button>
          </div>
        </div>
        <div class="lg-right">
          <div class="lg-preview-wrap">
            <div id="lgPreview" class="lg-preview"></div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(lgOverlay);
    // Populate icons
    const iconList = ['circle','square','triangle','hexagon','star','bolt'];
    const iconsEl = lgOverlay.querySelector('#lgIcons');
    iconList.forEach(name => {
      const b = document.createElement('button');
      b.type='button'; b.className='lg-icon'; b.dataset.icon=name;
      b.innerHTML = buildIconSvg(name, 32, '#334155');
      b.addEventListener('click', ()=>{
        iconsEl.querySelectorAll('.lg-icon').forEach(x=>x.classList.remove('selected'));
        b.classList.add('selected');
        selectedIcon = name; updatePreview();
      });
      iconsEl.appendChild(b);
    });
    // Default selected
    iconsEl.querySelector('.lg-icon')?.classList.add('selected');
  }

  const schemes = {
    ocean: { primary:'#0ea5e9', secondary:'#7aa2f7', text:'#0f172a' },
    sunset:{ primary:'#ef4444', secondary:'#f59e0b', text:'#111827' },
    forest:{ primary:'#16a34a', secondary:'#0ea5e9', text:'#0f172a' },
    mono:  { primary:'#0f172a', secondary:'#64748b', text:'#0f172a' },
  };
  let selectedIcon = 'circle';

  function buildIconSvg(shape, size, color){
    const s = size || 32; const c = color || '#334155';
    const svgStart = `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" xmlns="http://www.w3.org/2000/svg">`;
    const svgEnd = `</svg>`;
    let inner='';
    const pad = s*0.08;
    const r = (s/2);
    switch(shape){
      case 'circle': inner = `<circle cx="${r}" cy="${r}" r="${r - pad}" fill="${c}"/>`; break;
      case 'square': inner = `<rect x="${pad}" y="${pad}" width="${s-2*pad}" height="${s-2*pad}" rx="${s*0.18}" fill="${c}"/>`; break;
      case 'triangle': inner = `<polygon points="${s/2},${pad} ${s-pad},${s-pad} ${pad},${s-pad}" fill="${c}"/>`; break;
      case 'hexagon': {
        const a = s/2; const b = pad; const y = s/2; const x = s/2;
        inner = `<polygon points="${x},${b} ${s-b},${y*0.8} ${s-b},${y*1.2} ${x},${s-b} ${b},${y*1.2} ${b},${y*0.8}" fill="${c}"/>`;
        break;
      }
      case 'star': inner = `<polygon points="${r},${pad} ${r*1.25},${r*0.9} ${s-pad},${r} ${r*1.25},${r*1.1} ${r},${s-pad} ${r*0.75},${r*1.1} ${pad},${r} ${r*0.75},${r*0.9}" fill="${c}"/>`; break;
      case 'bolt': inner = `<polygon points="${r*0.6},${pad} ${s*0.75},${r} ${r*0.9},${r} ${s-pad},${s-pad} ${s*0.4},${r} ${r*0.65},${r} ${pad},${pad}" fill="${c}"/>`; break;
      default: inner = `<circle cx="${r}" cy="${r}" r="${r - pad}" fill="${c}"/>`;
    }
    return svgStart + inner + svgEnd;
  }

  function buildLogoSvg(opts={}){
    const w = opts.width || 800; const h = opts.height || 400;
    const brand = (opts.text || 'Your Brand').slice(0, 48);
    const tagline = (opts.tagline || '').slice(0, 80);
    const font = opts.font || 'Figtree, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    const primary = opts.primary || '#0ea5e9';
    const secondary = opts.secondary || '#7aa2f7';
    const textColor = opts.textColor || '#0f172a';
    const layout = opts.layout || 'icon-left';
    const icon = opts.icon || 'circle';

    const padding = 28;
    const iconSize = Math.min(h - padding*2, 160);
    const iconXLeft = padding;
    const iconYCenter = h/2;

    const brandSize = Math.min(64, Math.max(32, Math.floor(h/5)));
    const tagSize = Math.floor(brandSize * 0.45);

    const svgParts = [];
    svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="geometricPrecision">`);
    // Optional subtle divider
    if(layout!=='wordmark'){
      svgParts.push(`<g transform="translate(${iconXLeft}, ${iconYCenter - iconSize/2})">${buildIconSvg(icon, iconSize, primary)}</g>`);
    }
    let textX = padding + (layout==='wordmark' ? 0 : iconSize + 24);
    let textY = h/2;
    let textAnchor = 'start';
    if(layout==='icon-top'){
      textX = w/2; textY = iconYCenter + iconSize/2 + 28; textAnchor = 'middle';
    }
    if(layout==='icon-right'){
      // icon on right: place icon, shift text left
      svgParts[1] = `<g transform="translate(${w - iconSize - padding}, ${iconYCenter - iconSize/2})">${buildIconSvg(icon, iconSize, primary)}</g>`;
      textX = padding; textY = h/2; textAnchor = 'start';
    }
    if(layout==='monogram'){
      // Use first letter of brand as an overlaid monogram beside wordmark
      const mono = escapeHtml((brand||'Y').charAt(0).toUpperCase());
      svgParts.push(`<circle cx="${iconXLeft + iconSize/2}" cy="${iconYCenter}" r="${iconSize/2}" fill="${secondary}" opacity="0.2"/>`);
      svgParts.push(`<text x="${iconXLeft + iconSize/2}" y="${iconYCenter + brandSize/3}" text-anchor="middle" font-family="${font}" font-size="${brandSize*1.4}" font-weight="700" fill="${primary}">${mono}</text>`);
    }
    // Brand text
    svgParts.push(`<text x="${textX}" y="${textY}" text-anchor="${textAnchor}" font-family="${font}" font-size="${brandSize}" font-weight="700" fill="${textColor}">${escapeHtml(brand)}</text>`);
    if(tagline){ svgParts.push(`<text x="${textX}" y="${textY + tagSize + 10}" text-anchor="${textAnchor}" font-family="${font}" font-size="${tagSize}" font-weight="400" fill="${secondary}">${escapeHtml(tagline)}</text>`); }
    svgParts.push('</svg>');
    return svgParts.join('');
  }

  function openLogoGenerator(initialText){
    initLogoGenerator();
    lgOverlay.style.display = 'flex';
    const elText = lgOverlay.querySelector('#lgText');
    const elTag = lgOverlay.querySelector('#lgTagline');
    const elFont = lgOverlay.querySelector('#lgFont');
    const elLayout = lgOverlay.querySelector('#lgLayout');
    const elScheme = lgOverlay.querySelector('#lgScheme');
    const elPrim = lgOverlay.querySelector('#lgPrimary');
    const elSec = lgOverlay.querySelector('#lgSecondary');
    const preview = lgOverlay.querySelector('#lgPreview');
    if(initialText){ elText.value = initialText; }

    const applyScheme = (name)=>{
      const sc = schemes[name] || schemes.ocean;
      elPrim.value = sc.primary; elSec.value = sc.secondary; updatePreview();
    };
    const getOpts = ()=>({
      text: elText.value || 'Your Brand', tagline: elTag.value || '', font: elFont.value,
      layout: elLayout.value, primary: elPrim.value, secondary: elSec.value,
      textColor: schemes[elScheme.value]?.text || '#0f172a', icon: selectedIcon
    });
    window.updatePreview = function(){
      const svg = buildLogoSvg(getOpts());
      preview.innerHTML = svg;
    };
    applyScheme(elScheme.value || 'ocean');
    // Event wires
    ['input','change'].forEach(evt=>{
      elText.addEventListener(evt, updatePreview);
      elTag.addEventListener(evt, updatePreview);
      elFont.addEventListener(evt, updatePreview);
      elLayout.addEventListener(evt, updatePreview);
      elPrim.addEventListener(evt, updatePreview);
      elSec.addEventListener(evt, updatePreview);
      elScheme.addEventListener(evt, ()=> applyScheme(elScheme.value));
    });
    // Actions
    lgOverlay.querySelector('#lgClose').onclick = ()=>{ lgOverlay.style.display='none'; };
    lgOverlay.querySelector('#lgSvg').onclick = ()=>{
      const svg = buildLogoSvg(getOpts());
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href=url; a.download='logo.svg'; a.click(); setTimeout(()=>URL.revokeObjectURL(url), 500);
    };
    lgOverlay.querySelector('#lgPng').onclick = ()=>{
      const svg = buildLogoSvg(getOpts());
      const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      const img = new Image(); img.onload = ()=>{
        const w = 1200; const h = 600; const canvas = document.createElement('canvas'); canvas.width=w; canvas.height=h;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,w,h);
        ctx.drawImage(img, 0, 0, w, h);
        const pngUrl = canvas.toDataURL('image/png');
        // Show PNG inline in chat
        renderImage(pngUrl, 'Logo PNG');
        // Also offer a download
        const a = document.createElement('a'); a.href=pngUrl; a.download='logo.png'; a.click();
      }; img.src = dataUrl;
    };
    lgOverlay.querySelector('#lgInsert').onclick = ()=>{
      const svg = buildLogoSvg(getOpts());
      const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      renderImage(dataUrl, 'Logo preview');
      lgOverlay.style.display='none';
    };
    // Initial preview
    updatePreview();
  }

  // ===== Live Settings Sync (poll WP settings and apply in real-time) =====
  function startSettingsSync(){
    try{
      const endpoint = (cfg.wpSettingsEndpoint || '').replace(/\/$/, '');
      if(!endpoint) return;
      let last = {
        sseUrl: cfg.sseUrl || '',
        wsUrl: cfg.wsUrl || '',
        sendUrl: cfg.sendUrl || '',
        preferWebSocket: !!cfg.preferWebSocket,
        fallbackUrl: cfg.fallbackUrl || '',
        wpSendEndpoint: cfg.wpSendEndpoint || '',
        wpFormEndpoint: cfg.wpFormEndpoint || '',
        wpImageEndpoint: cfg.wpImageEndpoint || '',
        fastApiBase: cfg.fastApiBase || '',
        dbToken: cfg.dbToken || '',
        agentImageEndpoint: cfg.agentImageEndpoint || ''
      };
      const upgrade = (u)=>{
        if(!u) return u;
        try{
          if(window.location && window.location.protocol==='https:'){
            if(/^http:\/\//.test(u)) return u.replace(/^http:\/\//,'https://');
            if(/^ws:\/\//.test(u)) return u.replace(/^ws:\/\//,'wss://');
          }
        }catch(e){}
        return u;
      };
      const apply = (next)=>{
        // update cfg in place
        cfg.sseUrl = upgrade(next.sseUrl || cfg.sseUrl || '');
        cfg.wsUrl = upgrade(next.wsUrl || cfg.wsUrl || '');
        cfg.sendUrl = upgrade(next.sendUrl || cfg.sendUrl || '');
        cfg.preferWebSocket = !!(typeof next.preferWebSocket==='boolean' ? next.preferWebSocket : cfg.preferWebSocket);
        cfg.fallbackUrl = next.fallbackUrl || cfg.fallbackUrl || '';
        cfg.wpSendEndpoint = sanitizeUrl(next.wpSendEndpoint || cfg.wpSendEndpoint || '');
        cfg.wpFormEndpoint = sanitizeUrl(next.wpFormEndpoint || cfg.wpFormEndpoint || '');
        cfg.wpImageEndpoint = sanitizeUrl(next.wpImageEndpoint || cfg.wpImageEndpoint || '');
        cfg.fastApiBase = (next.fastApiBase || cfg.fastApiBase || '').replace(/\/$/, '');
        cfg.dbToken = next.dbToken || cfg.dbToken || '';
        // derive agentImageEndpoint if provided or from sendUrl
        cfg.agentImageEndpoint = (next.agentImageEndpoint || '').replace(/\/$/, '') || cfg.agentImageEndpoint || '';
        if(!cfg.agentImageEndpoint && cfg.sendUrl){
          try{ const u = new URL(cfg.sendUrl); cfg.agentImageEndpoint = `${u.protocol}//${u.host}/api/fal/generate`; }catch(e){}
        }
      };
      const changed = (a,b)=>{
        const keys = Object.keys(a);
        for(const k of keys){ if(String(a[k]||'') !== String(b[k]||'')) return true; }
        return false;
      };
      const snapshot = ()=>{
        return {
          sseUrl: cfg.sseUrl || '',
          wsUrl: cfg.wsUrl || '',
          sendUrl: cfg.sendUrl || '',
          preferWebSocket: !!cfg.preferWebSocket,
          fallbackUrl: cfg.fallbackUrl || '',
          wpSendEndpoint: cfg.wpSendEndpoint || '',
          wpFormEndpoint: cfg.wpFormEndpoint || '',
          wpImageEndpoint: cfg.wpImageEndpoint || '',
          fastApiBase: cfg.fastApiBase || '',
          dbToken: cfg.dbToken || '',
          agentImageEndpoint: cfg.agentImageEndpoint || ''
        };
      };
      const reconnectIfNeeded = (prev, next)=>{
        const transportChanged = (prev.wsUrl!==next.wsUrl) || (prev.sseUrl!==next.sseUrl) || (prev.preferWebSocket!==next.preferWebSocket);
        if(transportChanged){
          try{ conn?.close?.(); }catch(e){}
          renderMessage({role:'system', text:'Settings updated — reconnecting…'});
          if(cfg.preferWebSocket && 'WebSocket' in window){ startWebSocket(); } else if(cfg.sseUrl){ startSSE(); }
          // Notify other modules
          try{ window.dispatchEvent(new CustomEvent('agui:settings-updated', { detail: { prev, next } })); }catch(e){}
        }
      };
      const poll = async ()=>{
        try{
          const res = await fetch(endpoint, { method:'GET', headers:{ 'Accept':'application/json', 'ngrok-skip-browser-warning':'true' }, cache: 'no-store' });
          if(!res.ok) return;
          const data = await res.json().catch(()=>null);
          if(!data) return;
          const nextRaw = {
            sseUrl: data.sseUrl, wsUrl: data.wsUrl, sendUrl: data.sendUrl, preferWebSocket: !!data.preferWebSocket,
            fallbackUrl: data.fallbackUrl, wpSendEndpoint: data.wpSendEndpoint, wpFormEndpoint: data.wpFormEndpoint,
            wpImageEndpoint: data.wpImageEndpoint, fastApiBase: data.fastApiBase, dbToken: data.dbToken, agentImageEndpoint: data.agentImageEndpoint
          };
          // Check for changes versus last snapshot
          if(changed(last, nextRaw)){
            const prev = snapshot();
            apply(nextRaw);
            const next = snapshot();
            last = next;
            reconnectIfNeeded(prev, next);
          }
        }catch(e){ /* ignore transient errors */ }
      };
      // Initial poll soon after load, then periodic
      poll();
      try{ window.clearInterval(window.__aguiSettingsTimer); }catch(e){}
      window.__aguiSettingsTimer = window.setInterval(poll, 8000);
    }catch(e){}
  }
  window.addEventListener('load', startSettingsSync);

  // ===== BM Chat UI Logic (sidebar + streaming SSE POST) =====
  (function initBmChat(){
    const app = document.querySelector('.bm-chat-app') || document.body;
    if(!app) return; // Initialize only when app container is present
    const els = {
      list: document.getElementById('bm-conversation-list') || document.getElementById('conversation-list'),
      messages: document.getElementById('bm-chat-messages') || document.getElementById('chat-messages'),
      input: document.getElementById('bm-user-input') || document.getElementById('user-input'),
      send: document.getElementById('bm-send-btn') || document.getElementById('send-button') || document.getElementById('sendBtn'),
      attachBtn: document.getElementById('bm-attach-button') || document.getElementById('attach-button'),
      voiceBtn: document.getElementById('bm-voice-button') || document.getElementById('voice-button'),
      fileInput: document.getElementById('bm-file-input') || document.getElementById('file-input'),
      error: document.getElementById('bm-error') || document.getElementById('error'),
      newChat: document.getElementById('bm-new-chat-btn') || document.getElementById('new-chat'),
      sidebarToggle: document.getElementById('sidebar-toggle'),
      sidebarMenuBtn: document.getElementById('bm-sidebar-menu-btn'),
      sidebarMenu: document.getElementById('bm-sidebar-menu'),
      menuRename: document.getElementById('bm-menu-rename'),
      menuRemove: document.getElementById('bm-menu-remove'),

    };



    // Sidebar collapse + with-sidebar setup (ported from frontend)
    const sidebarEl = document.querySelector('.bm-sidebar') || document.querySelector('.sidebar');
    if(sidebarEl){ document.body.classList.add('with-sidebar'); }
    const SIDEBAR_COLLAPSE_KEY = 'sidebarCollapsed';
    function applySidebarCollapsed(collapsed){
      const bodyEl = document.body;
      const EXPANDED_ICON = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-hidden="true" role="img" class="component-iconify MuiBox-root css-1t9pz9x iconify iconify--eva" width="1em" height="1em" viewBox="0 0 24 24"><path fill="currentColor" d="M13.83 19a1 1 0 0 1-.78-.37l-4.83-6a1 1 0 0 1 0-1.27l5-6a1 1 0 0 1 1.54 1.28L10.29 12l4.32 5.36a1 1 0 0 1-.78 1.64"></path></svg>';
      const COLLAPSED_ICON = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-hidden="true" role="img" class="component-iconify MuiBox-root css-16xnpwk iconify iconify--iconamoon" width="1em" height="1em" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m10 17l5-5m0 0l-5-5"></path></svg>';
      const newChatBtnEl = els.newChat;
      if(collapsed){
        bodyEl.classList.add('sidebar-collapsed');
        sidebarEl?.classList.add('collapsed');
        if(els.sidebarToggle){ els.sidebarToggle.setAttribute('aria-expanded','false'); els.sidebarToggle.innerHTML = COLLAPSED_ICON; }
        if(newChatBtnEl) newChatBtnEl.style.display = 'none';
        // sidebar collapsed; expand chat to full width via CSS body.sidebar-collapsed
        // (no floating menu)
      }else{
        bodyEl.classList.remove('sidebar-collapsed');
        sidebarEl?.classList.remove('collapsed');
        if(els.sidebarToggle){ els.sidebarToggle.setAttribute('aria-expanded','true'); els.sidebarToggle.innerHTML = EXPANDED_ICON; }
        if(newChatBtnEl) newChatBtnEl.style.display = 'inline-flex';
      }
      try{ if(typeof updateInputPosition === 'function'){ updateInputPosition(); } }catch(e){}
    }
    // Floating toggle removed per requirements (no menu)

    try{
      const initialCollapsed = safeLocalStorage('get', SIDEBAR_COLLAPSE_KEY) === '1';
      applySidebarCollapsed(initialCollapsed);
    }catch(e){}
    els.sidebarToggle?.addEventListener('click', ()=>{
      const isCollapsed = document.body.classList.contains('sidebar-collapsed');
      const next = !isCollapsed;
      applySidebarCollapsed(next);
      safeLocalStorage('set', SIDEBAR_COLLAPSE_KEY, next ? '1':'0');
    });

    // Initialize send button disabled state based on input content and generation state; also prepare STOP icon toggle
    try{
      const SEND_ICON_HTML = (els.send?.innerHTML)||'';
      const STOP_ICON_SVG = '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" class="icon"><path d="M4.5 5.75C4.5 5.05964 5.05964 4.5 5.75 4.5H14.25C14.9404 4.5 15.5 5.05964 15.5 5.75V14.25C15.5 14.9404 14.9404 15.5 14.25 15.5H5.75C5.05964 15.5 4.5 14.9404 4.5 14.25V5.75Z"></path></svg>';
      function updateSendDisabled(){ try{ if(!els.send) return; els.send.disabled = (typeof genState !== 'undefined' && genState && genState.mode) ? false : !((els.input?.value || '').trim().length > 0); }catch(e){} }
      function setSendToStop(){ try{ if(!els.send) return; els.send.classList.add('stop-mode'); els.send.setAttribute('aria-label','Stop generation'); els.send.setAttribute('title','Stop'); els.send.innerHTML = STOP_ICON_SVG; els.send.disabled = false; }catch(e){} }
      function setSendToSend(){ try{ if(!els.send) return; els.send.classList.remove('stop-mode'); els.send.setAttribute('aria-label','Send message'); els.send.setAttribute('title','Send'); if(SEND_ICON_HTML) els.send.innerHTML = SEND_ICON_HTML; updateSendDisabled(); }catch(e){} }
      updateSendDisabled();
      els.input?.addEventListener('input', ()=>{ updateSendDisabled(); });
    }catch(e){}
    // State & persistence
    let conversations = [];
    let activeId = null;
    const LS_CONVS = 'bm_conversations';
    const LS_ACTIVE = 'bm_active_conversation_id';
    function loadState(){
      try{ conversations = JSON.parse(safeLocalStorage('get', LS_CONVS)||'[]') || []; }catch(e){ conversations = []; }
      try{ activeId = safeLocalStorage('get', LS_ACTIVE) || null; }catch(e){ activeId = null; }
      if(!Array.isArray(conversations)) conversations = [];
      if(!activeId && conversations.length){ activeId = conversations[0].id; }
      try{
        const completed = (localStorage.getItem('agui_landing_completed') === '1');
        if(!activeId && !conversations.length && completed){
          createConversation('New chat');
        }
      }catch(e){}
      // Always ensure we have at least one conversation available for default form selection.
      ensureNonEmptyConversations();
      if(!activeId && conversations.length){ activeId = conversations[0].id; }
    }
    function saveState(){
      safeLocalStorage('set', LS_CONVS, JSON.stringify(conversations));
      safeLocalStorage('set', LS_ACTIVE, activeId || '');
    }
    // Ensure the conversation list is never empty by creating a placeholder conversation if needed.
    function ensureNonEmptyConversations(){
      try{
        if(!Array.isArray(conversations)) conversations = [];
        if(conversations.length === 0){
          const id = uid();
          let userName = ''; let userEmail = '';
          try{ userName = localStorage.getItem('agui_user_name') || ''; }catch(_){ }
          try{ userEmail = localStorage.getItem('agui_user_email') || ''; }catch(_){ }
          const conv = { id, title: 'New chat', titleAuto: true, history: [], createdAt: Date.now(), updatedAt: Date.now(), user: { name: userName, email: userEmail } };
          conversations.unshift(conv);
          activeId = id;
          saveState();
        }
      }catch(e){}
    }
    function uid(){ return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

    function createConversation(title){
      try{
        const completed = (localStorage.getItem('agui_landing_completed') === '1');
        if(!completed){ showAgentLanding(); return; }
      }catch(e){}
      const id = uid();
      // Attach user profile from localStorage to every new conversation
      let userName = '';
      let userEmail = '';
      try{ userName = localStorage.getItem('agui_user_name') || ''; }catch(_){ }
      try{ userEmail = localStorage.getItem('agui_user_email') || ''; }catch(_){ }
      const conv = { id, title: title || 'New chat', titleAuto: true, history: [], createdAt: Date.now(), updatedAt: Date.now(), user: { name: userName, email: userEmail } };
      conversations.unshift(conv); activeId = id; saveState(); renderConversationList(); renderMessages();

      // Consistent behavior on new conversations: show landing when not completed; otherwise auto-welcome
      try{
        const completed = (localStorage.getItem('agui_landing_completed') === '1');
        if(!completed){
          try{ showAgentLanding(); }catch(e){}
        } else {
          const firstName = (userName || '').split(/\s+/)[0] || userName || '';
          const variant = pickRandom(BRAND_WIZARD_WELCOME_VARIANTS);
          const welcome = firstName ? (`Hey ${firstName}! ${variant}`) : variant;
          addToHistory('assistant', welcome);
        }
      }catch(e){}

      return id;
    }
    function setActive(id){ if(!id) return; activeId = id; saveState(); renderConversationList(); renderMessages(); }
    function getActive(){ return conversations.find(c => c.id === activeId) || null; }

    function renderConversationList(){
      if(!els.list) return;
      els.list.innerHTML = '';
      conversations.forEach(conv => {
        const item = document.createElement('div');
        item.className = 'bm-conversation-item' + (conv.id===activeId?' active':'');
        item.dataset.id = conv.id;
        // Left content: avatar + title
        const left = document.createElement('div');
        left.className = 'bm-conv-left';
        const avatar = document.createElement('img');
        avatar.className = 'bm-avatar';
        avatar.src = pluginAssetUrl('female-2.webp');
        avatar.alt = 'Assistant';
        const title = document.createElement('span');
        title.className = 'bm-conv-title';
        const fullTitle = (conv.title||'Untitled');
        title.textContent = fullTitle.length > 5 ? fullTitle.substring(0, 25) + '...' : fullTitle;
        left.appendChild(avatar);
        left.appendChild(title);
        // Time (hidden by default via CSS, kept for future)
        const time = document.createElement('span');
        time.className = 'bm-conv-time bm-time-ago';
        time.dataset.timestamp = String(conv.updatedAt||conv.createdAt);
        // Right menu button
        const menu = document.createElement('span');
        menu.className = 'icon-btn conv-menu';
        menu.setAttribute('aria-label','Conversation menu');
        menu.title = 'Conversation menu';
        menu.innerHTML = '⋮';
        const dropdown = document.createElement('div');
        dropdown.className = 'conv-dropdown';
        dropdown.innerHTML = '<button class="dropdown-item rename" type="button">Rename</button>\n<button class="dropdown-item delete" type="button">Delete</button>';
        item.appendChild(left);
        item.appendChild(time);
        item.appendChild(menu);
        item.appendChild(dropdown);
        // Click to activate
        item.addEventListener('click', ()=> setActive(conv.id));
        // Menu toggle
        menu.addEventListener('click', (ev)=>{ ev.stopPropagation(); dropdown.classList.toggle('show'); });
        // Dropdown actions
        dropdown.addEventListener('click', (ev)=>{
          ev.stopPropagation();
          if(ev.target.closest('.delete')){ dropdown.classList.remove('show'); deleteConversation(conv.id); return; }
          if(ev.target.closest('.rename')){ dropdown.classList.remove('show'); renameConversation(conv.id); return; }
        });
        els.list.appendChild(item);
      });
      updateAllTimeAgo();
    }

    // Per-conversation dropdown helpers (scoped within bm chat)
    function closeAllConvMenus(exceptItem){
      if(!els.list) return;
      els.list.querySelectorAll('.conv-dropdown.show').forEach(dd=>{
        if(exceptItem && exceptItem.contains(dd)) return;
        dd.classList.remove('show');
      });
    }
    function renameConversation(id){
      const conv = conversations.find(c=>c.id===id); if(!conv) return;
      const item = els.list?.querySelector(`.bm-conversation-item[data-id="${id}"]`);
      const titleEl = item?.querySelector('.bm-conv-title');
      if(!titleEl) return;
      titleEl.setAttribute('contenteditable','true');
      titleEl.classList.add('editing');
      // Focus and select current text
      try{
        titleEl.focus();
        const range = document.createRange();
        range.selectNodeContents(titleEl);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      }catch(e){}
      const finish = (commit)=>{
        titleEl.removeAttribute('contenteditable');
        titleEl.classList.remove('editing');
        if(commit){
          const newTitle = (titleEl.textContent||'').trim() || (conv.title||'New chat');
          if(newTitle !== conv.title){
            conv.title = newTitle;
            conv.titleAuto = false; // lock title to user-defined text
            conv.updatedAt = Date.now();
            saveState();
            renderConversationList();
          }
        } else {
          titleEl.textContent = conv.title || 'New chat';
        }
      };
      const onKey = (ev)=>{
        if(ev.key === 'Enter') { ev.preventDefault(); finish(true); cleanup(); }
        else if(ev.key === 'Escape') { ev.preventDefault(); finish(false); cleanup(); }
      };
      const onBlur = ()=>{ finish(true); cleanup(); };
      function cleanup(){ titleEl.removeEventListener('keydown', onKey); titleEl.removeEventListener('blur', onBlur); }
      titleEl.addEventListener('keydown', onKey);
      titleEl.addEventListener('blur', onBlur);
    }
    function deleteConversation(id){
      const idx = conversations.findIndex(c=>c.id===id); if(idx<0) return;
      // Preserve the most recent conversation and never leave the list empty
      if(conversations.length === 1){
        // Do not delete the last remaining conversation
        const conv = conversations[0];
        activeId = conv.id;
        // Persist and refresh UI to reflect no-op
        saveState();
        renderConversationList();
        renderMessages();
        return;
      }
      // Direct deletion without confirmation
      conversations.splice(idx,1);
      if(conversations.length){
        if(activeId===id){ activeId = conversations[0].id; }
      } else {
        activeId = null;
      }
      // Persist changes and update UI
      saveState();
      renderConversationList();
      renderMessages();
    }
    // Outside click closes menus
    document.addEventListener('click', (ev)=>{
      if(!ev.target.closest('.conv-dropdown') && !ev.target.closest('.conv-menu')){
        closeAllConvMenus();
      }
    });

    function renderMessages(){
      if(!els.messages) return; const conv = getActive(); els.messages.innerHTML = '';
      if(!conv) return;
      // If conversation is empty and landing not completed, show Agent Landing within the chat
      try{
        const completed = (localStorage.getItem('agui_landing_completed') === '1');
        if((conv.history?.length || 0) === 0 && !completed){ showAgentLanding(); return; }
      }catch(e){}
      conv.history.forEach(msg => appendMessageDom(msg));
      scrollToBottom(true);
      try{ updateSuggestionsVisibility(); }catch(e){}
    }

    // Suggestions gating helpers
    function hasUserInitiated(){
      const conv = getActive();
      return !!(conv && Array.isArray(conv.history) && conv.history.some(m=>m.role==='user'));
    }
    function renderQuickSuggestions(){
      if(!els.suggestions) return;
      const qs = [
        'Brainstorm logo directions',
        'Draft a brand tagline',
        'List target audience personas',
        'Outline a launch plan',
        'Generate logo concept',
        'Create moodboard',
        'Suggest color palette',
      ];
      els.suggestions.innerHTML = '';
      qs.forEach(txt => {
        const b = document.createElement('button');
        b.type='button'; b.className='chip'; b.textContent=txt;
        b.addEventListener('click', ()=> {
          // Use existing send() when available; fallback to sendMessage if present
          try{ if(typeof send === 'function'){ send(txt); } else if(typeof sendMessage === 'function'){ sendMessage(txt); } }catch(e){}
          try{
            if(/generate logo concept|create moodboard|suggest color palette/i.test(txt)){
              generateImage(buildImagePrompt(txt));
            }
          }catch(e){}
        });
        els.suggestions.appendChild(b);
      });
    }
    function updateSuggestionsVisibility(){
      if(!els.suggestions) return;
      let canShow = hasUserInitiated();
      try{
        const completed = (localStorage.getItem('agui_landing_completed') === '1');
        const conv = getActive();
        const hasAnyMessage = !!(conv && Array.isArray(conv.history) && conv.history.length > 0);
        const typingVisible = !!(typingEl && typingEl.classList.contains('visible'));
        // Show suggestions during generation or after landing completion with messages
        if(!canShow && (typingVisible || (completed && hasAnyMessage))){ canShow = true; }
      }catch(e){}
      if(canShow){ els.suggestions.style.display='flex'; renderQuickSuggestions(); }
      else { els.suggestions.style.display='none'; els.suggestions.innerHTML=''; }
    }

    function appendMessageDom(msg){
        const roleClass = (msg.role === 'user') ? 'bm-user' : 'bm-assistant';
        const wrap = document.createElement('div');
        wrap.className = 'bm-message-container ' + roleClass;
        // Normalize data-role: treat 'system' as 'assistant' for DOM semantics
        const dataRole = (msg.role === 'user') ? 'user' : 'assistant';
        wrap.dataset.role = dataRole;

        const bubble = document.createElement('div');
        bubble.className = 'bm-message ' + (msg.role === 'user' ? 'bm-user-message' : 'bm-assistant-message');

        // Content span to allow streaming updates without removing children
        const contentEl = document.createElement('div');
        contentEl.className = 'bm-message-content';
        if(msg.role === 'assistant'){
          contentEl.innerHTML = formatListHtml(msg.content || '');
        } else {
          contentEl.textContent = msg.content || '';
        }

        // Copy button (works for both user and assistant)
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'bm-copy-btn';
        copyBtn.setAttribute('aria-label','Copy message');
        copyBtn.title = 'Copy';
        copyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M6.6 11.397c0-2.726 0-4.089.843-4.936c.844-.847 2.201-.847 4.917-.847h2.88c2.715 0 4.073 0 4.916.847c.844.847.844 2.21.844 4.936v4.82c0 2.726 0 4.089-.844 4.936c-.843.847-2.201.847-4.916.847h-2.88c-2.716 0-4.073 0-4.917-.847s-.843-2.21-.843-4.936z"></path><path fill="currentColor" d="M4.172 3.172C3 4.343 3 6.229 3 10v2c0 3.771 0 5.657 1.172 6.828c.617.618 1.433.91 2.62 1.048c-.192-.84-.192-1.996-.192-3.66v-4.819c0-2.726 0-4.089.843-4.936c.844-.847 2.201-.847 4.917-.847h2.88c1.652 0 2.8 0 3.638.19c-.138-1.193-.43-2.012-1.05-2.632C16.657 2 14.771 2 11 2S5.343 2 4.172 3.172" opacity=".5"></path></svg>';
        copyBtn.addEventListener('click', async (e)=>{
          e.stopPropagation();
          const textToCopy = contentEl.textContent || '';
          try{
            await navigator.clipboard.writeText(textToCopy);
            copyBtn.classList.add('copied');
            setTimeout(()=> copyBtn.classList.remove('copied'), 1200);
          }catch(err){
            const ta = document.createElement('textarea');
            ta.value = textToCopy; document.body.appendChild(ta); ta.select();
            try{ document.execCommand('copy'); copyBtn.classList.add('copied'); setTimeout(()=> copyBtn.classList.remove('copied'), 1200); }catch(e2){} finally{ document.body.removeChild(ta); }
          }
        });

        bubble.appendChild(contentEl);
        // Move copy button to meta (adjacent to timestamp)

        const meta = document.createElement('div');
        meta.className = 'bm-message-meta';
        const t = document.createElement('span');
        t.className = 'bm-time-ago';
        t.dataset.timestamp = String(msg.createdAt || Date.now());
        meta.appendChild(t);
        meta.appendChild(copyBtn);

        if(msg.role === 'assistant'){
          const inner = document.createElement('div');
          inner.className = 'bm-assistant-inner';
          const avatarImg = document.createElement('img');
          avatarImg.className = 'bm-assistant-avatar';
          avatarImg.src = pluginAssetUrl('female-2.webp');
          avatarImg.alt = 'Assistant';
          inner.appendChild(bubble);
          // Show meta (copy + timestamp) only AFTER generation completes
          if(!msg.pending){ inner.appendChild(meta); }
          wrap.appendChild(avatarImg);
          wrap.appendChild(inner);
        } else {
          wrap.appendChild(bubble);
          wrap.appendChild(meta);
        }
        els.messages.appendChild(wrap);
        updateTimeAgoEl(t);
      }

    function addToHistory(role, content, opts={}){
      const conv = getActive(); if(!conv) return;
      const item = { role, content, createdAt: Date.now(), ...opts };
      conv.history.push(item); conv.updatedAt = Date.now(); saveState(); appendMessageDom(item);
      // Dynamically update sidebar title using smart summarizer (respects manual renames)
      updateAutoTitle();
      renderConversationList(); return item;
    }

    function updateTitleFromFirstUser(){
      const conv = getActive(); if(!conv) return;
      // Respect manual renames: never modify a user-defined title
      if(conv.titleAuto === false) return;
      const first = conv.history.find(h => h.role==='user');
      if(first && (!conv.title || conv.title==='New chat')){ conv.title = (first.content||'New chat').slice(0,40); saveState(); renderConversationList(); }
    }

    // Update title based on the latest message (first 4 words)
    function updateTitleFromLatestMessage(){
      const conv = getActive(); if(!conv) return;
      // Respect manual renames: never modify a user-defined title
      if(conv.titleAuto === false) return;
      const last = conv.history[conv.history.length-1]; if(!last) return;
      const preview = wordsPreview(last.content||'', 4);
      if(preview){ conv.title = preview; conv.updatedAt = Date.now(); saveState(); renderConversationList(); }
    }

    // Smart auto-title generator that produces concise, recognizable identifiers
    function generateSmartTitle(conv){
      try{
        const maxWords = 6;
        const stop = new Set(['the','a','an','and','or','but','if','then','so','to','for','of','on','in','with','at','by','from','about','into','over','after','before','between','out','against','during','without','within','along','across','behind','beyond','near','up','down','off','over','under','again','further','once','here','there','when','where','why','how','all','any','both','each','few','more','most','other','some','such','no','nor','not','only','own','same','than','too','very']);
        const clean = (text)=> String(text||'').replace(/<[^>]*>/g,' ').replace(/[\[\]\(\)\.,;:!\?"'`]/g,' ').toLowerCase().split(/\s+/).filter(w=>w && !stop.has(w));
        const pickUser = ()=>{ const users = (conv.history||[]).filter(m=>m.role==='user'); return users[users.length-1]?.content || users[0]?.content || ''; };
        let source = pickUser();
        if(/generate logo concept/i.test(source)) return 'Logo concepts';
        if(/moodboard/i.test(source)) return 'Moodboard ideas';
        if(/color palette/i.test(source)) return 'Color palette';
        let words = clean(source);
        if(words.length === 0){ const firstAssistant = (conv.history||[]).find(m=>m.role==='assistant'); words = clean(firstAssistant?.content || ''); }
        const title = (words.length ? words.slice(0, maxWords).map(w=> w.charAt(0).toUpperCase()+w.slice(1)).join(' ') : (conv.title||'New chat'));
        return String(title||'New chat').slice(0, 40);
      }catch(e){ return (conv?.title||'New chat'); }
    }
    function updateAutoTitle(){
      const conv = getActive(); if(!conv) return;
      if(conv.titleAuto === false) return; // respect manual rename
      const t = generateSmartTitle(conv);
      if(t && t !== conv.title){ conv.title = t; conv.updatedAt = Date.now(); saveState(); renderConversationList(); }
    }

    // Time-ago utilities
    function timeAgo(ts){
      const now = Date.now(); const diffMs = now - Number(ts||now);
      const min = 60*1000, hr = 60*min, day = 24*hr;
      if(diffMs < 30*1000) return 'just now';
      if(diffMs < 60*1000) return '1 min ago';
      if(diffMs < hr) return `${Math.floor(diffMs/min)} min ago`;
      if(diffMs < day) return `${Math.floor(diffMs/hr)} h ago`;
      return `${Math.floor(diffMs/day)} d ago`;
    }
    function updateTimeAgoEl(el){ try{ el.textContent = timeAgo(el.dataset.timestamp); }catch(e){} }
    function updateAllTimeAgo(){ document.querySelectorAll('.bm-time-ago').forEach(updateTimeAgoEl); }
    setInterval(updateAllTimeAgo, 60*1000);

    // Auto-scroll
    function isNearBottom(){
      const m = els.messages; if(!m) return true;
      return (m.scrollTop + m.clientHeight) >= (m.scrollHeight - 140);
    }
    function scrollToBottom(force){ if(force || isNearBottom()){ try{ els.messages.scrollTop = els.messages.scrollHeight; }catch(e){} } }

    // Error handling
    function showError(msg){ if(!els.error) return; els.error.textContent = msg||'Something went wrong.'; els.error.style.display='block'; }
    function clearError(){ if(!els.error) return; els.error.textContent=''; els.error.style.display='none'; }

    // Typing indicator + Stop generation
    let typingEl = null;
    const TYPING_SNIPPETS = [
      'Thinking', 'Analyzing context', 'Drafting ideas', 'Composing response', 'Refining answer', 'Planning reply'
    ];
    let typingIntervalId = null;
    function ensureTypingIndicator(){
      if(typingEl) return typingEl;
      typingEl = document.createElement('div');
      typingEl.className = 'bm-typing-indicator';
      typingEl.setAttribute('aria-live','polite');
      // Remove inline stop button; main send button now acts as STOP during generation
      typingEl.innerHTML = '<span id="bm-typing-text" class="bm-typing-text">Thinking</span> <span class="bm-typing-dots"><span></span><span></span><span></span></span>';
      return typingEl;
    }
    function showTyping(){
      try{
        const m=els.messages; if(!m) return; const el=ensureTypingIndicator();
        if(!m.contains(el)){ m.appendChild(el);} el.classList.add('visible');
        // Start rotating snippets
        try{
          const textEl = el.querySelector('#bm-typing-text');
          if(typingIntervalId) clearInterval(typingIntervalId);
          let idx = 0;
          typingIntervalId = setInterval(()=>{ idx = (idx+1) % TYPING_SNIPPETS.length; if(textEl) textEl.textContent = TYPING_SNIPPETS[idx]; }, 900);
        }catch(e){}
        // Toggle main send button into STOP mode
        try{ setSendToStop(); }catch(e){}
        scrollToBottom(false);
      }catch(e){}
    }
    function hideTyping(){
      try{
        if(typingIntervalId){ try{ clearInterval(typingIntervalId); }catch(e){} typingIntervalId = null; }
        const m=els.messages; const el=typingEl; if(el){ el.classList.remove('visible'); }
        if(m&&el&&m.contains(el)){ m.removeChild(el);} 
        try{ setSendToSend(); }catch(e){}
      }catch(e){}
    }

    // Stop generation state
    let genState = { mode: null, abortController: null, transient: null, stopped: false };
    function stopGeneration(){
      try{
        genState.stopped = true;
        if(genState.mode === 'sse' && genState.abortController){ try{ genState.abortController.abort(); }catch(e){} }
        if(genState.mode === 'ws'){ try{ ws?.send?.(JSON.stringify({ id: clientId, stop: true })); }catch(e){} }
        if(genState.transient){
          finalizeAssistant(genState.transient, genState.transient.content || '');
          // Immediately reflect abort inside the assistant bubble content
          try{ showAbortNoticeInAssistant(); }catch(e){}
          // Remove meta (copy + time-ago) and any <br> tags immediately
          try{ cleanupAbortMetaAndBr(); }catch(e){}
        }
        hideTyping();
      }catch(e){}
    }

    // Streaming via SSE POST
    async function streamAssistantSSE(userText){
      if(!cfg.sseUrl){ return await fallbackSend(userText); }
      clearError();
      showTyping();
      const transient = addToHistory('assistant', '', { pending:true, createdAtStreaming: Date.now() });
      // Track generation and allow stopping via AbortController
      genState = { mode: 'sse', abortController: new AbortController(), transient, stopped: false };
      let buffer = '';
      try{
        const res = await fetch(cfg.sseUrl, {
          method:'POST',
          headers:{
            'Content-Type':'application/json',
            'Accept':'text/event-stream',
            'ngrok-skip-browser-warning':'true'
          },
          body: JSON.stringify({ messages: [ { role:'user', content: userText } ] }),
          signal: genState.abortController.signal
        });
        if(!res.ok || !res.body){
          showError('Streaming unavailable, using fallback.');
          return await fallbackSend(userText, transient);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let done = false; let carry = '';
        while(!done){
          const { value, done: rdDone } = await reader.read();
          done = rdDone;
          const chunkText = decoder.decode(value || new Uint8Array(), { stream: !done });
          carry += chunkText;
          // Split by double newlines into SSE events
          const parts = carry.split(/\n\n/);
          carry = parts.pop() || '';
          for(const part of parts){
            const lines = part.split(/\n/);
            for(const line of lines){
              const m = line.match(/^data:\s*(.*)$/);
              if(!m) continue;
              const payload = m[1];
              let evt = null;
              try{ evt = JSON.parse(payload); }catch(e){ continue; }
              if(evt?.type==='error'){ showError(String(evt.message||'Stream error')); done=true; break; }
              if(evt?.chunk){ transient.content += String(evt.chunk); updateLastAssistantDom(transient); scrollToBottom(false); }
              if(evt?.done){ done = true; break; }
            }
            if(done) break;
          }
        }
        // finalize
        transient.pending = false; transient.createdAt = transient.createdAtStreaming || Date.now(); saveState(); reRenderLastAssistant(transient);
        // Ensure meta is appended immediately upon completion (SSE)
        try{ ensureAssistantMetaExists(transient.createdAt); }catch(e){}
        hideTyping(); genState = { mode:null, abortController:null, transient:null, stopped:false };
        updateAllTimeAgo(); scrollToBottom(true);
      }catch(err){
        // Handle user abort gracefully
        if(err && (err.name === 'AbortError' || err.message === 'The operation was aborted.')){
          finalizeAssistant(transient, transient.content || '');
          // Show immediate abort notice inside the assistant bubble
          try{ showAbortNoticeInAssistant(); }catch(e){}
          // Remove meta (copy + time-ago) and any <br> tags immediately
          try{ cleanupAbortMetaAndBr(); }catch(e){}
          genState = { mode:null, abortController:null, transient:null, stopped:false };
          return;
        }
        showError('Streaming failed, using fallback.');
        genState = { mode:null, abortController:null, transient:null, stopped:false };
        return await fallbackSend(userText, transient);
      }
    }

    function updateLastAssistantDom(msg){
      // Update the last assistant bubble's text
      try{
        const containers = els.messages.querySelectorAll('.bm-message-container');
        const last = containers[containers.length-1];
        const bubble = last?.querySelector('.bm-message');
        if(bubble){
          const contentEl = bubble.querySelector('.bm-message-content');
          if(contentEl){ contentEl.innerHTML = formatListHtml(msg.content || ''); }
          else { bubble.innerHTML = formatListHtml(msg.content || ''); }
          // Update title live as streaming content changes
          updateTitleFromLatestMessage();
        }
      }catch(e){}
    }
    function reRenderLastAssistant(msg){
      try{
        const containers = els.messages.querySelectorAll('.bm-message-container');
        const last = containers[containers.length-1]; if(!last) return;
        const bubble = last.querySelector('.bm-message'); const meta = last.querySelector('.bm-time-ago');
        const contentEl = bubble?.querySelector('.bm-message-content');
        if(contentEl){ contentEl.innerHTML = formatListHtml(msg.content || ''); }
        else if(bubble){ bubble.innerHTML = formatListHtml(msg.content || ''); }
        if(meta){ meta.dataset.timestamp = String(msg.createdAtStreaming || msg.createdAt); updateTimeAgoEl(meta); }
        // Update title during/after streaming to reflect latest assistant content
        updateTitleFromLatestMessage();
      }catch(e){}
    }

    // Show a prominent abort notice inside the last assistant message content
    function showAbortNoticeInAssistant(){
      try{
        const containers = els.messages.querySelectorAll('.bm-message-container[data-role="assistant"]');
        const last = containers[containers.length-1]; if(!last) return;
        const bubble = last.querySelector('.bm-message');
        const contentEl = bubble?.querySelector('.bm-message-content');
        if(!contentEl) return;
        // Avoid duplicates
        if(contentEl.querySelector('.bm-abort-notice')) return;
        const notice = document.createElement('div');
        notice.className = 'bm-abort-notice';
        notice.setAttribute('role','status');
        notice.textContent = 'AI generation aborted';
        // Inline styles for immediate prominent visibility without requiring CSS edits
        notice.style.display = 'inline-block';
        notice.style.marginTop = '8px';
        notice.style.padding = '6px 8px';
        notice.style.borderRadius = '4px';
        notice.style.background = '#fee2e2'; // light red background
        notice.style.color = '#b91c1c'; // red text
        notice.style.fontWeight = '600';
        contentEl.appendChild(notice);
      }catch(e){}
    }

    // Helper: build a copy button bound to a specific content element
    function buildCopyBtn(contentEl){
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'bm-copy-btn';
      copyBtn.setAttribute('aria-label','Copy message');
      copyBtn.title = 'Copy';
      copyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M6.6 11.397c0-2.726 0-4.089.843-4.936c.844-.847 2.201-.847 4.917-.847h2.88c2.715 0 4.073 0 4.916.847c.844.847.844 2.21.844 4.936v4.82c0 2.726 0 4.089-.844 4.936c-.843.847-2.201.847-4.916.847h-2.88c-2.716 0-4.073 0-4.917-.847s-.843-2.21-.843-4.936z"></path><path fill="currentColor" d="M4.172 3.172C3 4.343 3 6.229 3 10v2c0 3.771 0 5.657 1.172 6.828c.617.618 1.433.91 2.62 1.048c-.192-.84-.192-1.996-.192-3.66v-4.819c0-2.726 0-4.089.843-4.936c.844-.847 2.201-.847 4.917-.847h2.88c1.652 0 2.8 0 3.638.19c-.138-1.193-.43-2.012-1.05-2.632C16.657 2 14.771 2 11 2S5.343 2 4.172 3.172" opacity=".5"></path></svg>';
      copyBtn.addEventListener('click', async (e)=>{
        e.stopPropagation();
        const textToCopy = contentEl?.textContent || '';
        try{
          await navigator.clipboard.writeText(textToCopy);
          copyBtn.classList.add('copied');
          setTimeout(()=> copyBtn.classList.remove('copied'), 1200);
        }catch(err){
          const ta = document.createElement('textarea');
          ta.value = textToCopy; document.body.appendChild(ta); ta.select();
          try{ document.execCommand('copy'); copyBtn.classList.add('copied'); setTimeout(()=> copyBtn.classList.remove('copied'), 1200); }catch(e2){} finally{ document.body.removeChild(ta); }
        }
      });
      return copyBtn;
    }

    // Ensure bm-message-meta exists for the last assistant message (only after generation completes)
    function ensureAssistantMetaExists(timestamp){
      try{
        const containers = els.messages.querySelectorAll('.bm-message-container[data-role="assistant"]');
        const last = containers[containers.length-1]; if(!last) return;
        let meta = last.querySelector('.bm-message-meta');
        if(meta) return; // already exists
        const bubble = last.querySelector('.bm-message');
        const contentEl = bubble?.querySelector('.bm-message-content') || bubble;
        meta = document.createElement('div');
        meta.className = 'bm-message-meta';
        const t = document.createElement('span');
        t.className = 'bm-time-ago';
        t.dataset.timestamp = String(timestamp || Date.now());
        meta.appendChild(t);
        meta.appendChild(buildCopyBtn(contentEl));
        const inner = last.querySelector('.bm-assistant-inner') || last;
        inner.appendChild(meta);
        updateTimeAgoEl(t);
      }catch(e){}
    }

    // Cleanup meta (copy + time-ago) from the last assistant message and remove any <br> tags
    function cleanupAbortMetaAndBr(){
      try{
        const containers = els.messages.querySelectorAll('.bm-message-container[data-role="assistant"]');
        const last = containers[containers.length-1]; if(!last) return;
        const meta = last.querySelector('.bm-message-meta');
        if(meta){ try{ meta.remove(); }catch(e){} }
        const bubble = last.querySelector('.bm-message');
        const contentEl = bubble?.querySelector('.bm-message-content') || bubble;
        if(contentEl){
          try{ contentEl.querySelectorAll('br').forEach(br=> br.remove()); }catch(e){}
        }
      }catch(e){}
    }

    // Fallback (non-streamed): Send URL or Fallback URL
    async function fallbackSend(userText, transientAssistant){
      try{
        if(cfg.sendUrl){
          const r = await fetch(cfg.sendUrl, {
            method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json','ngrok-skip-browser-warning':'true'},
            body: JSON.stringify({ messages: [ { role:'user', content: userText } ] })
          });
          if(r.ok){ 
            const raw = await r.text();
            let reply = raw;
            try{ const j = JSON.parse(raw); reply = j?.response || j?.answer || j?.message || j?.text || raw; }catch(e){}
            finalizeAssistant(transientAssistant, reply); 
             return; 
           }
         }
         if(cfg.fallbackUrl){
           const r2 = await fetch(cfg.fallbackUrl, {
             method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json','ngrok-skip-browser-warning':'true'},
             body: JSON.stringify({ prompt: userText })
           });
           const j = await r2.json().catch(()=>({}));
           const reply = j?.response || j?.answer || j?.message || j?.text || '';
           finalizeAssistant(transientAssistant, reply || '');
         }
       }catch(e){ finalizeAssistant(transientAssistant, ''); }
     }
     function finalizeAssistant(transientAssistant, content){
       if(transientAssistant){ transientAssistant.content = content || (transientAssistant.content||''); transientAssistant.pending=false; transientAssistant.createdAt = transientAssistant.createdAtStreaming || Date.now(); saveState(); reRenderLastAssistant(transientAssistant); }
       // Ensure meta is visible now that generation has completed
       try{ ensureAssistantMetaExists((transientAssistant?.createdAt)||Date.now()); }catch(e){}
       hideTyping();
       scrollToBottom(true); updateAllTimeAgo();
     }
 
     // Optional WebSocket (non-SSE) support
     let ws = null; let clientId = uid();
     // Close and reset WS on settings update so next ensureWs uses fresh endpoint
     try{ window.addEventListener('agui:settings-updated', ()=>{ try{ ws?.close?.(); }catch(e){} ws=null; }); }catch(e){}
     function ensureWs(){
       if(ws || !cfg.wsUrl) return;
       try{ ws = new WebSocket(cfg.wsUrl); }catch(e){ ws=null; }
       if(!ws) return;
       ws.onopen = ()=>{};
       ws.onmessage = (ev)=>{
         try{
           const data = JSON.parse(ev.data||'{}');
           if(typeof data.response === 'string'){
             showTyping();
             const transient = addToHistory('assistant', '', { pending:true, createdAtStreaming: Date.now() });
             // Track WS generation so user can stop
             genState = { mode: 'ws', abortController: null, transient, stopped: false };
             // If user pressed stop, ignore further chunks
              if(genState.stopped){ finalizeAssistant(transient, transient.content || ''); try{ showAbortNoticeInAssistant(); }catch(e){} try{ cleanupAbortMetaAndBr(); }catch(e){} return; }
              transient.content += data.response; updateLastAssistantDom(transient);
              if(data.done){ finalizeAssistant(transient, transient.content); genState = { mode:null, abortController:null, transient:null, stopped:false }; }
           }
         }catch(e){}
       };
       ws.onerror = ()=>{};
       ws.onclose = ()=>{ ws=null; };
     }
 
     // Send handler
     async function send(text, attachments){
       clearError(); const msg = (text||'').trim(); if(!msg) return;
       addToHistory('user', msg, { createdAt: Date.now(), attachments: attachments||[] });
       // Update title immediately based on the latest message (first 4 words)
       updateTitleFromLatestMessage();
       // Enable Copilot Kit suggestions only after user initiates
       try{ updateSuggestionsVisibility(); }catch(e){}
       // Prefer SSE unless WS is explicitly preferred
      if(cfg.preferWebSocket){ ensureWs(); try{ showTyping(); ws?.send?.(JSON.stringify({ id: clientId, message: msg })); return; }catch(e){} }
       await streamAssistantSSE(msg);
       genState = { mode:null, abortController:null, transient:null, stopped:false };
     }

     // Sidebar dots menu events
     try{
       els.sidebarMenuBtn?.addEventListener('click', ()=>{
         if(!els.sidebarMenu) return;
         const open = els.sidebarMenu.classList.contains('open');
         els.sidebarMenu.classList.toggle('open', !open);
         els.sidebarMenu.setAttribute('aria-hidden', open ? 'true' : 'false');
       });
       document.addEventListener('click', (e)=>{
         if(!els.sidebarMenu) return;
         const within = e.target === els.sidebarMenu || els.sidebarMenu.contains(e.target) || e.target === els.sidebarMenuBtn || els.sidebarMenuBtn?.contains(e.target);
         if(!within){ els.sidebarMenu.classList.remove('open'); els.sidebarMenu.setAttribute('aria-hidden','true'); }
       });
       els.menuRename?.addEventListener('click', ()=>{
         const conv = getActive();
         if(!conv){ return; }
         // Inline rename without prompt
         renameConversation(conv.id);
         els.sidebarMenu?.classList.remove('open');
         els.sidebarMenu?.setAttribute('aria-hidden','true');
       });
       els.menuRemove?.addEventListener('click', ()=>{
         const conv = getActive();
         if(!conv){ return; }
         // Direct deletion without confirmation
         conversations = conversations.filter(c => c.id !== conv.id);
         if(conversations.length){ activeId = conversations[0].id; } else { activeId = null; }
         // Do not auto-create here
         saveState();
         renderConversationList();
         renderMessages();
         els.sidebarMenu?.classList.remove('open');
         els.sidebarMenu?.setAttribute('aria-hidden','true');
       });
     }catch(e){ /* no-op */ }
     els.send?.addEventListener('click', async ()=>{
       // If generating, clicking acts as STOP
       if(typeof genState !== 'undefined' && genState && genState.mode){ try{ stopGeneration(); }catch(e){} return; }
       const val = els.input?.value || ''; els.input && (els.input.value=''); const files = await collectBmAttachments(); await send(val, files);
       els.input?.focus();
       // Update disabled state after clearing input
       try{ updateSendDisabled(); }catch(e){}
     });
     els.input?.addEventListener('keydown', async (e)=>{
       if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); const val = els.input?.value || ''; els.input && (els.input.value=''); const files = await collectBmAttachments(); await send(val, files); els.input?.focus(); }
     });
     els.attachBtn?.addEventListener('click', ()=> els.fileInput?.click());
     els.fileInput?.addEventListener('change', ()=>{});

     // Voice input via Web Speech API (frontend parity)
     try{
       const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
       if(SpeechRecognition && els.voiceBtn){
         let recognition = new SpeechRecognition();
         recognition.lang = navigator.language || 'en-US';
         recognition.continuous = false;
         recognition.interimResults = true;
         let voiceAccumulated = '';
         let baseInputBeforeVoice = '';
         recognition.onresult = (event)=>{
           const result = event.results[event.results.length - 1];
           if(!result) return;
           const transcript = result[0]?.transcript || '';
           voiceAccumulated += (voiceAccumulated ? ' ' : '') + transcript.trim();
           if(els.input){ els.input.value = (baseInputBeforeVoice ? (baseInputBeforeVoice + ' ') : '') + voiceAccumulated; }
           updateSendDisabled();
         };
         recognition.onend = ()=>{
           els.voiceBtn?.classList.remove('recording');
           baseInputBeforeVoice = '';
           voiceAccumulated = '';
         };
         recognition.onerror = ()=>{
           els.voiceBtn?.classList.remove('recording');
           baseInputBeforeVoice = '';
           voiceAccumulated = '';
         };
         els.voiceBtn.addEventListener('click', ()=>{
           try{
             baseInputBeforeVoice = (els.input?.value || '').trim();
             voiceAccumulated = '';
             els.voiceBtn.classList.add('recording');
             recognition.start();
           }catch(err){
             els.voiceBtn.classList.remove('recording');
             baseInputBeforeVoice = '';
             voiceAccumulated = '';
           }
         });
       } else {
         els.voiceBtn?.addEventListener('click', ()=>{
           addToHistory('assistant', 'Voice input is not supported in this browser.');
         });
       }
     }catch(e){}

     els.newChat?.addEventListener('click', ()=>{
       try{
         const completed = (localStorage.getItem('agui_landing_completed') === '1');
         if(!completed){ showAgentLanding(); return; }
       }catch(e){}
       createConversation('New chat');
     });

     // Conversation Management Functions
     // New chat: use local conversation model
     function createNewConversation(){
       createConversation('New chat');
     }
     // switchConversation removed (obsolete state-based version)

     // reverted: removed updateConversationTitle helper

     // reverted: removed getTimeAgo helper

     // reverted: removed generateAvatarSvg helper

     // reverted: removed renderConversationList override to restore original behavior

     // reverted: removed addToHistory override

     async function collectBmAttachments(){
       const files = Array.from(els.fileInput?.files||[]);
       const readers = files.map(file => new Promise(resolve => {
         const fr = new FileReader(); fr.onload = ()=> resolve({ name:file.name, type:file.type, size:file.size, url: fr.result }); fr.onerror = ()=> resolve({ name:file.name, type:file.type, size:file.size }); fr.readAsDataURL(file);
       }));
       return Promise.all(readers);
     }

     // initializeConversations removed to revert new changes

     // Agent Landing Component
     function showAgentLanding(){
       try{
         // Do not show if user already completed the form once
         try{ if(localStorage.getItem('agui_landing_completed') === '1'){ return; } }catch(_){}
         const messages = document.getElementById('bm-chat-messages') || (els && els.messages);
         if(!messages) return;
         if(document.getElementById('agent-landing')) return;
         const composerEl = document.querySelector('.bm-composer') || null;
         // Hide composer while landing is visible
         try{ if(composerEl){ composerEl.style.display = 'none'; } }catch(_){}
         const card = document.createElement('div');
         card.id = 'agent-landing';
         card.className = 'agent-landing';
         const inner = document.createElement('div'); inner.className = 'agent-landing-inner';
         const avatar = document.createElement('div'); avatar.className = 'agent-landing-avatar';
         const h1 = document.createElement('h2'); h1.className = 'agent-landing-title'; h1.textContent = 'WizardDesigner';
         const h2 = document.createElement('p'); h2.className = 'agent-landing-subtitle'; h2.textContent = 'Guides users from brand name to mockup and booking.';
         const cta = document.createElement('button'); cta.className = 'btn btn-primary agent-landing-cta'; cta.textContent = 'I want to build my brand';
         const formWrap = document.createElement('div'); formWrap.className = 'agent-landing-form hidden';
         formWrap.innerHTML = `
           <form id="agent-landing-form" class="landing-form">
             <div class="form-row">
               <label for="landing-name">Name</label>
               <input id="landing-name" name="name" type="text" placeholder="Your name" required />
             </div>
             <div class="form-row">
               <label for="landing-email">Email</label>
               <input id="landing-email" name="email" type="email" placeholder="you@example.com" required />
             </div>
             <button type="submit" class="btn btn-primary">Continue</button>
             <div class="form-status" id="landing-status" aria-live="polite"></div>
           </form>
         `;
         inner.appendChild(avatar);
         inner.appendChild(h1);
         inner.appendChild(h2);
         inner.appendChild(cta);
         inner.appendChild(formWrap);
         card.appendChild(inner);
         messages.innerHTML = '';
         messages.appendChild(card);
         cta.addEventListener('click', () => { formWrap.classList.remove('hidden'); cta.classList.add('hidden'); });
         const formEl = formWrap.querySelector('#agent-landing-form');
         formEl.addEventListener('submit', async (e) => {
           e.preventDefault();
           const name = formEl.querySelector('#landing-name').value.trim();
           const email = formEl.querySelector('#landing-email').value.trim();
           const statusEl = formEl.querySelector('#landing-status');
           statusEl.textContent = 'Saving...'; statusEl.className = 'form-status saving';
           let savedRemotely = false;
           try{
             const body = { name, email };
             const endpoint = (cfg.wpFormEndpoint||'/wp-json/agui-chat/v1/ghl/contact');
             const resp = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning':'true' }, body: JSON.stringify(body) });
             let j = null;
             if(resp.ok){ 
               try{ 
                 const text = await resp.text();
                 console.log('🏠 Agent Landing response:', text);
                 j = JSON.parse(text);
                 console.log('🏠 Agent Landing parsed:', j);
               }catch(_){
                 console.log('🏠 Agent Landing parse failed');
               } 
               savedRemotely = true; 
             } else { 
               throw new Error('Sync failed'); 
             }
             const cid = extractContactId(j);
             console.log('🏠 Agent Landing contactId:', cid);
             if(cid){ 
               try{ 
                 localStorage.setItem('agui_contact_id', cid); 
                 console.log('🏠 Agent Landing stored contactId:', cid);
               }catch(_){
                 console.log('🏠 Agent Landing storage failed');
               } 
             } else {
               // Generate a fallback ID for agent landing too
               const fallbackId = 'agent_' + Date.now();
               localStorage.setItem('agui_contact_id', fallbackId);
               console.log('🏠 Agent Landing fallback contactId:', fallbackId);
             }
           }catch(err){ savedRemotely = false; }
           // Always persist locally and continue
           try {
             localStorage.setItem('agui_user_name', name);
             localStorage.setItem('agui_user_email', email);
             localStorage.setItem('agui_landing_completed', '1');
           } catch(_){}
           // Update status for the user
            if(savedRemotely){
              statusEl.textContent = 'Saved!'; statusEl.className = 'form-status ok';
            } else {
              statusEl.textContent = 'Saved locally. You can start chatting.'; statusEl.className = 'form-status ok';
            }
            // Ensure a conversation exists and attach user profile
            try{
              let conv = getActive();
              if(!conv){ createConversation('New chat'); conv = getActive(); }
              if(conv){
                let _c = '';
                try{ _c = localStorage.getItem('agui_contact_id') || ''; }catch(_){}
                conv.user = { name, email, contactId: _c };
                saveState();
              }
            }catch(_){}
            // Add personalized assistant welcome message in the first chat
            try{
              const welcome = buildWelcomeMessage(name, email);
              addToHistory('assistant', welcome);
              // Show suggestions immediately after landing completion
              try{ updateSuggestionsVisibility(); }catch(e){}
            }catch(_){}
            // Close landing and show composer
            try{ if(card){ card.remove(); } }catch(_){}
            try{ if(composerEl){ composerEl.style.display = ''; } }catch(_){}
            // Focus the input once composer is visible
            try{ const inp = document.getElementById('bm-user-input'); if(inp){ inp.focus(); } }catch(_){}
          });
         // Ensure landing is removed if user tries to send (defensive)
         try{
           const sendBtn = document.getElementById('bm-send-btn');
           const userInput = document.getElementById('bm-user-input');
           const hideLandingNow = () => { const el = document.getElementById('agent-landing'); if(el){ el.remove(); } try{ if(composerEl){ composerEl.style.display = ''; } }catch(_){} };
           if(sendBtn){ sendBtn.addEventListener('click', hideLandingNow, { once: true }); }
           if(userInput){ userInput.addEventListener('keydown', (ev)=>{ if(ev.key==='Enter'){ hideLandingNow(); } }); }
         }catch(e){}
       }catch(e){}
     }
     function initLandingHooks(){
       try{
         const newChatBtn = document.getElementById('bm-new-chat-btn') || els.newChat;
         if(newChatBtn){ newChatBtn.addEventListener('click', ()=>{ setTimeout(()=>{
           try{ if(localStorage.getItem('agui_landing_completed') === '1'){ return; } }catch(_){}
           showAgentLanding();
         }, 0); }); }
         const messages = document.getElementById('bm-chat-messages') || (els && els.messages);
         // Show landing only if conversation is empty AND user hasn't completed the form yet
         let alreadyCompleted = false; try{ alreadyCompleted = localStorage.getItem('agui_landing_completed') === '1'; }catch(_){}
         if(messages && messages.children.length === 0 && !alreadyCompleted){ showAgentLanding(); }
       }catch(e){}
     }

     // Init
     loadState(); 
     renderConversationList(); 
     renderMessages();
     initLandingHooks();
   })();

// ===== BM Multi‑Step Form (bm_ms_form) =====
(function(){
  function q(sel,root){ try{ return (root||document).querySelector(sel); }catch(e){ return null; } }
  function qa(sel,root){ try{ return Array.from((root||document).querySelectorAll(sel)); }catch(e){ return []; } }
  function showInlineError(scopeEl, message){
    try{
      const host = scopeEl.querySelector('.bmms-actions') || scopeEl;
      let msgEl = host.querySelector('.bmms-error');
      if(!msgEl){ msgEl = document.createElement('div'); msgEl.className='bmms-error'; host.insertBefore(msgEl, host.firstChild); }
      msgEl.textContent = message;
      msgEl.style.display='block';
      setTimeout(()=>{ msgEl.style.display='none'; }, 3000);
    }catch(e){}
  }
  const root = q('#bm-ms-form'); if(!root) return;
  const steps = {
    s1: q('#bmms-step1', root),
    s2: q('#bmms-step2', root),
    s3: q('#bmms-step3', root),
    s4: q('#bmms-step4', root),
    s5: q('#bmms-step5', root)
  };
  function showStep(s, fromBack = false){ 
    Object.values(steps).forEach(el=>{ if(el){ el.classList.remove('active'); el.style.display='none'; } }); 
    if(s && steps[s]){ 
      steps[s].style.display=''; 
      steps[s].classList.add('active'); 
      // Ensure all fields are visible when showing Step 1 (including on Back)
      if(s === 's1'){
        const form = steps[s];
         const allFields = qa('.bmms-field, .bmms-optional', form);
         allFields.forEach(el=>{ el.style.display='block'; });
         const bmmsFields = qa('.bmms-fields', form);
         bmmsFields.forEach(el=>{ el.style.display='block'; });
      }
    } 
  }
  const state = { name:'', email:'', description:'', icon:'gauge', brand_text:'', slides:[], selected:null };
  
  // Close button hides the overlay
  /* bmms-close removed per request */

  // Step 1 submit
  const form1 = steps.s1; if(form1){
    form1.addEventListener('submit', function(ev){ ev.preventDefault();
      state.name = q('input[name="name"]', form1)?.value?.trim()||'';
      state.email = q('input[name="email"]', form1)?.value?.trim()||'';
      // description is required
      const descInput = q('input[name="description"], textarea[name="description"]', form1);
      state.description = descInput?.value?.trim()||'';
      if(!state.description){
        showInlineError(form1, 'Please describe your business to continue.');
        if(descInput){ descInput.focus(); }
        return;
      }
      showStep('s2');
      setTimeout(()=>{ const sp=q('.bmms-splash', steps.s2); if(sp) sp.style.display='none'; const ops=q('.bmms-options', steps.s2); if(ops){ ops.style.display=''; ops.classList.add('show'); } }, 900);
    });
  }

  // Step 2
  const s2 = steps.s2; if(s2){
    // Render logo ideas as selectable thumbnails
    const logoIdeaFiles = [
      'logoideas_01.jpg','logoideas_02.jpg','logoideas_04.jpg','logoideas_05.jpg','logoideas_06.png','logoideas_07.jpg','logoideas_09.jpg','logoideas_10.png','logoideas_11.png','logoideas_12.png','logoideas_13.png','logoideas_14.png','logoideas_16.png','logoideas_17.png','logoideas_18.png'
    ];
    function renderLogoIdeasOptions(){
      const grid = q('.bmms-icon-grid', s2);
      if(!grid) return;
      // Append ideas below existing icon controls
      const ideasWrap = document.createElement('div');
      ideasWrap.className = 'bmms-ideas';
      const ideasHeader = document.createElement('h4');
      ideasHeader.style.margin = '8px 0';
      ideasHeader.textContent = 'Choose a logo concept to base your variations on';
      grid.parentElement?.appendChild(ideasHeader);
      grid.parentElement?.appendChild(ideasWrap);
      logoIdeaFiles.forEach((file, idx)=>{
        const url = pluginAssetUrl(`logo-ideas/${file}`);
        const label = document.createElement('label');
        label.className = 'bmms-idea-card';
        label.innerHTML = `
          <input type="radio" name="bmms_logoidea" value="${url}" ${idx===0 ? 'checked' : ''} />
          <img src="${url}" alt="Concept ${idx+1}" />
        `;
        ideasWrap.appendChild(label);
      });
      // Preload to surface any broken links early
      setTimeout(()=>{
        logoIdeaFiles.forEach((file)=>{
          const url = pluginAssetUrl(`logo-ideas/${file}`);
          const img = new Image();
          img.onload = ()=>{};
          img.onerror = ()=>{ console.warn('Missing logo idea asset:', url); };
          img.src = url;
        });
      }, 0);
    }
    renderLogoIdeasOptions();

    s2.addEventListener('click', function(e){
      const t = e.target;
      if(t.closest('.bmms-back')){ showStep('s1', true); return; }
      if(t.closest('.bmms-next')){
        // Capture selected icon choice (if present)
        const checkedIcon = q('input[name="bmms_icon"]:checked', s2);
        state.icon = checkedIcon?.value || state.icon || 'modern';
        const checked = q('input[name="bmms_logoidea"]:checked', s2);
        if(!checked){
          showInlineError(s2, 'Please select a logo idea to continue.');
          return;
        }
        // Ensure absolute URL for image foundation
        let val = checked.value || '';
        try {
          if (!/^https?:\/\//i.test(val)) {
            val = new URL(val, window.location.origin).href;
          }
        } catch(e) {}
        state.selectedIdea = val;
        showStep('s3');
        setTimeout(()=>{ const sp=q('.bmms-splash', steps.s3); if(sp) sp.style.display='none'; const fld=q('.bmms-fields', steps.s3); if(fld) fld.style.display=''; }, 900);
      }
    });
  }

  // Step 3
  const s3 = steps.s3; if(s3){
    s3.addEventListener('click', function(e){
      const t = e.target;
      if(t.closest('.bmms-back')){ showStep('s2'); return; }
      if(t.closest('.bmms-skip')){ state.brand_text=''; showStep('s4'); buildVariations(); return; }
      if(t.closest('.bmms-next')){ state.brand_text = q('input[name="brand_text"]', s3)?.value?.trim()||''; showStep('s4'); buildVariations(); }
    });
  }

  // Step 4
  const s4 = steps.s4;
  async function buildVariations(){
    setTimeout(()=>{ const sp=q('.bmms-splash', s4); if(sp) sp.style.display='none'; const sl=q('.bmms-slider', s4); if(sl){ sl.style.display=''; } }, 1200);
    const wrap = q('.bmms-slides', s4); if(!wrap) return; wrap.innerHTML='';
    const nextBtn = q('.bmms-next', s4); if(nextBtn) nextBtn.disabled = true;
    
    // Show loading state
    wrap.innerHTML = '<div style="text-align: center; padding: 40px; color: #6b7280;">Generating AI logos...</div>';
    
    try {
      let variants = await createVariants(12, state);
      const total = variants.length;
      if(total === 0){
        wrap.innerHTML = '<div style="text-align: center; padding: 40px; color: #ef4444;">No AI logos were generated. Please check your image generation endpoint or Fal.ai configuration, then retry.</div><div style="text-align:center; margin-top: 12px;"><button class="bmms-retry" type="button" style="background:#111827;color:#fff;padding:8px 14px;border-radius:6px;">Retry</button></div>';
        return;
      }
      state.slides = [ variants.slice(0,4), variants.slice(4,8), variants.slice(8,12) ];
      state.selected = null;
      let idx = 0;
      if(nextBtn) nextBtn.disabled = total === 0 || !state.selected;
      function render(){ wrap.innerHTML=''; const slide=document.createElement('div'); slide.className='bmms-slide';
        state.slides[idx].forEach(v=>{ const card=document.createElement('div'); card.className='bmms-card'; const img=new Image(); img.src=v.dataUrl; img.alt='Logo option'; card.appendChild(img); const footer=document.createElement('div'); footer.className='bmms-card-footer'; footer.textContent = (v.prompt ? 'AI Variation' : (v.id==='idea_local' ? 'Selected Concept' : 'Option')); card.appendChild(footer); if(state.selected && state.selected.id===v.id){ card.classList.add('selected'); } card.addEventListener('click', ()=>{ state.selected=v; const nextBtn = q('.bmms-next', s4); if(nextBtn) nextBtn.disabled = !state.selected; render(); }); slide.appendChild(card); });
        wrap.appendChild(slide);
      }
      render();
      const prev = q('.bmms-slide-nav.prev', s4); const next = q('.bmms-slide-nav.next', s4);
      if(prev){ prev.onclick=()=>{ idx=(idx+state.slides.length-1)%state.slides.length; render(); }; }
      if(next){ next.onclick=()=>{ idx=(idx+1)%state.slides.length; render(); }; }
    } catch(error) {
      console.error('Failed to generate logo variations:', error);
      wrap.innerHTML = '<div style="text-align: center; padding: 40px; color: #ef4444;">Failed to generate logos. Please try again.</div><div style="text-align:center; margin-top: 12px;"><button class="bmms-retry" type="button" style="background:#111827;color:#fff;padding:8px 14px;border-radius:6px;">Retry</button></div>';
    }
    
    // Listener moved outside to avoid multiple attachments
  }

  // Attach Step 4 listeners once
  if(s4){
    s4.addEventListener('click', function(e){
      const t=e.target;
      if(t.closest('.bmms-back')){ showStep('s3'); return; }
      if(t.closest('.bmms-next')){ showStep('s5'); finalize(); return; }
      if(t.closest('.bmms-retry')){ buildVariations(); return; }
    });
  }

  // Step 5
  const s5 = steps.s5;
  function finalize(){ setTimeout(()=>{ const sp=q('.bmms-splash', s5); if(sp) sp.style.display='none'; const fin=q('.bmms-final', s5); if(fin) fin.style.display=''; const img=q('#bmms-final-image', s5); if(img && state.selected){ img.src=state.selected.dataUrl; } }, 900); }
  if(s5){
    s5.addEventListener('click', function(e){
      const t=e.target;
      if(t.closest('.bmms-back')){ showStep('s4'); return; }
      if(t.closest('.bmms-zoom')){ const ov=q('.bmms-zoom-overlay', s5); const zi=q('#bmms-zoom-image', s5); const fin=q('#bmms-final-image', s5); if(ov && zi && fin){ zi.src=fin.src; ov.style.display='flex'; } }
      if(t.closest('.bmms-zoom-close')){ const ov=q('.bmms-zoom-overlay', s5); if(ov) ov.style.display='none'; }
      if(t.closest('.bmms-download')){ const fin=q('#bmms-final-image', s5); const src=fin?.src||''; if(src.startsWith('data:image/svg')){ svgToPng(src, 1200, 900).then(png=>download(png,'brand-logo.png')); } else { download(src,'brand-logo.png'); } }
    });
  }

  function download(dataUrl, name){ const a=document.createElement('a'); a.href=dataUrl; a.download=name||'download.png'; document.body.appendChild(a); a.click(); setTimeout(()=>a.remove(),100); }

  function getImageEndpoint(){
    const cfg = window.AGUiConfig || window.AGConfig || {};
    // Prefer WordPress REST endpoint first to avoid CORS issues
    const wp = (cfg.wpImageEndpoint || '').replace(/\/$/, '');
    const agent = (cfg.agentImageEndpoint || '').replace(/\/$/, '');
    const chosen = wp || '/wp-json/agui-chat/v1/image/generate';
    // Update small banner text in Step 4
    const el = document.getElementById('bmms-endpoint-text');
    if (el) {
      try {
        const isWp = chosen.startsWith('/wp-json/agui-chat');
        const url = isWp ? new URL(chosen, window.location.origin) : new URL(chosen);
        const sameHost = url.hostname === window.location.hostname;
        const label = isWp ? 'WordPress REST' : (sameHost ? 'Agent (same-origin)' : 'Agent');
        el.textContent = `${label}: ${url.origin}${url.pathname}`;
      } catch(e) {
        el.textContent = chosen;
      }
    }
    return chosen;
  }

  async function createVariants(n, st){ 
    const arr=[];
    const name = (st.brand_text||st.name||'Your Brand');
    const description = st.description || '';
    const icon = st.icon || 'modern';
    const email = st.email || '';

    // Map icon choice to style wording
    const iconStyle = (function(){
      switch(icon){
        case 'lightning': return 'energetic, angular iconography';
        case 'gauge': return 'classic circular mark';
        case 'rocket': return 'forward-moving, modern mark';
        case 'custom': return 'custom icon concept based on user selection';
        default: return 'modern mark';
      }
    })();

    // Create AI prompts for logo variations
    const emailPart = email ? ` Contact email: ${email}.` : '';
    const basePrompt = `Create a professional logo for "${name}". Business description: ${description}. Style: ${iconStyle}.` + emailPart + ((st && st.selectedIdea) ? ' Use the provided reference image as the foundation for layout and iconography.' : '');
    const variations = [
      `${basePrompt} Minimalist style with clean lines and modern typography`,
      `${basePrompt} Bold and vibrant colors with strong visual impact`,
      `${basePrompt} Elegant and sophisticated design with premium feel`,
      `${basePrompt} Creative and artistic approach with unique elements`,
      `${basePrompt} Tech-focused design with geometric shapes`,
      `${basePrompt} Classic and timeless design with traditional elements`,
      `${basePrompt} Playful and friendly design with rounded elements`,
      `${basePrompt} Professional corporate style with strong branding`,
      `${basePrompt} Modern gradient design with contemporary feel`,
      `${basePrompt} Monochrome design with strong contrast`,
      `${basePrompt} Colorful and energetic design with dynamic elements`,
      `${basePrompt} Luxury brand design with premium aesthetics`
    ];

    // Multi-endpoint fallback: try WP REST, then Agent, then FastAPI if configured
    const cfg = window.AGUiConfig || window.AGConfig || {};
    const wp = (cfg.wpImageEndpoint || '').replace(/\/$/, '') || '/wp-json/agui-chat/v1/image/generate';
    const agent = (cfg.agentImageEndpoint || '').replace(/\/$/, '');
    const fastApi = (cfg.fastApiImageEndpoint || '').replace(/\/$/, '');
    let endpoints = [wp, agent, fastApi].filter(Boolean);

    // Feature flag: allow disabling non-WordPress fallbacks entirely
    const disableAgentFallbacks = !!(cfg.disableAgentFallbacks || cfg.disableNonWpFallbacks);
    if (disableAgentFallbacks) {
      endpoints = [wp].filter(Boolean);
    }

    // Generate logos using AI across available endpoints
    for (let i = 0; i < Math.min(n, variations.length); i++) {
      let success = false;
      // Decide whether to include image_url (skip for localhost/.local to avoid Fal fetch failures)
      let imageUrl = '';
      try {
        const idea = (st && st.selectedIdea) ? String(st.selectedIdea) : '';
        const u = new URL(idea, window.location.origin);
        const host = u.hostname || '';
        const isLocal = /(localhost|127\.0\.0\.1|\.local)$/i.test(host) || !/^https?:\/\//i.test(u.toString());
        if (!isLocal && /^https?:\/\//i.test(u.toString())) {
          imageUrl = u.toString();
        }
      } catch(e) {}

      const payload = {
        prompt: variations[i],
        image_url: imageUrl,
        size: '1024x1024',
        format: 'png',
        guidance_scale: 3.5,
        num_inference_steps: 25
      };

      for (const endpoint of endpoints){
        try {
          // Banner reflects the primary endpoint
          if (i === 0 && endpoint === endpoints[0]) {
            try { getImageEndpoint(); } catch(e) {}
          }
          const headers = { 'Content-Type': 'application/json' };
          try {
            const u = new URL(endpoint, window.location.origin);
            const isAgent = u.pathname.includes('/api/');
            const token = cfg.dbToken || cfg.db_token || '';
            if (isAgent) {
              headers['ngrok-skip-browser-warning'] = '1';
              if (token) headers['Authorization'] = `Bearer ${token}`;
            }
          } catch(e) {}

          const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
          });

          if (response.ok) {
            const result = await response.json();
            const url = extractImageUrl(result);
            if (url && !String(url).startsWith('data:image/svg')){
              arr.push({ id: 'ai_v' + i, dataUrl: url, prompt: variations[i] });
              success = true;
              break; // done for this variant
            } else {
              console.warn('No valid AI image URL returned for variant', i, 'via', endpoint);
            }
          } else {
            console.warn('Image generation not ok', response.status, response.statusText, 'via', endpoint);
          }
        } catch(error) {
          console.warn('AI generation failed via', endpoint, 'for variant', i, error);
        }
      }

      if (!success) {
        // Skip variant if all endpoints failed
      }
    }

    return arr; 
  }
  function makeSvg(icon, text, primary, bg, desc, idx){
    const t = safe(text);
    const d = safe(desc);
    const shape = (function(){
      if(icon==='lightning') return '<polygon points="200,150 240,80 230,160 270,160 210,240 220,170 180,170" fill="'+primary+'" />';
      if(icon==='rocket') return '<path d="M220 80 C240 120 240 200 220 240 L200 240 L200 80 Z" fill="'+primary+'" />';
      if(icon==='gauge') return '<circle cx="210" cy="160" r="46" fill="'+primary+'" /><line x1="210" y1="160" x2="250" y2="150" stroke="#fff" stroke-width="6" stroke-linecap="round" />';
      if(icon==='custom') return '<polygon points="210,120 250,150 240,200 180,200 170,150" fill="'+primary+'" />';
      return '<circle cx="210" cy="160" r="40" fill="'+primary+'" />';
    })();
    return '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><defs><linearGradient id="g'+idx+'" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="'+bg+'"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g'+idx+')"/><g transform="translate(140,120)">'+shape+'</g><text x="360" y="196" font-size="72" font-family="Inter,Arial" fill="#111827" opacity="0.92">'+t+'</text><text x="360" y="260" font-size="26" font-family="Inter,Arial" fill="#475569">'+d+'</text></svg>';
  }
  function safe(s){ return String(s||'').replace(/[\r\n]+/g,' ').slice(0,64); }
  function svgToPng(dataUrl, w, h){ return new Promise(function(resolve){ const img=new Image(); img.onload=function(){ const c=document.createElement('canvas'); c.width=w; c.height=h; const ctx=c.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,w,h); ctx.drawImage(img,0,0,w,h); resolve(c.toDataURL('image/png')); }; img.crossOrigin='anonymous'; img.src=dataUrl; }); }
  function extractImageUrl(result){
    try {
      const data = result?.data || result;
      if(!data) return '';
      if(typeof data === 'string') return data;
      const candidates = [];
      candidates.push(data.image_url);
      candidates.push(data.url);
      candidates.push(typeof data.image === 'string' ? data.image : null);
      candidates.push(data.data_uri);
      candidates.push(data.dataUrl);
      candidates.push(data.image_base64);
      candidates.push(data.base64);
      candidates.push(data?.images?.[0]?.url);
      candidates.push(data?.output?.images?.[0]?.url);
      candidates.push(data?.result?.images?.[0]?.url);
      candidates.push(data?.data?.images?.[0]?.url);
      candidates.push(data?.data?.image_url);
      candidates.push(data?.data?.image?.url);
      candidates.push(typeof data?.data?.image === 'string' ? data.data.image : null);
      candidates.push(data?.image?.url);
      candidates.push(data?.image?.data_uri);
      candidates.push(data?.image?.base64);
      const found = candidates.find(u => typeof u==='string' && u);
      return found || '';
    } catch(e){ return ''; }
  }

  // Init: show first step on load
  showStep('s1');
})();

   })();
