/* ──────────────────────────────────────────────────────────────
   Mimic 04 · 表情包复刻机

   交互：不用选。你随便做表情 → 实时从库里挑出最像的那张 →
        够像了就倒数三秒自动拍 → 也可以随时手动按快门。

   匹配：表情包图片自己就是目标。
        图片 → FaceLandmarker(IMAGE) → 41 维 blendshapes → 标准答案
        你的脸 → 同样 41 维 → 加权距离 → 取最近的一张

   防抖三件套（缺一个现场就会抽风）：
     1) 摆烂闸门 —— 「面无表情」也在候选池里，不做表情时它赢，不出分不触发
     2) 换图迟滞 —— 新候选要比当前的近一截才准许换，否则相似的两张会疯狂跳
     3) 去抖帧数 —— 同一张连续命中若干帧才开始倒计时

   全部本机运行，断网可用，不上传任何数据。
   ────────────────────────────────────────────────────────────── */

import { FilesetResolver, FaceLandmarker } from './vendor/tasks-vision/vision_bundle.mjs';

const $ = s => document.querySelector(s);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;

/* ── 1. 可调参数 ─────────────────────────────────────────── */
/* d0/d1 是扫参扫出来的：先量"按目标做到 N 成"的实际距离
   （95%→0.020 / 85%→0.053 / 70%→0.101 / 50%→0.162），
   再搜使分数落在 96/90/72/45 的组合。结果就是条直线。      */

const KNOBS = [
  { k:'d1',    label:'零分距离 d1',  min:.15, max:.9, step:.01,  def:.44,
    tip:'主旋钮：调小变难、调大变松' },
  { k:'d0',    label:'满分距离 d0',  min:0,   max:.2, step:.005, def:.005 },
  { k:'gamma', label:'曲线 γ',      min:.4,  max:3,  step:.05,  def:1 },
  { k:'blank', label:'摆烂闸门',    min:.4,  max:3,  step:.05,  def:1,
    tip:'你离"面无表情"多近就算没做表情。调大 = 要求你做得更夸张才开始计分' },
  { k:'stick', label:'换图迟滞',    min:.6,  max:1,  step:.01,  def:.9,
    tip:'新表情包要比当前这张近这么多倍才准换。调小 = 更黏，不容易乱跳' },
  { k:'thr',   label:'触发阈值 %',  min:60,  max:99, step:1,    def:85 },
  { k:'hold',  label:'去抖帧数',    min:1,   max:30, step:1,    def:8 },
  { k:'alpha', label:'平滑 α',      min:.05, max:1,  step:.05,  def:.4 },
  { k:'cd',    label:'倒计时 秒',   min:0,   max:5,  step:.5,   def:3 },
  { k:'abort', label:'中断余量 %',  min:0,   max:30, step:1,    def:12 },
];
const T = {};
KNOBS.forEach(n => T[n.k] = n.def);
try { Object.assign(T, JSON.parse(localStorage.mimicTune4 || '{}')); } catch {}
const saveTune = () => localStorage.mimicTune4 = JSON.stringify(T);

/* ── 2. 特征向量 ─────────────────────────────────────────── */
/* 52 维 blendshapes 剔掉：
     _neutral   —— 不是表情
     eyeLook*   —— "眼球往哪看"，实测有的表情包 top2 就是它，用户没法也不该复刻
     eyeBlink*  —— 瞬时动作，要求"保持眨眼"很怪（eyeSquint 眯眼保留）        */
const DROP = n => n === '_neutral' || n.startsWith('eyeLook') || n.startsWith('eyeBlink');
let KEEP = null, NEU = null;

function vecOf(res){
  const bs = res?.faceBlendshapes?.[0]?.categories;
  if (!bs) return null;
  if (!KEEP){
    KEEP = bs.map((c,i) => ({ name:c.categoryName, i })).filter(o => !DROP(o.name));
    NEU = KEEP.map(() => 0);
  }
  return KEEP.map(o => bs[o.i].score);
}

/* 加权 RMS 距离：w = 0.3 + max(目标, 你)
   目标在意的维度权重高；你多做出来的动作也一样被罚。归一化后落在 0~1。 */
