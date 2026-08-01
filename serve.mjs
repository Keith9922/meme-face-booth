// 本地服务器：静态文件 + 表情包管理 API。
//
// 必须正确吐 application/wasm，否则 MediaPipe 的 instantiateStreaming 会失败。
// localhost 是 secure context，摄像头可用。
//
// 默认只监听 127.0.0.1 —— 带写接口的服务不该随便暴露到局域网。
// 需要别的设备访问：HOST=0.0.0.0 node serve.mjs（此时写接口默认关闭，
// 要一并打开就再加 ALLOW_WRITE=1，自己判断网络环境是否可信）。
import { createServer } from 'node:http';
import { readFile, writeFile, stat, unlink, mkdir, readdir } from 'node:fs/promises';
import { extname, join, normalize, basename } from 'node:path';

const ROOT = process.cwd();
const MEMES = join(ROOT, 'memes');
const MANIFEST = join(MEMES, 'manifest.json');
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';
const TOKEN = process.env.ADMIN_TOKEN || '';
const LOCAL_ONLY = HOST === '127.0.0.1' || HOST === 'localhost';

/* 写接口的开放条件，按危险程度从松到紧：
     只监听本机            → 直接开（外面进不来）
     设了 ADMIN_TOKEN      → 开，但每次写都要带上 token
     既非本机又没 token    → 关。放公网上的无鉴权写接口 = 谁都能上传和删除。 */
const ALLOW_WRITE = LOCAL_ONLY || !!TOKEN;

/* 只要配了 token 就一定校验，不因「绑定在 127.0.0.1」而放行。
   反向代理场景下本机绑定不再等于本机信任：nginx 从公网收到请求后再转发到
   127.0.0.1，服务看到的源地址永远是本机，按绑定地址免鉴权等于门户大开。 */
const needToken = () => !!TOKEN;

/* 定长比较，避免用比较耗时反推 token */
function tokenOk(req){
  if (!needToken()) return true;
  const h = req.headers['authorization'] || '';
  const got = h.startsWith('Bearer ') ? h.slice(7) : (req.headers['x-admin-token'] || '');
  if (got.length !== TOKEN.length) return false;
  let diff = 0;
  for (let i = 0; i < TOKEN.length; i++) diff |= got.charCodeAt(i) ^ TOKEN.charCodeAt(i);
  return diff === 0;
}

const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.wasm':'application/wasm',
  '.task':'application/octet-stream', '.png':'image/png', '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif', '.svg':'image/svg+xml',
};
const EXT_OF = { 'image/png':'.png', 'image/jpeg':'.jpg', 'image/webp':'.webp', 'image/gif':'.gif' };

const json = (res, code, obj) => {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'Content-Type':'application/json; charset=utf-8', 'Content-Length':b.length });
  res.end(b);
};
const readBody = req => new Promise((ok, no) => {
  const c = []; let n = 0;
  req.on('data', d => {
    n += d.length;
    if (n > 32 * 1024 * 1024){ no(new Error('请求体超过 32MB')); req.destroy(); return; }
    c.push(d);
  });
  req.on('end', () => ok(Buffer.concat(c)));
  req.on('error', no);
});

async function loadManifest(){
  try { return JSON.parse(await readFile(MANIFEST, 'utf8')); }
  catch { return { memes: [] }; }
}
const saveManifest = m => writeFile(MANIFEST, JSON.stringify(m, null, 2) + '\n');

/* 文件名安全化：只留字母数字中文和短横，避免路径穿越和奇怪字符 */
const safeName = s => (s || '').replace(/[^\w一-龥-]/g, '').slice(0, 40);

/* ── API ─────────────────────────────────────────────────── */

