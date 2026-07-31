/* ──────────────────────────────────────────────────────────────
   表情复刻机 · Mimic Photo Booth

   对着镜头做表情/动作 → 实时匹配最像的表情包 → 够像了 3-2-1 自动拍 → 展示结果。
   无需任何设置和调参，插电即用。

   双通道匹配（两条各自独立，任意一条达标就拍）：
     表情通道  41 维 blendshapes            —— 脸做得像不像
     动作通道  14 维肩宽归一化上半身关键点  —— 姿势摆得像不像（抱头/托腮/T字手…）
   两条的目标都从表情包图片自动提取，不用录制、不用标注。

   动作通道左右镜像容忍：你抬右手、图里抬左手，照样算像。

   全部本机运行，断网可用，不上传任何数据。
   ────────────────────────────────────────────────────────────── */

import { FilesetResolver, FaceLandmarker, PoseLandmarker }
  from './vendor/tasks-vision/vision_bundle.mjs';

const $ = s => document.querySelector(s);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const DEV = new URLSearchParams(location.search).has('dev');

/* ── 1. 参数 ─────────────────────────────────────────────── */
/* 这些是定死的产品参数，不再暴露给现场。?dev=1 打开调参面板做二次标定。 */

const P = {
  /* 表情通道：加权 RMS 距离 → 分数。实测 12 张表情包两两距离
     最小 .102 / 中位 .367 / 最大 .516                              */
  eD0: .005, eD1: .52,        // 比之前放宽（.44 → .52）
  /* 动作通道：肩宽为单位的 RMS 距离。实测 8 张有动作的表情包两两
     最小 .130 / 中位 .399 / 最大 .837 —— 所以 d1 必须压到 .60，
     否则"两个完全不同的姿势"也能拿 65 分，站着不动就误触发。      */
  pD0: .08,  pD1: .60,
  blank: 1.0,                 // 摆烂闸门：脸离"面无表情"太近 → 表情分打折
  lazy:  1.0,                 // 躺平闸门：身体离"自然站姿"太近 → 动作分打折
  stick: .88,                 // 换图迟滞：新候选要比当前近这么多倍才准换
  thr: 80,                    // 触发阈值 %
  hold: 7,                    // 去抖：同一张连续命中帧数
  alpha: .4,                  // 特征平滑
  cd: 3,                      // 倒计时秒
  abort: 14,                  // 倒计时中掉到 阈值-此值 以下则中断
  resultMs: 14000,            // 结果页自动返回待机
};
if (DEV) { try { Object.assign(P, JSON.parse(localStorage.mimicP || '{}')); } catch {} }
const saveP = () => localStorage.mimicP = JSON.stringify(P);

/* ── 2. 表情通道 ─────────────────────────────────────────── */
/* 52 维 blendshapes 剔掉：_neutral（不是表情）、eyeLook*（眼球朝向，
   不是表情且用户没法复刻）、eyeBlink*（瞬时动作，眯眼 eyeSquint 保留）。 */
const DROPBS = n => n === '_neutral' || n.startsWith('eyeLook') || n.startsWith('eyeBlink');
let KEEP = null, NEU = null;

function faceVec(res){
  const bs = res?.faceBlendshapes?.[0]?.categories;
  if (!bs) return null;
  if (!KEEP){
    KEEP = bs.map((c, i) => ({ name:c.categoryName, i })).filter(o => !DROPBS(o.name));
    NEU = KEEP.map(() => 0);
  }
  return KEEP.map(o => bs[o.i].score);
}

/* 加权 RMS：目标在意的维度权重高，你多做出来的动作也一样被罚 */
function faceDist(u, t){
  let num = 0, den = 0;
  for (let i = 0; i < u.length; i++){
    const w = .3 + Math.max(t[i], u[i]), d = u[i] - t[i];
    num += w * d * d; den += w;
  }
  return Math.sqrt(num / den);
}

/* ── 3. 动作通道 ─────────────────────────────────────────── */
/* 以两肩中点为原点、肩宽为单位归一化 —— 远近和身高自动无关。
   取鼻 / 双肩 / 双肘 / 双腕，正好覆盖「手在身体哪个位置」这件事。   */