function dist(u, t){
  let num = 0, den = 0;
  for (let i = 0; i < u.length; i++){
    const w = 0.3 + Math.max(t[i], u[i]), d = u[i] - t[i];
    num += w * d * d; den += w;
  }
  return Math.sqrt(num / den);
}
const pctOf = d => 100 * Math.pow(
  clamp((T.d1 - d) / Math.max(1e-6, T.d1 - T.d0), 0, 1), T.gamma);

/* ── 3. 表情包库 ─────────────────────────────────────────── */

const CACHE_KEY = 'mimicVecCache_v3', CUSTOM_KEY = 'mimicCustom_v3';
let vecCache = {}, customs = [];
try { vecCache = JSON.parse(localStorage[CACHE_KEY] || '{}'); } catch {}
try { customs  = JSON.parse(localStorage[CUSTOM_KEY] || '[]'); } catch {}

let LIB = [], libReady = false;
const strengthOf = m => (m.vec && NEU) ? dist(m.vec, NEU) : null;

/* ── 4. 实时匹配 ─────────────────────────────────────────── */
/*  1. 算到每张表情包的距离，排序
    2. 「面无表情」是候选之一 —— 它赢就说明你还没做表情，直接不出分
    3. 换图迟滞：新的要比当前这张近 stick 倍才准换，否则相似的两张会疯狂跳   */

let matched = null;                       // 当前锁定的表情包

function match(u){
  if (!NEU) NEU = new Array(u.length).fill(0);     // 兜底：正常由 vecOf 首帧建好
  const dB = dist(u, NEU);
  const rank = [];
  for (const m of LIB) if (m.vec) rank.push({ m, d: dist(u, m.vec) });
  if (!rank.length) return null;
  rank.sort((a, b) => a.d - b.d);

  /* 摆烂闸门：离"面无表情"比离任何表情包都近 → 你根本没做表情 */
  if (dB * T.blank < rank[0].d){
    matched = null;
    return { idle:true, dB, rank };
  }
  /* 换图迟滞 */
  const held = matched && rank.find(r => r.m === matched);
  matched = (held && rank[0].d > held.d * T.stick) ? matched : rank[0].m;

  const me = rank.find(r => r.m === matched);
  return { idle:false, meme:matched, d:me.d, show:pctOf(me.d), dB, rank };
}

/* ── 5. 模型 + 提取 ──────────────────────────────────────── */

const vid = $('#vid'), ov = $('#ov'), octx = ov.getContext('2d');
let live = null, still = null, running = false, ts = 0;

const loadImg = src => new Promise(r => {
  const im = new Image();
  im.onload = () => r(im); im.onerror = () => r(null); im.src = src;
});
const extract = img => vecOf(still.detect(img));

async function loadLib(say){
  const out = [];
  let mf = { memes: [] };
  try { mf = await (await fetch('./memes/manifest.json')).json(); } catch {}
  let i = 0;
  for (const e of mf.memes){
    say(`读表情包 ${++i}/${mf.memes.length}`);
    const m = { id:e.file, name:e.name, code:e.code, src:'./memes/' + e.file, vec:null };
    if (vecCache[e.file]) m.vec = vecCache[e.file];
    else {
      const img = await loadImg(m.src);
      if (img){ m.vec = extract(img); if (m.vec) vecCache[e.file] = m.vec; }
    }
    out.push(m);
  }
  for (const c of customs) out.push({ id:c.id, name:c.name, code:'MINE', src:c.src, vec:c.vec, custom:true });
  try { localStorage[CACHE_KEY] = JSON.stringify(vecCache); } catch {}
  return out;
}