async function api(req, res, path){
  if (req.method !== 'GET'){
    if (!ALLOW_WRITE)
      return json(res, 403, { error:'写接口已关闭：非本机监听且未设 ADMIN_TOKEN。' });
    if (!tokenOk(req))
      return json(res, 401, { error:'需要 ADMIN_TOKEN' });
  }

  /* 列出全部 */
  if (path === '/api/memes' && req.method === 'GET'){
    const m = await loadManifest();
    let files = [];
    try { files = await readdir(MEMES); } catch {}
    const have = new Set(files);
    return json(res, 200, {
      memes: m.memes.map(e => ({ ...e, missing: !have.has(e.file) })),
      orphans: files.filter(f => f !== 'manifest.json' && !m.memes.some(e => e.file === f)),
      writable: ALLOW_WRITE, needToken: needToken(),
    });
  }

  /* harvest/ 里的候选图（tools/harvest.mjs 拉的 CC0 素材），供管理台筛选 */
  if (path === '/api/harvest' && req.method === 'GET'){
    const dir = join(ROOT, 'harvest');
    let files = [], meta = {};
    try { files = await readdir(dir); } catch {}
    try { meta = JSON.parse(await readFile(join(dir, '_source.json'), 'utf8')); } catch {}
    const imgs = files.filter(f => /\.(jpe?g|png|webp)$/i.test(f));
    return json(res, 200, { files: imgs.map(f => ({ file:f, ...(meta[f] || {}) })) });
  }

  /* 新增一张：{ name, dataUrl, face, pose } —— 向量在浏览器里算好再传上来，
     服务端不跑推理，保持零依赖。 */
  if (path === '/api/memes' && req.method === 'POST'){
    const body = JSON.parse((await readBody(req)).toString('utf8'));
    const { name, dataUrl, face = null, pose = null } = body;
    if (!dataUrl) return json(res, 400, { error:'缺少 dataUrl' });
    if (!face && !pose) return json(res, 400, { error:'表情和动作都提取不到，这张图用不了' });

    const mt = /^data:([^;]+);base64,/.exec(dataUrl);
    if (!mt || !EXT_OF[mt[1]]) return json(res, 400, { error:'只支持 png / jpeg / webp / gif' });
    const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    if (buf.length > 8 * 1024 * 1024) return json(res, 400, { error:'单图超过 8MB' });

    const m = await loadManifest();
    const stem = safeName(name) || `meme-${m.memes.length + 1}`;
    let file = stem + EXT_OF[mt[1]], i = 1;
    while (m.memes.some(e => e.file === file)) file = `${stem}-${++i}${EXT_OF[mt[1]]}`;

    await mkdir(MEMES, { recursive: true });
    await writeFile(join(MEMES, file), buf);
    const entry = { file, name: name || stem, code:`M-${String(m.memes.length + 1).padStart(2,'0')}`, face, pose };
    m.memes.push(entry);
    await saveManifest(m);
    return json(res, 201, { ok:true, entry });
  }

  /* 改名 / 回填向量（老条目是手写的，没有向量，由管理台补算后写回） */
  if (path.startsWith('/api/memes/') && req.method === 'PATCH'){
    const file = decodeURIComponent(path.slice('/api/memes/'.length));
    const m = await loadManifest();
    const e = m.memes.find(x => x.file === file);
    if (!e) return json(res, 404, { error:'没有这张' });
    const b = JSON.parse((await readBody(req)).toString('utf8'));
    if (b.name) e.name = String(b.name).slice(0, 20);
    if ('face' in b) e.face = b.face;
    if ('pose' in b) e.pose = b.pose;
    await saveManifest(m);
    return json(res, 200, { ok:true, entry:e });
  }

  /* 删除 */
  if (path.startsWith('/api/memes/') && req.method === 'DELETE'){
    const file = basename(decodeURIComponent(path.slice('/api/memes/'.length)));
    const m = await loadManifest();
    const before = m.memes.length;
    m.memes = m.memes.filter(e => e.file !== file);
    await saveManifest(m);
    try { await unlink(join(MEMES, file)); } catch {}
    return json(res, 200, { ok:true, removed: before - m.memes.length });
  }

  return json(res, 404, { error:'没有这个接口' });
}

/* ── 静态 ────────────────────────────────────────────────── */

createServer(async (req, res) => {
  let path;
  try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { return json(res, 400, { error:'URL 解析失败' }); }

  if (path.startsWith('/api/')){
    try { return await api(req, res, path); }
    catch (e){ console.error(e); return json(res, 500, { error:String(e.message || e) }); }
  }

  try {
    if (path.endsWith('/')) path += 'index.html';
    const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT)){ res.writeHead(403).end('nope'); return; }
    const s = await stat(file);
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Content-Length': s.size,
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8' }).end('404');
  }
}).listen(PORT, HOST, () => {
  console.log(`  表情复刻机   http://localhost:${PORT}`);
  console.log(`  素材管理     http://localhost:${PORT}/admin.html`);
  console.log(`  监听         ${HOST}:${PORT}`);
  console.log(`  写接口       ${!ALLOW_WRITE ? '关闭（非本机且未设 ADMIN_TOKEN）'
                              : needToken() ? '开启 · 需要 ADMIN_TOKEN' : '开启 · 本机免鉴权'}`);
  if (!LOCAL_ONLY && !TOKEN)
    console.log(`  ⚠ 对外监听却没设 ADMIN_TOKEN，写接口已自动关闭。设了才能远程上传。`);
});