const PP  = [0, 11, 12, 13, 14, 15, 16];
const PPM = [0, 12, 11, 14, 13, 16, 15];      // 左右互换，用于镜像容忍
const VIS = 0.45;

function poseVecs(res){
  const lm = res?.landmarks?.[0];
  if (!lm) return null;
  const L = lm[11], R = lm[12];
  if ((L.visibility ?? 1) < VIS || (R.visibility ?? 1) < VIS) return null;
  /* 手腕都看不见就没有动作信息可言，别拿一堆噪声去比 */
  const wristSeen = (lm[15].visibility ?? 1) > VIS || (lm[16].visibility ?? 1) > VIS;
  if (!wristSeen) return null;

  const cx = (L.x + R.x) / 2, cy = (L.y + R.y) / 2;
  const sw = Math.hypot(L.x - R.x, L.y - R.y) + 1e-6;
  const mk = idx => {
    const v = [];
    for (const i of idx) v.push((lm[i].x - cx) / sw, (lm[i].y - cy) / sw);
    return v;
  };
  const a = mk(PP);
  const b = mk(PPM);
  for (let i = 0; i < b.length; i += 2) b[i] = -b[i];   // 镜像：x 取反
  return [a, b];
}

const rms = (u, t) => {
  let s = 0;
  for (let i = 0; i < u.length; i++){ const d = u[i] - t[i]; s += d * d; }
  return Math.sqrt(s / u.length);
};
/* 正反两种朝向取更像的那个 */
const poseDist = (uu, t) => Math.min(rms(uu[0], t), rms(uu[1], t));

/* 「自然站姿」基准：双手自然下垂。它是动作通道的竞争对手 ——
   没有它的话，一个手臂放下的表情包会让「站着不动」直接拿高分误触发。
   顺序同 PP：鼻 / 左肩 / 右肩 / 左肘 / 右肘 / 左腕 / 右腕，单位是肩宽。 */
const POSE_NEU = [ 0,-.90,  .50,0,  -.50,0,  .62,.95,  -.62,.95,  .70,1.90,  -.70,1.90 ];

const toScore = (d, d0, d1) => 100 * clamp((d1 - d) / (d1 - d0), 0, 1);

/* ── 4. 表情包库 ─────────────────────────────────────────── */

const CACHE_KEY = 'mimicLib_v5', MINE_KEY = 'mimicMine_v5';
let cache = {}, mine = [];
try { cache = JSON.parse(localStorage[CACHE_KEY] || '{}'); } catch {}
try { mine  = JSON.parse(localStorage[MINE_KEY]  || '[]'); } catch {}
let LIB = [], libReady = false;

/* ── 5. 匹配 ─────────────────────────────────────────────── */
/*  每张表情包两条通道各算一个分，取高的那条当这张的得分。
    任意一条 ≥ 阈值就算达标 —— 脸做到位或者姿势摆到位，都算你赢。   */

let matched = null;

function match(fv, pv){
  /* 两个"什么都没做"的基准，各自当本通道的竞争对手。
     你越接近它，本通道的分打折越狠 —— 摆烂拿不到分。 */
  if (fv && !NEU) NEU = new Array(fv.length).fill(0);   // 兜底：正常由 faceVec 首帧建好
  const dBlank = fv ? faceDist(fv, NEU) : null;
  const dLazy  = pv ? poseDist(pv, POSE_NEU) : null;

  const rank = [];
  for (const m of LIB){
    let e = null, p = null;
    if (fv && m.face){
      const d = faceDist(fv, m.face);
      e = toScore(d, P.eD0, P.eD1) * clamp(dBlank / Math.max(1e-6, d * P.blank), 0, 1);
    }
    if (pv && m.pose){
      const d = poseDist(pv, m.pose);
      p = toScore(d, P.pD0, P.pD1) * clamp(dLazy / Math.max(1e-6, d * P.lazy), 0, 1);
    }
    if (e === null && p === null) continue;
    rank.push({ m, e, p, s: Math.max(e ?? 0, p ?? 0) });
  }
  if (!rank.length) return null;
  rank.sort((a, b) => b.s - a.s);

  if (rank[0].s < 12){ matched = null; return { idle:true, rank }; }

  /* 换图迟滞：相近的两张会疯狂跳，新候选得明显更好才准换 */
  const held = matched && rank.find(r => r.m === matched);
  matched = (held && held.s > 0 && rank[0].s * P.stick < held.s) ? matched : rank[0].m;

  const me = rank.find(r => r.m === matched);
  return { idle:false, meme:matched, show:me.s, e:me.e, p:me.p,
           by: (me.p ?? -1) > (me.e ?? -1) ? 'pose' : 'face', rank };
}

