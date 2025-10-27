// Simple preview server for wp-agui-chat plugin UI
// Serves static assets and stubs WordPress REST endpoints used by the UI
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = process.cwd();
const PORT = process.env.PORT ? Number(process.env.PORT) : 5500;

function sendJson(res, code, obj){
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin':'*' });
  res.end(body);
}

function parseBody(req){
  return new Promise((resolve)=>{
    let data='';
    req.on('data', chunk=>{ data += chunk; });
    req.on('end', ()=>{
      try{ resolve(JSON.parse(data||'{}')); }catch(e){ resolve({}); }
    });
  });
}

function svgFromPrompt(prompt){
  const safe = String(prompt||'Brand Concept').replace(/[\r\n]+/g,' ').slice(0,80);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600">
    <defs>
      <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="#f0f4ff"/>
        <stop offset="1" stop-color="#e2eafc"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <text x="50%" y="45%" text-anchor="middle" font-family="Inter,Arial" font-size="42" fill="#111" opacity="0.9">Brand Visual</text>
    <text x="50%" y="58%" text-anchor="middle" font-family="Inter,Arial" font-size="28" fill="#333">${safe}</text>
  </svg>`;
}

function contentType(ext){
  const map = {
    '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
    '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml'
  };
  return map[ext] || 'application/octet-stream';
}

const server = http.createServer(async (req,res)=>{
  const parsed = url.parse(req.url, true);
  const pathname = decodeURI(parsed.pathname);

  // CORS preflight for stub endpoints
  if(req.method === 'OPTIONS'){
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, ngrok-skip-browser-warning'
    });
    return res.end('');
  }

  // Settings endpoint: proxy to WP if WP_ORIGIN is set, otherwise stub
  if (pathname === '/wp-json/agui-chat/v1/settings') {
    const WP_ORIGIN = process.env.WP_ORIGIN || '';
    if (WP_ORIGIN) {
      const target = new url.URL('/wp-json/agui-chat/v1/settings', WP_ORIGIN);
      const mod = target.protocol === 'https:' ? require('https') : require('http');
      const rq = mod.request(target, { method: 'GET' }, (rs) => {
        let data = '';
        rs.on('data', (c) => data += c);
        rs.on('end', () => {
          try { sendJson(res, rs.statusCode || 200, JSON.parse(data)); }
          catch(_) { res.writeHead(rs.statusCode || 200); res.end(data); }
        });
      });
      rq.on('error', () => sendJson(res, 502, { error:'Proxy to WP settings failed' }));
      rq.end();
      return;
    }
    const publicCfg = {
      sseUrl: '',
      wsUrl: '',
      sendUrl: '',
      preferWebSocket: false,
      fallbackUrl: '',
      wpSendEndpoint: '/wp-json/agui-chat/v1/agent/send',
      wpFormEndpoint: '/wp-json/agui-chat/v1/ghl/contact',
      wpImageEndpoint: '/wp-json/agui-chat/v1/image/generate',
      fastApiBase: '',
      dbToken: '',
      agentImageEndpoint: 'http://127.0.0.1:8000/api/fal/generate'
    };
    return sendJson(res, 200, publicCfg);
  }

  // Image generation endpoint: proxy to WP if WP_ORIGIN is set, otherwise return SVG
  if (pathname === '/wp-json/agui-chat/v1/image/generate') {
    const WP_ORIGIN = process.env.WP_ORIGIN || '';
    const body = await parseBody(req);
    if (WP_ORIGIN) {
      const target = new url.URL('/wp-json/agui-chat/v1/image/generate', WP_ORIGIN);
      const mod = target.protocol === 'https:' ? require('https') : require('http');
      const rq = mod.request(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, (rs) => {
        let data = '';
        rs.on('data', (c) => data += c);
        rs.on('end', () => {
          try { sendJson(res, rs.statusCode || 200, JSON.parse(data)); }
          catch(_) { res.writeHead(rs.statusCode || 200); res.end(data); }
        });
      });
      rq.on('error', () => sendJson(res, 502, { error:'Proxy to WP image generate failed' }));
      rq.end(JSON.stringify(body||{}));
      return;
    }
    const svg = svgFromPrompt(body && body.prompt);
    const dataUri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    return sendJson(res, 200, { ok:true, status:200, data: { image_url: dataUri } });
  }

  // Serve static files
  let filePath = path.join(ROOT, pathname === '/' ? '/preview-plugin.html' : pathname);
  try{
    const st = fs.statSync(filePath);
    if(st.isDirectory()){
      filePath = path.join(filePath, 'index.html');
    }
  }catch(e){
    res.writeHead(404, { 'Content-Type':'text/plain' });
    return res.end('Not found');
  }
  try{
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType(path.extname(filePath)) });
    res.end(data);
  }catch(e){
    res.writeHead(500, { 'Content-Type':'text/plain' });
    res.end('Server error');
  }
});

server.listen(PORT, ()=>{
  console.log('Preview server running at http://localhost:'+PORT+'/');
});

// Keep server alive
process.on('SIGINT', ()=>{ try{ server.close(); }catch(e){} process.exit(0); });