async function boot(){
  const btn = $('#go'); btn.disabled = true;
  const say = t => btn.textContent = t;
  try {
    say('请求摄像头…');
    vid.srcObject = await navigator.mediaDevices.getUserMedia({
      video:{ width:{ideal:1280}, height:{ideal:960}, facingMode:'user' }, audio:false });
    await vid.play();
    ov.width = vid.videoWidth; ov.height = vid.videoHeight;

    say('加载模型…');
    const files = await FilesetResolver.forVisionTasks('./vendor/tasks-vision/wasm');
    const mk = async mode => {
      const b = { modelAssetPath:'./models/face_landmarker.task', delegate:'GPU' };
      const o = { runningMode:mode, numFaces:1, outputFaceBlendshapes:true,
                  minFaceDetectionConfidence:mode === 'IMAGE' ? .15 : .5,
                  minFacePresenceConfidence:mode === 'IMAGE' ? .15 : .5 };
      try { return await FaceLandmarker.createFromOptions(files, { baseOptions:b, ...o }); }
      catch { return await FaceLandmarker.createFromOptions(files, { baseOptions:{...b, delegate:'CPU'}, ...o }); }
    };
    [live, still] = await Promise.all([mk('VIDEO'), mk('IMAGE')]);

    /* 预热：首帧要编译 GPU shader，实测能卡 5 秒，在加载页里烧掉 */
    say('预热推理…');
    const w = document.createElement('canvas'); w.width = 640; w.height = 480;
    w.getContext('2d').fillRect(0, 0, 640, 480);
    for (let i = 1; i <= 3; i++){ live.detectForVideo(w, i); await new Promise(r => setTimeout(r, 0)); }
    still.detect(w);
    ts = 16;

    LIB = await loadLib(say);
    libReady = true;
    renderLib();

    $('#veil').hidden = true;
    running = true;
    setState('track');
    requestAnimationFrame(loop);
  } catch (e){
    const v = $('#veil');
    v.hidden = false; v.classList.add('err');
    v.querySelector('h2').textContent = '起不来';
    v.querySelector('p').innerHTML =
      (e.name === 'NotAllowedError' ? '摄像头权限被拒绝，去浏览器设置里放行后刷新。'
       : e.name === 'NotFoundError' ? '没找到摄像头。'
       : String(e.message || e)) +
      '<br><br>注意：<code>getUserMedia</code> 只在 https 或 localhost 下可用。';
    say('重试'); btn.disabled = false;
  }
}

/* ── 6. 状态机 ───────────────────────────────────────────── */

let state = 'idle';
const S = { smooth:null, hits:0, best:0, bestMeme:null, cdEnd:0, lowSince:0,
            roundStart:performance.now(), shown:0, manual:false };
const bestCv = document.createElement('canvas');

function setState(s){
  state = s;
  const map = { idle:['待机',0], track:['等你做表情',1], count:['锁定 · 保持住',1], shot:['已出片',1] };
  const [txt, mode] = map[s] || ['—',0];
  const p = $('#p-state');
  p.querySelector('span').textContent = txt;
  p.className = 'pill' + (mode === 1 ? ' on' : '');
  $('#frame').classList.toggle('lock', s === 'count');
  $('#count').hidden = s !== 'count';
  $('#shutter').disabled = s !== 'track';
}

/* 手动快门：不管分数多少，立刻进倒计时 */
function manualShoot(){
  if (state !== 'track') return;
  S.manual = true; S.best = 0; S.bestMeme = matched; S.lowSince = 0;
  S.cdEnd = performance.now() + Math.max(1, T.cd) * 1000;
  setState('count');
}

/* ── 7. 主循环 ───────────────────────────────────────────── */

let lastT = -1, fpsN = 0, fpsT = performance.now(), uiT = 0;

function loop(){
  if (!running) return;
  requestAnimationFrame(loop);
  if (vid.readyState < 2 || vid.currentTime === lastT) return;
  lastT = vid.currentTime;

  const now = performance.now();
  ts = Math.max(ts + 1, Math.round(now));
  const res = live.detectForVideo(vid, ts);
  const v = vecOf(res);

  fpsN++;
  if (now - fpsT > 500){
    $('#s-fps').textContent = Math.round(fpsN * 1000 / (now - fpsT));
    fpsN = 0; fpsT = now;
    $('#s-dim').textContent = KEEP ? KEEP.length + 'd' : '—';
    $('#s-lib').textContent = LIB.filter(m => m.vec).length;
  }
  drawOverlay(res);

  if (!v){ S.smooth = null; S.hits = 0; showIdle('没检测到脸'); return; }
  S.smooth = S.smooth && S.smooth.length === v.length
    ? S.smooth.map((x, i) => lerp(x, v[i], T.alpha)) : v.slice();

  const r = match(S.smooth);
  if (!r){ showIdle('库里没有可用的表情包'); return; }

  if (r.idle){
    S.hits = 0; S.shown = 0;
    showIdle('做个表情试试');
    if (now - uiT > 90){ uiT = now; paintRank(r); }
    if (state === 'count' && !S.manual) abort(now);
    return;
  }

  S.shown = r.show;
  setTarget(r.meme);
  setScore(r.show);
  if (now - uiT > 90){ uiT = now; paintRank(r); }

  if (state === 'track'){
    /* 必须是同一张连续命中，换了图就重新数 */
    S.hits = (r.show >= T.thr && r.meme === S.bestMeme) ? S.hits + 1 : (r.show >= T.thr ? 1 : 0);
    S.bestMeme = r.meme;
    if (S.hits >= T.hold){
      S.manual = false; S.best = 0; S.lowSince = 0;
      S.cdEnd = now + T.cd * 1000;
      setState('count');
    }
  } else if (state === 'count'){
    if (r.show > S.best){ S.best = r.show; S.bestMeme = r.meme; grabBest(); }
    const left = S.cdEnd - now;
    $('#count').querySelector('b').textContent = Math.max(1, Math.ceil(left / 1000));
    if (!S.manual && r.show < T.thr - T.abort){
      if (!S.lowSince) S.lowSince = now;
      else if (now - S.lowSince > 500) abort(now);
    } else S.lowSince = 0;
    if (left <= 0) capture(now);
  }
}