/* ── 6. 模型 ─────────────────────────────────────────────── */

const vid = $('#vid'), ov = $('#ov'), octx = ov.getContext('2d');
let liveF = null, liveP = null, stillF = null, stillP = null, running = false, ts = 0;

const loadImg = src => new Promise(r => {
  const im = new Image();
  im.onload = () => r(im); im.onerror = () => r(null); im.src = src;
});

async function loadLib(say){
  let mf = { memes: [] };
  try { mf = await (await fetch('./memes/manifest.json')).json(); } catch {}
  const out = [];
  let i = 0;
  for (const e of mf.memes){
    say(`读表情包 ${++i}/${mf.memes.length}`);
    const m = { id:e.file, name:e.name, code:e.code, src:'./memes/' + e.file, face:null, pose:null };
    const hit = cache[e.file];
    if (hit){ m.face = hit.face; m.pose = hit.pose; }
    else {
      const img = await loadImg(m.src);
      if (img){
        m.face = faceVec(stillF.detect(img));
        const pv = poseVecs(stillP.detect(img));
        m.pose = pv ? pv[0] : null;                    // 表情包只存正向，镜像在用户侧做
        cache[e.file] = { face:m.face, pose:m.pose };
      }
    }
    if (m.face || m.pose) out.push(m);
    else console.warn(`[跳过] ${e.file}：提取不到人脸也提取不到姿势`);
  }
  try { localStorage[CACHE_KEY] = JSON.stringify(cache); } catch {}
  for (const c of mine) out.push({ ...c, mine:true });
  return out;
}

/* ── 自带表情包 ──────────────────────────────────────────── */
/* 线上版不带素材（版权），谁用谁传自己的图，只存在本机 localStorage。 */

async function addFiles(files){
  const imgs = [...files].filter(f => f.type.startsWith('image/'));
  if (!imgs.length || !stillF) return;
  let ok = 0, bad = 0, dup = 0, i = 0;
  const tip = t => { $('#dropTip').textContent = t; };

  for (const f of imgs){
    tip(`处理中 ${++i}/${imgs.length}…`);
    await new Promise(r => setTimeout(r));
    const url = URL.createObjectURL(f);
    const img = await loadImg(url);
    URL.revokeObjectURL(url);
    if (!img){ bad++; continue; }

    const face = faceVec(stillF.detect(img));
    const pv   = poseVecs(stillP.detect(img));
    const pose = pv ? pv[0] : null;
    if (!face && !pose){ bad++; continue; }

    /* 查重：跟库里任何一张太近就挡掉，否则匹配会来回打架 */
    if (face && LIB.some(m => m.face && faceDist(face, m.face) < .07)){ dup++; continue; }

    const s = Math.min(1, 720 / img.width);
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    const rec = { id:'mine_' + Date.now() + '_' + ok, code:'MINE',
                  name:f.name.replace(/\.[^.]+$/, '').slice(0, 8) || `表情${LIB.length+1}`,
                  src:cv.toDataURL('image/jpeg', .82), face, pose };
    mine.push(rec); LIB.push({ ...rec, mine:true });
    ok++;
  }
  try { localStorage[MINE_KEY] = JSON.stringify(mine); }
  catch { tip('浏览器存不下了，删掉一些再传'); return; }

  const parts = [`加了 ${ok} 张`];
  if (bad) parts.push(`${bad} 张提取不到人脸和姿势`);
  if (dup) parts.push(`${dup} 张跟已有的太像`);
  tip(parts.join(' · '));
  refreshLibUI();
}

