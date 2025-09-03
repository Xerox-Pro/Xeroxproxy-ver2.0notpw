// api/check.js
module.exports = (req, res) => {
  const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
  const HANDSHAKE_TOKEN = process.env.HANDSHAKE_TOKEN || '';
  const SECRET_QUERY_TOKEN = process.env.SECRET_QUERY_TOKEN || '';

  const referer = req.headers.referer || '';
  let tokenQ = '';
  try { tokenQ = new URL(`${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}${req.url}`).searchParams.get('token') || ''; } catch(e){}

  const refererOk = ALLOWED_ORIGIN && referer.includes(ALLOWED_ORIGIN);
  const tokenOk = SECRET_QUERY_TOKEN && tokenQ === SECRET_QUERY_TOKEN;

  if (!refererOk && !tokenOk) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('Forbidden');
  }

  res.setHeader('Content-Security-Policy', `frame-ancestors ${ALLOWED_ORIGIN};`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');

  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>埋め込みコンテンツ</title>
</head>
<body>
<div id="app">Waiting for parent...</div>

<script>
const EXPECTED_PARENT = ${JSON.stringify(ALLOWED_ORIGIN)};
const EXPECTED_TOKEN = ${JSON.stringify(HANDSHAKE_TOKEN)};
let handshakeOk = false;

function showDenied() {
  document.getElementById('app').textContent = 'Access denied';
}

window.addEventListener('message', (e) => {
  if (e.origin !== EXPECTED_PARENT) return;
  let data = e.data;
  try { if (typeof data === 'string') data = JSON.parse(data); } catch(e){}
  if (!data || data.type !== 'handshake') return;
  if (data.token === EXPECTED_TOKEN) {
    handshakeOk = true;
    e.source.postMessage({ type: 'handshake-ack' }, e.origin);
    document.getElementById('app').innerHTML = '<h1>埋め込みコンテンツ</h1><p>ここが表示されます。</p>';
  }
}, false);

setTimeout(() => { if (!handshakeOk) showDenied(); }, 3000);
</script>
</body>
</html>`;

  res.end(html);
};