function abort(now){
  log(false, S.best, S.bestMeme, now);
  S.hits = 0; setState('track');
}

/* ── 8. 出片 ─────────────────────────────────────────────── */

function grabBest(){
  bestCv.width = vid.videoWidth; bestCv.height = vid.videoHeight;
  const c = bestCv.getContext('2d');
  c.save(); c.scale(-1, 1); c.drawImage(vid, -bestCv.width, 0); c.restore();
}

let lastShot = null, serial = +(localStorage.mimicSerial || 0);

function capture(now){
  if (!S.bestMeme){ S.bestMeme = matched || LIB.find(m => m.vec); }
  if (!bestCv.width) grabBest();
  $('#flash').classList.add('go');
  setTimeout(() => $('#flash').classList.remove('go'), 520);
  log(true, S.best, S.bestMeme, now);
  localStorage.mimicSerial = ++serial;
  lastShot = { score:S.best, meme:S.bestMeme, at:new Date(), manual:S.manual, no:serial };
  openSheet();
  setState('shot');
}

/* ── 出片悬浮层 ─────────────────────────────────────────── */

function openSheet(){
  const d = lastShot.at;
  $('#sheetMeta').innerHTML = `
    <div><u>判定</u><b>${lastShot.meme?.name || '?'}</b></div>
    <div><u>相似度</u><b class="${lastShot.score >= T.thr ? 'ok' : ''}">${lastShot.score.toFixed(1)}%</b></div>
    <div><u>方式</u><b>${lastShot.manual ? '手动快门' : '自动抓拍'}</b></div>
    <div><u>编号</u><b>${String(lastShot.no).padStart(4,'0')}</b></div>
    <div><u>时间</u><b>${d.toLocaleTimeString('zh-CN',{hour12:false})}</b></div>`;
  setPrintState('ready');
  makeReceipt();
  $('#shot').hidden = false;
}

function setPrintState(s){
  const el = $('#printState'), btn = $('#sh-print');
  const map = { ready:['', ''], printing:['正在送去打印…','busy'],
                done:['已送打印机','ok'], fail:['打印失败，检查打印机','bad'] };
  const [txt, cls] = map[s] || ['',''];
  el.textContent = txt; el.className = 'pstate ' + cls;
  btn.disabled = s === 'printing';
  btn.textContent = s === 'done' ? '再打一张' : '打印';
}

/* ── 竖版小票 ────────────────────────────────────────────── */
/* 80mm 热敏纸，203dpi ≈ 576px；这里按 2 倍 1152px 渲染保证清晰。
   点阵抖动交给打印机，这里只出灰度。                              */

const RECEIPT = {
  W: 1152, PAD: 64,
  title: '表 情 复 刻 机',
  sub: 'MIMIC PHOTO BOOTH',
  foot: '把这张小票收好　这是你今天的脸',
};