function refreshLibUI(){
  const n = LIB.length, has = n > 0;
  $('#libCount').textContent = has ? `${n} 张表情包已就位` : '还没有表情包';
  $('#go').disabled = !has;
  $('#go').textContent = has ? '开始' : '先加几张表情包';
  $('#mineWrap').hidden = false;
}

async function boot(){
  const btn = $('#go'); btn.disabled = true;
  const say = t => $('#goTip').textContent = t;
  try {
    say('请求摄像头…');
    vid.srcObject = await navigator.mediaDevices.getUserMedia({
      video:{ width:{ideal:1280}, height:{ideal:960}, facingMode:'user' }, audio:false });
    await vid.play();
    ov.width = vid.videoWidth; ov.height = vid.videoHeight;

    say('加载模型…');
    const files = await FilesetResolver.forVisionTasks('./vendor/tasks-vision/wasm');
    const mk = async (Cls, path, mode, extra) => {
      const b = { modelAssetPath:path, delegate:'GPU' };
      const o = { runningMode:mode, ...extra };
      try { return await Cls.createFromOptions(files, { baseOptions:b, ...o }); }
      catch { return await Cls.createFromOptions(files, { baseOptions:{ ...b, delegate:'CPU' }, ...o }); }
    };
    const F = './models/face_landmarker.task', PO = './models/pose_landmarker_lite.task';
    [liveF, liveP, stillF, stillP] = await Promise.all([
      mk(FaceLandmarker, F,  'VIDEO', { numFaces:1, outputFaceBlendshapes:true, minFaceDetectionConfidence:.5 }),
      mk(PoseLandmarker, PO, 'VIDEO', { numPoses:1, minPoseDetectionConfidence:.5 }),
      mk(FaceLandmarker, F,  'IMAGE', { numFaces:1, outputFaceBlendshapes:true,
                                        minFaceDetectionConfidence:.15, minFacePresenceConfidence:.15 }),
      mk(PoseLandmarker, PO, 'IMAGE', { numPoses:1, minPoseDetectionConfidence:.25 }),
    ]);

    /* 预热：首帧要编译 GPU shader，实测能卡 5 秒，在加载页里烧掉 */
    say('预热…');
    const w = document.createElement('canvas'); w.width = 640; w.height = 480;
    w.getContext('2d').fillRect(0, 0, 640, 480);
    for (let i = 1; i <= 3; i++){
      liveF.detectForVideo(w, i); liveP.detectForVideo(w, i);
      await new Promise(r => setTimeout(r, 0));
    }
    stillF.detect(w); stillP.detect(w);
    ts = 16;

    LIB = await loadLib(say);
    libReady = true;
    renderDev();
    say('');

    /* 库是空的不算错误 —— 线上版本来就不带素材，让人现场传自己的图 */
    if (!LIB.length){
      $('#veilBody').innerHTML =
        '这个版本不自带表情包素材。<br>把你自己的表情包图片拖进来，或点下面选文件。<br>' +
        '<b style="color:var(--ink-3);font-weight:400">图片只存在你本机浏览器里，不会上传。</b>';
      refreshLibUI();
      return;
    }
    refreshLibUI();
    start();
  } catch (e){
    const v = $('#veil');
    v.hidden = false; v.classList.add('err');
    $('#veilTitle').textContent = '起不来';
    $('#veilBody').innerHTML =
      (e.name === 'NotAllowedError' ? '摄像头权限被拒绝，去浏览器设置里放行后刷新。'
       : e.name === 'NotFoundError' ? '没找到摄像头。'
       : String(e.message || e)) +
      '<br><br><code>getUserMedia</code> 只在 https 或 localhost 下可用。';
    btn.textContent = '重试'; btn.disabled = false; say('');
  }
}

function start(){
  if (!LIB.length || running) return;
  $('#veil').hidden = true;
  running = true;
  setState('track');
  requestAnimationFrame(loop);
}

/* ── 7. 状态机 ───────────────────────────────────────────── */

let state = 'idle';
const S = { fs:null, ps:null, hits:0, best:0, bestMeme:null, bestBy:'face',
            cdEnd:0, lowSince:0, shown:0, manual:false, resultT:0 };
