// Электрондық кезек — бір үстелге арналған. Іске қосу: node server.js
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const PORT = process.env.PORT || 3000;
const PIN = process.env.MANAGER_PIN || '1234';
const FILE = path.join(__dirname, 'state.json');

let S = { last: 0, serving: 0, call: 0, waiting: [], tickets: {} };
try { S = Object.assign(S, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) {}

const pub = () => ({ serving: S.serving, last: S.last, call: S.call, waiting: S.waiting });
const clients = new Set();
function push() {
  const d = 'data: ' + JSON.stringify(pub()) + '\n\n';
  clients.forEach(r => r.write(d));
  fs.writeFile(FILE, JSON.stringify(S), () => {});
}
function baseUrl() {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  for (const l of Object.values(os.networkInterfaces()))
    for (const i of l) if (i.family === 'IPv4' && !i.internal) return 'http://' + i.address + ':' + PORT;
  return 'http://localhost:' + PORT;
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const body = req => new Promise(ok => { let b = ''; req.on('data', c => { b += c; if (b.length > 1e4) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch (e) { ok({}); } }); });
const pages = { '/': 'index.html', '/display': 'display.html', '/manager': 'manager.html' };

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (pages[url] && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(fs.readFileSync(path.join(__dirname, pages[url])));
  }
  if (url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('data: ' + JSON.stringify(pub()) + '\n\n');
    clients.add(res);
    const t = setInterval(() => res.write(': ping\n\n'), 25000);
    return req.on('close', () => { clearInterval(t); clients.delete(res); });
  }
  if (url === '/api/state') return json(res, 200, pub());
  if (url === '/api/info') {
    let u = baseUrl();
    if (!process.env.BASE_URL && req.headers.host && !/^(localhost|127\.|\d+\.\d+\.\d+\.\d+)/.test(req.headers.host)) {
      const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
      u = proto + '://' + req.headers.host;
    }
    return json(res, 200, { joinUrl: u + '/' });
  }
  if (req.method !== 'POST') return json(res, 404, { error: 'not found' });

  const b = await body(req);
  if (url === '/api/take') {
    const id = String(b.id || '').slice(0, 64);
    const n = S.tickets[id];
    if (n && (S.waiting.includes(n) || S.serving === n)) return json(res, 200, { number: n });
    S.last++;
    S.waiting.push(S.last);
    if (id) S.tickets[id] = S.last;
    push();
    return json(res, 200, { number: S.last });
  }
  // төменде — тек менеджер (PIN)
  if (req.headers['x-pin'] !== PIN) return json(res, 401, { error: 'PIN қате' });
  if (url === '/api/next') {
    if (!S.waiting.length) return json(res, 400, { error: 'Кезек бос' });
    S.serving = S.waiting.shift(); S.call++;
    push(); return json(res, 200, pub());
  }
  if (url === '/api/recall') { if (S.serving) { S.call++; push(); } return json(res, 200, pub()); }
  if (url === '/api/reset') { S = { last: 0, serving: 0, call: S.call + 1, waiting: [], tickets: {} }; push(); return json(res, 200, pub()); }
  json(res, 404, { error: 'not found' });
}).listen(PORT, () => {
  const u = baseUrl();
  console.log('\nЭлектрондық кезек жұмыс істеп тұр\n');
  console.log('  Клиент (QR осыған апарады):', u + '/');
  console.log('  Экран (теледидар/монитор):  ', u + '/display');
  console.log('  Менеджер (үстел):           ', u + '/manager   PIN:', PIN, '\n');
});