function makeReceipt(){
  const cv = $('#out'), c = cv.getContext('2d');
  const { W, PAD } = RECEIPT, IW = W - PAD * 2;
  const meme = lastShot.meme;

  const draw = memeImg => {
    /* 小票是不定长的：把每段的推进量列出来加总，别用魔数 */
    const photoH = Math.round(IW * 0.78);
    const memeH  = Math.round(IW * 0.78);
    const CHROME = 72 + 48 + 40 + 46 + 52 + 46 + 52   // 标题/副标/分隔/两个段标/两处间距
                 + 74 + 92 + 46 + 38 + 52 + 40;        // 判定/大分数/分隔/编号行/时间/落款
    const H = PAD * 2 + photoH + memeH + CHROME;
    cv.width = W; cv.height = H;

    c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#000'; c.textBaseline = 'alphabetic';
    let y = PAD;

    const mono = (px, w = 400) => `${w} ${px}px "SF Mono", Menlo, monospace`;
    const cjk  = (px, w = 400) => `${w} ${px}px "PingFang SC", sans-serif`;
    const mid = (txt, font, dy) => {
      c.font = font; c.textAlign = 'center';
      c.fillText(txt, W / 2, y + dy); c.textAlign = 'left';
    };
    const rule = (dashed = true) => {
      c.save(); c.strokeStyle = '#000'; c.lineWidth = 3;
      if (dashed) c.setLineDash([10, 11]);
      c.beginPath(); c.moveTo(PAD, y + .5); c.lineTo(W - PAD, y + .5); c.stroke(); c.restore();
    };
    /* 图片裁成正方并居中填满 */
    const box = (img, h, tag) => {
      c.save();
      c.beginPath(); c.rect(PAD, y, IW, h); c.clip();
      if (img){
        const s = Math.max(IW / img.width, h / img.height);
        const dw = img.width * s, dh = img.height * s;
        c.drawImage(img, PAD + (IW - dw) / 2, y + (h - dh) / 2, dw, dh);
      } else { c.fillStyle = '#ddd'; c.fillRect(PAD, y, IW, h); }
      c.restore();
      c.strokeStyle = '#000'; c.lineWidth = 3; c.strokeRect(PAD + 1.5, y + 1.5, IW - 3, h - 3);
      /* 左上角标签 */
      c.font = mono(26, 600);
      const tw = c.measureText(tag).width + 26;
      c.fillStyle = '#000'; c.fillRect(PAD, y, tw, 42);
      c.fillStyle = '#fff'; c.fillText(tag, PAD + 13, y + 30);
      c.fillStyle = '#000';
      y += h;
    };

    mid(RECEIPT.title, cjk(56, 600), 52);      y += 72;
    mid(RECEIPT.sub,   mono(24),      20);     y += 48;
    rule();                                     y += 40;

    c.font = mono(26, 600); c.fillText('01  YOU', PAD, y + 20);  y += 46;
    box(bestCv, photoH, '你');                  y += 52;

    c.font = mono(26, 600); c.fillText('02  MATCH', PAD, y + 20); y += 46;
    box(memeImg, memeH, meme?.name || '?');     y += 52;

    /* 判定 */
    mid(`你是「${meme?.name || '?'}」`, cjk(52, 600), 44);   y += 74;
    mid(`${lastShot.score.toFixed(1)}%`, mono(76, 500), 62); y += 92;
    rule();                                     y += 46;

    const d = lastShot.at;
    const stamp = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} `
                + `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
    c.font = mono(24);
    c.fillText(`NO. ${String(lastShot.no).padStart(4,'0')}`, PAD, y + 18);
    c.textAlign = 'right'; c.fillText(lastShot.manual ? 'MANUAL' : 'AUTO', W - PAD, y + 18);
    c.textAlign = 'left'; y += 38;
    c.font = mono(24); c.textAlign = 'center';
    c.fillText(stamp, W / 2, y + 18); c.textAlign = 'left'; y += 52;

    mid(RECEIPT.foot, cjk(26), 20);
  };

  loadImg(meme?.src).then(draw);
}

/* ── 打印：window.print() + 一个纯图打印容器 ─────────────── */
/* Chrome 加 --kiosk-printing 启动参数就不会弹系统对话框，可无人值守。 */

function doPrint(){
  setPrintState('printing');
  const img = $('#printImg');
  img.onload = () => {
    try {
      window.print();
      setPrintState('done');
    } catch (e){ console.error(e); setPrintState('fail'); }
  };
  img.onerror = () => setPrintState('fail');
  try { img.src = $('#out').toDataURL('image/png'); }
  catch (e){ console.error(e); setPrintState('fail'); }
}


/* ── 9. 覆盖层 ───────────────────────────────────────────── */