const bestCv = document.createElement('canvas');

function setState(s){
  state = s;
  document.body.dataset.state = s;
  $('#count').hidden = s !== 'count';
  $('#frame').classList.toggle('lock', s === 'count');
  clearTimeout(S.resultT);
  if (s === 'result') S.resultT = setTimeout(reset, P.resultMs);
}
function reset(){
  clearTimeout(S.resultT);
  $('#shot').hidden = true;
  S.hits = 0; S.best = 0; S.manual = false;
  setState('track');
}
function manualShoot(){
  if (state !== 'track') return;
  S.manual = true; S.best = 0; S.bestMeme = matched; S.lowSince = 0;
  S.cdEnd = performance.now() + Math.max(1, P.cd) * 1000;
  setState('count');
}

/* ── 8. 主循环 ───────────────────────────────────────────── */

let lastT = -1, fpsN = 0, fpsT = performance.now(), uiT = 0, poseSkip = 0;

function loop(){
  if (!running) return;
  requestAnimationFrame(loop);
  if (vid.readyState < 2 || vid.currentTime === lastT) return;
  lastT = vid.currentTime;

  const now = performance.now();
  ts = Math.max(ts + 1, Math.round(now));

  const fr = liveF.detectForVideo(vid, ts);
  const fv = faceVec(fr);
  /* 姿势隔帧跑：它比人脸慢，而动作变化本来就没表情快 */
  let pr = null;
  if ((poseSkip = (poseSkip + 1) % 2) === 0) pr = liveP.detectForVideo(vid, ts);
  const pv = pr ? poseVecs(pr) : S.lastPv;
  S.lastPv = pv;

  fpsN++;
  if (now - fpsT > 500){
    if (DEV) $('#s-fps').textContent = Math.round(fpsN * 1000 / (now - fpsT));
    fpsN = 0; fpsT = now;
  }
  drawOverlay(fr, pr);

  /* 特征平滑 */
  if (fv) S.fs = S.fs && S.fs.length === fv.length ? S.fs.map((x,i)=>lerp(x,fv[i],P.alpha)) : fv.slice();
  else S.fs = null;
  if (pv) S.ps = S.ps && S.ps[0].length === pv[0].length
    ? [pv[0].map((x,i)=>lerp(S.ps[0][i],x,P.alpha)), pv[1].map((x,i)=>lerp(S.ps[1][i],x,P.alpha))]
    : pv;
  else S.ps = null;

  if (!S.fs && !S.ps){ S.hits = 0; showIdle('没看到人'); return; }

  const r = match(S.fs, S.ps);
  if (!r){ showIdle('表情包库是空的'); return; }

  if (r.idle){
    S.hits = 0; S.shown = 0; showIdle();
    if (state === 'count' && !S.manual) abortShot();
    return;
  }

  S.shown = r.show;
  setTarget(r.meme, r);
  if (DEV && now - uiT > 90){ uiT = now; paintRank(r); }

  if (state === 'track'){
    S.hits = (r.show >= P.thr && r.meme === S.bestMeme) ? S.hits + 1 : (r.show >= P.thr ? 1 : 0);
    S.bestMeme = r.meme;
    if (S.hits >= P.hold){
      S.manual = false; S.best = 0; S.lowSince = 0;
      S.cdEnd = now + P.cd * 1000;
      setState('count');
    }
  } else if (state === 'count'){
    if (r.show > S.best){ S.best = r.show; S.bestMeme = r.meme; S.bestBy = r.by; grabBest(); }
    const left = S.cdEnd - now;
    $('#count').querySelector('b').textContent = Math.max(1, Math.ceil(left / 1000));
    if (!S.manual && r.show < P.thr - P.abort){
      if (!S.lowSince) S.lowSince = now;
      else if (now - S.lowSince > 500) abortShot();
    } else S.lowSince = 0;
    if (left <= 0) capture();
  }
}
function abortShot(){ S.hits = 0; setState('track'); }

/* ── 9. 出片 ─────────────────────────────────────────────── */

function grabBest(){
  bestCv.width = vid.videoWidth; bestCv.height = vid.videoHeight;
  const c = bestCv.getContext('2d');
  c.save(); c.scale(-1, 1); c.drawImage(vid, -bestCv.width, 0); c.restore();
}