function drawOverlay(res){
  const W = ov.width, H = ov.height;
  octx.clearRect(0, 0, W, H);
  const lm = res?.faceLandmarks?.[0];
  if (!lm) return;
  const hot = S.shown >= T.thr;
  let x0=1,y0=1,x1=0,y1=0;
  for (const p of lm){ x0=Math.min(x0,p.x); y0=Math.min(y0,p.y); x1=Math.max(x1,p.x); y1=Math.max(y1,p.y); }
  octx.strokeStyle = hot ? '#CEEF52' : 'rgba(237,233,223,.3)'; octx.lineWidth = 2;
  octx.strokeRect(x0*W, y0*H, (x1-x0)*W, (y1-y0)*H);
  octx.fillStyle = hot ? 'rgba(206,239,82,.85)' : 'rgba(237,233,223,.35)';
  for (let i = 0; i < lm.length; i += 9) octx.fillRect(lm[i].x*W-1, lm[i].y*H-1, 2, 2);
}

/* ── 10. UI ──────────────────────────────────────────────── */

let shownMeme = null;
function setTarget(m){
  if (m === shownMeme) return;
  shownMeme = m;
  $('#tgtImg').src = m.src;
  $('#tgtName').textContent = m.name;
  $('#tgtWrap').classList.remove('empty');
  $('#tgtWrap').classList.add('pop');
  setTimeout(() => $('#tgtWrap').classList.remove('pop'), 260);
}
function showIdle(note){
  const el = $('#score'), m = $('#meter');
  el.innerHTML = `<span class="idle">${note}</span>`;
  el.classList.remove('hit'); m.classList.remove('hit');
  m.querySelector('b').style.width = '0%';
  if (note === '做个表情试试'){
    shownMeme = null;
    $('#tgtWrap').classList.add('empty');
    $('#tgtName').textContent = '还没匹配';
  }
}
function setScore(v){
  const el = $('#score'), m = $('#meter'), hit = v >= T.thr;
  el.innerHTML = `${v.toFixed(0)}<sup>%</sup>`;
  el.classList.toggle('hit', hit); m.classList.toggle('hit', hit);
  m.querySelector('b').style.width = clamp(v, 0, 100) + '%';
}

/* 实时排行：看清楚它在哪几张之间犹豫 —— 调迟滞用的 */
function paintRank(r){
  const top = r.rank.slice(0, 6);
  $('#rank').innerHTML = top.map(({ m, d }) => {
    const on = m === matched, p = pctOf(d);
    return `<div class="rk${on ? ' on' : ''}">
      <img src="${m.src}" alt="">
      <span>${m.name}</span>
      <div class="track"><i style="width:${clamp(p,0,100)}%"></i></div>
      <em>${p.toFixed(0)}</em></div>`;
  }).join('');
  $('#blankLine').textContent = `离面无表情 ${r.dB.toFixed(3)}　闸门 ${(r.dB * T.blank).toFixed(3)} vs 最近 ${r.rank[0].d.toFixed(3)}`;
}

function renderLib(){
  let weak = 0;
  $('#lib').innerHTML = LIB.map(m => {
    const dead = libReady && !m.vec, st = strengthOf(m), soft = st !== null && st < .25;
    if (soft) weak++;
    return `<button class="card${dead ? ' dead' : ''}" data-id="${m.id}"
        title="${dead ? '提取不到人脸，用不了'
                     : `${m.name}${st ? `　强度 ${st.toFixed(2)}` : ''}${soft ? '（偏淡，容易误判成它）' : ''}`}">
      <img src="${m.src}" alt="${m.name}" loading="lazy"><span>${m.name}</span>
      ${dead ? '<u>×</u>' : ''}${m.custom ? '<b>我的</b>' : ''}${soft ? '<s></s>' : ''}
    </button>`;
  }).join('');
  $('#libInfo').textContent = libReady
    ? `${LIB.filter(m => m.vec).length}/${LIB.length} 可用${weak ? ` · ${weak} 张偏淡` : ''}`
    : `${LIB.length} 张待命`;
}

function log(ok, sc, meme, now){
  const box = $('#log');
  if (box.firstChild?.dataset?.empty) box.innerHTML = '';
  const d = new Date(), row = document.createElement('div');
  row.innerHTML = `<span>${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}</span>
    <span style="flex:1">${meme?.name || '—'}</span>
    ${ok ? `<b>${sc.toFixed(1)}%</b>` : `<s>中断 ${sc.toFixed(0)}%</s>`}
    <span>${((now - S.roundStart)/1000).toFixed(1)}s</span>`;
  box.prepend(row);
  S.roundStart = now;
}