let lastShot = null, serial = +(localStorage.mimicSerial || 0);

function capture(){
  if (!S.bestMeme) S.bestMeme = matched || LIB[0];
  if (!bestCv.width) grabBest();
  $('#flash').classList.add('go');
  setTimeout(() => $('#flash').classList.remove('go'), 520);
  localStorage.mimicSerial = ++serial;
  lastShot = { score:S.best, meme:S.bestMeme, by:S.bestBy, at:new Date(), no:serial };

  const d = lastShot.at;
  $('#rName').textContent = lastShot.meme?.name || '?';
  $('#rScore').textContent = lastShot.score.toFixed(0) + '%';
  $('#rBy').textContent = lastShot.by === 'pose' ? '动作神似' : '表情神似';
  $('#rNo').textContent = `NO.${String(serial).padStart(4,'0')}　${d.toLocaleTimeString('zh-CN',{hour12:false})}`;
  makeReceipt();
  $('#shot').hidden = false;
  setState('result');
}

/* ── 10. 竖版小票（打印留到下一步，先把版式定下来）───────── */

const RC = { W:1152, PAD:64, title:'表 情 复 刻 机', sub:'MIMIC PHOTO BOOTH',
             foot:'把这张小票收好　这是你今天的脸' };

function makeReceipt(){
  const cv = $('#out'), c = cv.getContext('2d');
  const { W, PAD } = RC, IW = W - PAD * 2, meme = lastShot.meme;

  loadImg(meme?.src).then(memeImg => {
    const photoH = Math.round(IW * .78), memeH = Math.round(IW * .78);
    const CHROME = 72 + 48 + 40 + 46 + 52 + 46 + 52 + 74 + 92 + 46 + 38 + 52 + 40;
    const H = PAD * 2 + photoH + memeH + CHROME;
    cv.width = W; cv.height = H;

    c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#000'; c.textBaseline = 'alphabetic';
    let y = PAD;
    const mono = (px, w = 400) => `${w} ${px}px "SF Mono", Menlo, monospace`;
    const cjk  = (px, w = 400) => `${w} ${px}px "PingFang SC", sans-serif`;
    const mid = (txt, font, dy) => {
      c.font = font; c.textAlign = 'center'; c.fillText(txt, W/2, y + dy); c.textAlign = 'left';
    };
    const rule = () => {
      c.save(); c.strokeStyle = '#000'; c.lineWidth = 3; c.setLineDash([10, 11]);
      c.beginPath(); c.moveTo(PAD, y + .5); c.lineTo(W - PAD, y + .5); c.stroke(); c.restore();
    };
    const box = (img, h, tag) => {
      c.save(); c.beginPath(); c.rect(PAD, y, IW, h); c.clip();
      if (img){
        const s = Math.max(IW / img.width, h / img.height);
        c.drawImage(img, PAD + (IW - img.width*s)/2, y + (h - img.height*s)/2, img.width*s, img.height*s);
      } else { c.fillStyle = '#ddd'; c.fillRect(PAD, y, IW, h); }
      c.restore();
      c.strokeStyle = '#000'; c.lineWidth = 3; c.strokeRect(PAD+1.5, y+1.5, IW-3, h-3);
      c.font = mono(26, 600);
      const tw = c.measureText(tag).width + 26;
      c.fillStyle = '#000'; c.fillRect(PAD, y, tw, 42);
      c.fillStyle = '#fff'; c.fillText(tag, PAD + 13, y + 30);
      c.fillStyle = '#000'; y += h;
    };

    mid(RC.title, cjk(56, 600), 52);  y += 72;
    mid(RC.sub,   mono(24),      20); y += 48;
    rule();                           y += 40;
    c.font = mono(26, 600); c.fillText('01  YOU', PAD, y + 20);   y += 46;
    box(bestCv, photoH, '你');                                     y += 52;
    c.font = mono(26, 600); c.fillText('02  MATCH', PAD, y + 20); y += 46;
    box(memeImg, memeH, meme?.name || '?');                        y += 52;
    mid(`你是「${meme?.name || '?'}」`, cjk(52, 600), 44);         y += 74;
    mid(`${lastShot.score.toFixed(0)}%`, mono(76, 500), 62);       y += 92;
    rule();                                                        y += 46;

    const d = lastShot.at;
    const stamp = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} `
                + `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
    c.font = mono(24);
    c.fillText(`NO. ${String(lastShot.no).padStart(4,'0')}`, PAD, y + 18);
    c.textAlign = 'right'; c.fillText(lastShot.by === 'pose' ? 'POSE' : 'FACE', W - PAD, y + 18);
    c.textAlign = 'center'; y += 38;
    c.fillText(stamp, W/2, y + 18); c.textAlign = 'left'; y += 52;
    mid(RC.foot, cjk(26), 20);
  });
}

/* ── 11. 覆盖层 ──────────────────────────────────────────── */

const POSE_E = [[11,12],[11,13],[13,15],[12,14],[14,16]];

function drawOverlay(fr, pr){
  const W = ov.width, H = ov.height;
  octx.clearRect(0, 0, W, H);
  const hot = S.shown >= P.thr;
  const lm = fr?.faceLandmarks?.[0];
  if (lm){
    let x0=1,y0=1,x1=0,y1=0;
    for (const p of lm){ x0=Math.min(x0,p.x); y0=Math.min(y0,p.y); x1=Math.max(x1,p.x); y1=Math.max(y1,p.y); }
    octx.strokeStyle = hot ? '#CEEF52' : 'rgba(237,233,223,.28)'; octx.lineWidth = 2;
    octx.strokeRect(x0*W, y0*H, (x1-x0)*W, (y1-y0)*H);
  }
  const pl = pr?.landmarks?.[0];
  if (pl){
    octx.strokeStyle = hot ? 'rgba(206,239,82,.75)' : 'rgba(111,168,199,.45)';
    octx.lineWidth = 4; octx.lineCap = 'round';
    octx.beginPath();
    for (const [a,b] of POSE_E){
      if ((pl[a].visibility ?? 1) < VIS || (pl[b].visibility ?? 1) < VIS) continue;
      octx.moveTo(pl[a].x*W, pl[a].y*H); octx.lineTo(pl[b].x*W, pl[b].y*H);
    }
    octx.stroke();
  }
}

/* ── 12. 界面 ────────────────────────────────────────────── */

let shownMeme = null;
function setTarget(m, r){
  if (m !== shownMeme){
    shownMeme = m;
    $('#tgtImg').src = m.src;
    $('#tgtName').textContent = m.name;
    $('#tgtWrap').classList.remove('empty');
    $('#tgtWrap').classList.add('pop');
    setTimeout(() => $('#tgtWrap').classList.remove('pop'), 260);
  }
  const hit = r.show >= P.thr;
  $('#ring').style.setProperty('--v', clamp(r.show, 0, 100));
  $('#ringNum').textContent = r.show.toFixed(0);
  $('#stage').classList.toggle('hit', hit);
  $('#chFace').style.setProperty('--v', clamp(r.e ?? 0, 0, 100));
  $('#chPose').style.setProperty('--v', clamp(r.p ?? 0, 0, 100));
  $('#chFace').classList.toggle('off', r.e === null);
  $('#chPose').classList.toggle('off', r.p === null);
  $('#tip').textContent = hit
    ? '保持住！'
    : (r.by === 'pose' ? '姿势再摆像一点' : '表情再夸张一点');
}
function showIdle(note){
  shownMeme = null;
  $('#tgtWrap').classList.add('empty');
  $('#tgtName').textContent = '';
  $('#ring').style.setProperty('--v', 0);
  $('#ringNum').textContent = '–';
  $('#chFace').style.setProperty('--v', 0);
  $('#chPose').style.setProperty('--v', 0);
  $('#stage').classList.remove('hit');
  $('#tip').textContent = note || '做个表情，或者摆个动作';
}

/* ── 13. 调试面板（?dev=1）───────────────────────────────── */