function renderTune(){
  $('#tune').innerHTML = KNOBS.map(n =>
    `<div class="knob" title="${n.tip || ''}">
       <label for="k-${n.k}">${n.label}</label><output id="o-${n.k}">${T[n.k]}</output>
       <input id="k-${n.k}" type="range" min="${n.min}" max="${n.max}" step="${n.step}" value="${T[n.k]}">
     </div>`).join('');
  KNOBS.forEach(n => $('#k-' + n.k).addEventListener('input', e => {
    T[n.k] = +e.target.value; $('#o-' + n.k).textContent = e.target.value; saveTune();
    if (n.k === 'thr') $('#tick').style.left = T.thr + '%';
  }));
}

let toastT = 0;
function toast(msg){
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 2600);
}

/* ── 11. 拖入自己的表情包 ────────────────────────────────── */

/* 批量入库。三种结果：
     收下 / 提取不到人脸（卡通动物侧脸）/ 和已有的太像（会让匹配打架，挡掉）
   DUP_MIN 参考实测：现有 12 张里最近的一对是 0.102，低于这个数就该合并成一张。 */
const DUP_MIN = 0.07;

async function addFiles(files){
  if (!still){ toast('先启动摄像头，模型还没加载'); return; }
  const imgs = [...files].filter(f => f.type.startsWith('image/'));
  if (!imgs.length) return;
  let ok = 0, noFace = 0; const dups = [];
  let i = 0;

  for (const f of imgs){
    toast(`处理中 ${++i}/${imgs.length}…`);
    await new Promise(r => setTimeout(r));            // 让 toast 有机会重绘
    const url = URL.createObjectURL(f);
    const img = await loadImg(url);
    URL.revokeObjectURL(url);
    if (!img){ noFace++; continue; }
    const vec = extract(img);
    if (!vec){ noFace++; continue; }

    /* 查重：跟库里任何一张太近就挡掉，否则 60 张会互相打架 */
    let near = null, nd = Infinity;
    for (const m of LIB) if (m.vec){ const d = dist(vec, m.vec); if (d < nd){ nd = d; near = m; } }
    if (nd < DUP_MIN){ dups.push(`${f.name} ≈ ${near.name}`); continue; }

    const s = Math.min(1, 640 / img.width);            // 缩图再存，localStorage 塞不下原图
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    const rec = { id:'my_' + Date.now() + '_' + ok,
                  name:f.name.replace(/\.[^.]+$/, '').slice(0, 10),
                  src:cv.toDataURL('image/jpeg', .8), vec };
    customs.push(rec); LIB.push({ ...rec, code:'MINE', custom:true });
    ok++;
  }
  try { localStorage[CUSTOM_KEY] = JSON.stringify(customs); }
  catch { toast('浏览器存不下了 —— 超过 30 张建议改放 memes/ 文件夹'); }
  renderLib();
  const parts = [`收下 ${ok} 张`];
  if (noFace) parts.push(`${noFace} 张没人脸`);
  if (dups.length) parts.push(`${dups.length} 张重复`);
  toast(parts.join(' · '));
  if (dups.length) console.log('[重复，已挡下]\n' + dups.join('\n'));
}

/* 库体检：两两太近的会让匹配来回跳，60 张时这个必须看 */
function auditLib(){
  const ok = LIB.filter(m => m.vec);
  const pairs = [];
  for (let i = 0; i < ok.length; i++)
    for (let j = i + 1; j < ok.length; j++)
      pairs.push({ a:ok[i].name, b:ok[j].name, d:dist(ok[i].vec, ok[j].vec) });
  pairs.sort((x, y) => x.d - y.d);
  const weak = ok.filter(m => strengthOf(m) < .25).map(m => m.name);
  const tight = pairs.filter(p => p.d < .12);
  console.log(`【表情包库体检】${ok.length} 张可用`);
  console.log(`两两距离：最小 ${pairs[0]?.d.toFixed(3)} / 中位 ${pairs[pairs.length>>1]?.d.toFixed(3)}`);
  console.log(`表情偏淡（<0.25，躺着也能蒙）：${weak.length ? weak.join('、') : '无'}`);
  console.log(`挨太近（<0.12，匹配会来回跳）：${tight.length} 对`);
  tight.slice(0, 15).forEach(p => console.log(`   ${p.a} ↔ ${p.b}  ${p.d.toFixed(3)}`));
  toast(`体检结果见控制台：${tight.length} 对挨太近、${weak.length} 张偏淡`);
}