const KNOBS = [
  ['thr','触发阈值 %',50,95,1],   ['eD1','表情零分距离',.3,.9,.01],
  ['pD1','动作零分距离',.3,1.2,.02], ['blank','摆烂闸门',.4,2,.05],
  ['lazy','躺平闸门',.4,2,.05],   ['stick','换图迟滞',.6,1,.01],
  ['hold','去抖帧数',1,20,1],
  ['alpha','平滑 α',.05,1,.05],   ['cd','倒计时 秒',0,5,.5],
  ['abort','中断余量 %',0,30,1],
];
function renderDev(){
  if (!DEV) return;
  $('#dev').hidden = false;
  $('#tune').innerHTML = KNOBS.map(([k,l,a,b,st]) =>
    `<div class="knob"><label>${l}</label><output id="o-${k}">${P[k]}</output>
     <input id="k-${k}" type="range" min="${a}" max="${b}" step="${st}" value="${P[k]}"></div>`).join('');
  KNOBS.forEach(([k]) => $('#k-'+k).addEventListener('input', e => {
    P[k] = +e.target.value; $('#o-'+k).textContent = e.target.value; saveP();
  }));
}
function paintRank(r){
  $('#rank').innerHTML = r.rank.slice(0, 6).map(({ m, e, p, s }) =>
    `<div class="rk${m===matched?' on':''}"><img src="${m.src}"><span>${m.name}</span>
     <em>脸 ${e===null?'—':e.toFixed(0)} / 势 ${p===null?'—':p.toFixed(0)}</em>
     <b>${s.toFixed(0)}</b></div>`).join('');
}

/* ── 14. 事件 ────────────────────────────────────────────── */

$('#go').addEventListener('click', () => (libReady ? start() : boot()));
$('#pick').addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });
$('#clearMine').addEventListener('click', () => {
  if (!mine.length) return;
  if (!confirm(`删掉你加的 ${mine.length} 张表情包？`)) return;
  mine = []; localStorage.removeItem(MINE_KEY);
  LIB = LIB.filter(m => !m.mine); refreshLibUI();
});
['dragenter','dragover'].forEach(ev => document.addEventListener(ev, e => {
  e.preventDefault(); if (libReady) document.body.classList.add('drop');
}));
['dragleave','drop'].forEach(ev => document.addEventListener(ev, e => {
  e.preventDefault();
  if (ev === 'dragleave' && e.relatedTarget) return;
  document.body.classList.remove('drop');
  if (ev === 'drop' && libReady) addFiles([...e.dataTransfer.files]);
}));
$('#again').addEventListener('click', reset);
$('#save').addEventListener('click', () => $('#out').toBlob(b => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = `mimic-${lastShot.no}.png`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}, 'image/png'));

document.addEventListener('keydown', e => {
  if (e.key === 'Escape'){ reset(); return; }
  if (e.key === ' '){ e.preventDefault(); state === 'result' ? reset() : manualShoot(); }
});
/* 现场兜底：点画面也能手动触发 */
$('#frame').addEventListener('click', () => { if (state === 'track') manualShoot(); });

setState('idle');
if (DEV) document.body.classList.add('dev');

window.__mimic = {
  P, get LIB(){ return LIB; }, get matched(){ return matched; }, match,
  faceDist, poseDist, poseVecs, toScore,
  clearCache(){ localStorage.removeItem(CACHE_KEY); location.reload(); },
  audit(){
    const f = LIB.filter(m => m.face), p = LIB.filter(m => m.pose);
    console.log(`库共 ${LIB.length} 张：有表情向量 ${f.length}、有动作向量 ${p.length}`);
    const pair = [];
    for (let i=0;i<f.length;i++) for (let j=i+1;j<f.length;j++)
      pair.push({ a:f[i].name, b:f[j].name, d:faceDist(f[i].face, f[j].face) });
    pair.sort((x,y)=>x.d-y.d);
    console.log('表情最接近的 5 对（<0.12 会来回跳）:');
    pair.slice(0,5).forEach(x=>console.log(`  ${x.a} ↔ ${x.b}  ${x.d.toFixed(3)}`));
    console.log('无动作向量（图里看不到上半身）:', LIB.filter(m=>!m.pose).map(m=>m.name).join('、') || '无');
  },
};