/* 把 localStorage 里的自定义表情包导成 manifest，方便固化进 memes/ 文件夹 */
function exportManifest(){
  const rows = LIB.filter(m => m.vec).map((m, i) => ({
    file: m.custom ? `custom-${i + 1}.jpg` : m.id,
    name: m.name, code: m.code || `M-${String(i + 1).padStart(2, '0')}`,
  }));
  const blob = new Blob([JSON.stringify({ memes: rows }, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'manifest.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast('manifest 已导出（自定义图仍需手动存进 memes/）');
}

const stage = $('.stage');
['dragenter','dragover'].forEach(ev => document.addEventListener(ev, e => {
  e.preventDefault(); stage.classList.add('drop');
}));
['dragleave','drop'].forEach(ev => document.addEventListener(ev, e => {
  e.preventDefault();
  if (ev === 'dragleave' && e.relatedTarget) return;
  stage.classList.remove('drop');
  if (ev === 'drop') addFiles([...e.dataTransfer.files]);
}));
$('#pick').addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });

/* ── 12. 事件 ────────────────────────────────────────────── */

$('#go').addEventListener('click', boot);
$('#shutter').addEventListener('click', manualShoot);
$('#clearMine').addEventListener('click', () => {
  if (!customs.length) return toast('没有自定义表情包');
  if (!confirm(`删掉 ${customs.length} 张自己加的表情包？`)) return;
  customs = []; localStorage.removeItem(CUSTOM_KEY);
  LIB = LIB.filter(m => !m.custom); renderLib();
});
$('#reset').addEventListener('click', () => {
  KNOBS.forEach(n => T[n.k] = n.def); saveTune(); renderTune(); $('#tick').style.left = T.thr + '%';
});
$('#dump').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(JSON.stringify(T, null, 1)); toast('参数已复制'); }
  catch { console.log(T); toast('见控制台'); }
});
$('#audit').addEventListener('click', auditLib);
$('#export').addEventListener('click', exportManifest);
$('#sh-again').addEventListener('click', () => {
  $('#shot').hidden = true; S.hits = 0; S.roundStart = performance.now(); setState('track');
});
$('#sh-print').addEventListener('click', doPrint);
$('#sh-save').addEventListener('click', () => $('#out').toBlob(b => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = `mimic-${Date.now()}.png`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}, 'image/png'));

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#shot').hidden){ $('#sh-again').click(); return; }
  if (e.key === ' '){ e.preventDefault(); state === 'shot' ? $('#sh-again').click() : manualShoot(); }
});

/* 落地页先把图铺出来，向量等模型加载完再填 */
(async () => {
  try {
    const mf = await (await fetch('./memes/manifest.json')).json();
    LIB = mf.memes.map(e => ({ id:e.file, name:e.name, code:e.code, src:'./memes/' + e.file, vec:null }));
    for (const c of customs) LIB.push({ ...c, code:'MINE', custom:true });
    renderLib();
  } catch {}
})();

renderTune(); setState('idle');
$('#tick').style.left = T.thr + '%';

window.__mimic = {
  T, dist, match, pctOf, auditLib,
  get LIB(){ return LIB; }, get matched(){ return matched; }, get vec(){ return S.smooth; },
  /* 没摄像头也能预览小票版式：__mimic.demoShot() */
  demoShot(memeId){
    const m = LIB.find(x => x.id === memeId) || LIB.find(x => x.src) || LIB[0];
    bestCv.width = 960; bestCv.height = 720;
    const c = bestCv.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, 720);
    g.addColorStop(0, '#c9c4b8'); g.addColorStop(1, '#6e6a61');
    c.fillStyle = g; c.fillRect(0, 0, 960, 720);
    c.fillStyle = '#3a3733'; c.font = '600 64px "PingFang SC", sans-serif';
    c.textAlign = 'center'; c.fillText('（示意：摄像头画面）', 480, 380);
    lastShot = { score:91.4, meme:m, at:new Date(), manual:false, no:++serial };
    openSheet(); setState('shot');
  },
};
