/* ──────────────────────────────────────────────────────────────
   素材管理台

   上传时在浏览器里跑一次 FaceLandmarker + PoseLandmarker，把「表情」和
   「动作」两路向量算好一并存进 manifest —— 服务端不跑推理，保持零依赖，
   装置启动时也不用每次重算。
   ────────────────────────────────────────────────────────────── */

import { FilesetResolver, FaceLandmarker, PoseLandmarker }
  from './vendor/tasks-vision/vision_bundle.mjs';

const $ = s => document.querySelector(s);

/* 远程部署时写接口要带 token。只放 sessionStorage —— 关掉标签页就没了，
   不落 localStorage，免得留在别人用过的机器上。 */
const tok = {
  get: () => sessionStorage.mimicToken || '',
  set: v => { v ? sessionStorage.mimicToken = v : delete sessionStorage.mimicToken; },
};
async function api(url, opt = {}){
  const o = { ...opt, headers:{ ...(opt.headers || {}) } };
  const t = tok.get();
  if (t) o.headers['X-Admin-Token'] = t;
  const r = await fetch(url, o);
  if (r.status === 401){
    const v = prompt('这台服务器需要管理 token：');
    if (v){ tok.set(v); return api(url, opt); }
  }
  return r;
}

/* 与 app.js 保持一致：剔掉 _neutral / eyeLook*（眼球朝向）/ eyeBlink*（瞬时） */
const DROPBS = n => n === '_neutral' || n.startsWith('eyeLook') || n.startsWith('eyeBlink');
let KEEP = null;
const PP = [0, 11, 12, 13, 14, 15, 16], VIS = .45;

let face = null, pose = null, ready = false;
let LIST = [];

/* ── 特征提取（与 app.js 同款，改动要两边一起改）─────────── */

function faceVec(res){
  const bs = res?.faceBlendshapes?.[0]?.categories;
  if (!bs) return null;
  if (!KEEP) KEEP = bs.map((c, i) => ({ name:c.categoryName, i })).filter(o => !DROPBS(o.name));
  return KEEP.map(o => bs[o.i].score);
}
function poseVec(res){
  const lm = res?.landmarks?.[0];
  if (!lm) return null;
  const L = lm[11], R = lm[12];
  if ((L.visibility ?? 1) < VIS || (R.visibility ?? 1) < VIS) return null;
  if (!((lm[15].visibility ?? 1) > VIS || (lm[16].visibility ?? 1) > VIS)) return null;
  const cx = (L.x + R.x) / 2, cy = (L.y + R.y) / 2;
  const sw = Math.hypot(L.x - R.x, L.y - R.y) + 1e-6;
  return PP.flatMap(i => [(lm[i].x - cx) / sw, (lm[i].y - cy) / sw]);
}
function faceDist(u, t){
  let num = 0, den = 0;
  for (let i = 0; i < u.length; i++){
    const w = .3 + Math.max(t[i], u[i]), d = u[i] - t[i];
    num += w * d * d; den += w;
  }
  return Math.sqrt(num / den);
}
const rms = (u, t) => {
  let s = 0;
  for (let i = 0; i < u.length; i++){ const d = u[i] - t[i]; s += d * d; }
  return Math.sqrt(s / u.length);
};

/* ── 模型 ────────────────────────────────────────────────── */

async function initModels(){
  const files = await FilesetResolver.forVisionTasks('./vendor/tasks-vision/wasm');
  const mk = async (Cls, path, extra) => {
    const b = { modelAssetPath:path, delegate:'GPU' };
    const o = { runningMode:'IMAGE', ...extra };
    try { return await Cls.createFromOptions(files, { baseOptions:b, ...o }); }
    catch { return await Cls.createFromOptions(files, { baseOptions:{ ...b, delegate:'CPU' }, ...o }); }
  };
  [face, pose] = await Promise.all([
    mk(FaceLandmarker, './models/face_landmarker.task',
       { numFaces:1, outputFaceBlendshapes:true, minFaceDetectionConfidence:.15, minFacePresenceConfidence:.15 }),
    mk(PoseLandmarker, './models/pose_landmarker_lite.task',
       { numPoses:1, minPoseDetectionConfidence:.25 }),
  ]);
  /* 预热，首帧要编译 shader */
  const w = document.createElement('canvas'); w.width = 320; w.height = 240;
  w.getContext('2d').fillRect(0, 0, 320, 240);
  face.detect(w); pose.detect(w);
  ready = true;
}

const loadImg = src => new Promise(r => {
  const im = new Image();
  im.onload = () => r(im); im.onerror = () => r(null); im.src = src;
});

/* ── 上传 ────────────────────────────────────────────────── */

const log = (msg, cls = '') => {
  const d = document.createElement('div');
  d.className = cls; d.textContent = msg;
  $('#log').prepend(d);
};

async function addFiles(files){
  const imgs = [...files].filter(f => f.type.startsWith('image/'));
  if (!imgs.length) return;
  if (!ready){ log('模型还在加载，稍等一下再拖', 'no'); return; }

  let ok = 0, no = 0, dup = 0, i = 0;
  for (const f of imgs){
    const tag = `[${++i}/${imgs.length}] ${f.name}`;
    const url = URL.createObjectURL(f);
    const img = await loadImg(url);
    URL.revokeObjectURL(url);
    if (!img){ log(`${tag} 读不出来`, 'no'); no++; continue; }

    const fv = faceVec(face.detect(img));
    const pv = poseVec(pose.detect(img));
    if (!fv && !pv){ log(`${tag} 提取不到人脸和姿势 —— 卡通/动物/侧脸用不了`, 'no'); no++; continue; }

    /* 查重：太近的两张会让匹配来回跳 */
    if (fv){
      let near = null, nd = Infinity;
      for (const e of LIST) if (e.face){ const d = faceDist(fv, e.face); if (d < nd){ nd = d; near = e; } }
      if (nd < .07){ log(`${tag} 和「${near.name}」太像（${nd.toFixed(3)}），跳过`, 'no'); dup++; continue; }
    }

    /* 压到 720 宽再存，原图没必要 */
    const s = Math.min(1, 720 / img.width);
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);

    const name = f.name.replace(/\.[^.]+$/, '').slice(0, 12) || `表情${LIST.length + 1}`;
    const r = await api('/api/memes', {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ name, dataUrl: cv.toDataURL('image/jpeg', .86), face: fv, pose: pv }),
    });
    if (!r.ok){ log(`${tag} 存盘失败：${(await r.json()).error}`, 'no'); no++; continue; }

    const ch = [fv ? '表情' : null, pv ? '动作' : null].filter(Boolean).join('+');
    log(`${tag} 已入库（${ch}）`, 'ok');
    ok++;
    await refresh();
  }
  log(`—— 完成：收下 ${ok}，跳过 ${no + dup}（${no} 不可用 / ${dup} 重复）`, 'dim');
}

/* 回填：老条目（手写进 manifest 的）没有向量，逐张补算并写回 */
async function backfill(){
  if (!ready){ log('模型还在加载', 'no'); return; }
  const todo = LIST.filter(m => !m.face && !m.pose && !m.missing);
  if (!todo.length){ log('没有需要补算的', 'dim'); return; }
  let ok = 0, no = 0, i = 0;
  for (const m of todo){
    const tag = `[${++i}/${todo.length}] ${m.name}`;
    const img = await loadImg('./memes/' + encodeURIComponent(m.file));
    if (!img){ log(`${tag} 图读不出来`, 'no'); no++; continue; }
    const fv = faceVec(face.detect(img));
    const pv = poseVec(pose.detect(img));
    if (!fv && !pv){ log(`${tag} 提取不到人脸和姿势`, 'no'); no++; continue; }
    await api(`/api/memes/${encodeURIComponent(m.file)}`, {
      method:'PATCH', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ face: fv, pose: pv }),
    });
    log(`${tag} 已补算（${[fv?'表情':null, pv?'动作':null].filter(Boolean).join('+')}）`, 'ok');
    ok++;
  }
  log(`—— 补算完成：${ok} 成功，${no} 不可用`, 'dim');
  refresh();
}

/* ── 从 harvest 批量筛选导入 ─────────────────────────────── */
/* 三道关：能不能提取出向量 → 表情/动作够不够夸张 → 跟已有的重不重 */

const TERM_CN = {
  'shocked face':'震惊', 'surprised face':'吃惊', 'screaming person':'尖叫',
  'angry face':'愤怒', 'laughing out loud':'大笑', 'crying face':'哭',
  'silly face':'鬼脸', 'funny face':'搞怪', 'grimace':'龇牙',
  'tongue out':'吐舌', 'wink':'眨眼', 'yawning':'打哈欠',
  'excited person':'兴奋', 'frustrated face':'抓狂', 'thinking pose':'思考',
  'facepalm':'扶额', 'thumbs up person':'点赞', 'shrug':'摊手',
  'pointing person':'指人', 'hands on head':'抱头',
};
const MIN_STRENGTH = .25;   /* 低于此值的表情会被装置的「摆烂闸门」压住，收了也没用 */

async function importHarvest(){
  if (!ready){ log('模型还在加载', 'no'); return; }
  const r = await fetch('/api/harvest');
  const { files } = await r.json();
  if (!files.length){ log('harvest/ 是空的，先跑 node tools/harvest.mjs', 'no'); return; }

  log(`harvest 里有 ${files.length} 张候选，开始筛…`, 'dim');
  const NEU = KEEP ? new Array(KEEP.length).fill(0) : null;
  const accepted = [];                       // 本轮已收，用于组内互查重
  let noVec = 0, weak = 0, dup = 0, ok = 0, i = 0;

  for (const f of files){
    if (++i % 20 === 0) log(`…已处理 ${i}/${files.length}`, 'dim');
    const img = await loadImg('./harvest/' + encodeURIComponent(f.file));
    if (!img){ noVec++; continue; }

    const fv = faceVec(face.detect(img));
    const pv = poseVec(pose.detect(img));
    if (!fv && !pv){ noVec++; continue; }

    /* 表情强度：离「面无表情」多远。太淡的收了也会被闸门压住 */
    const strength = (fv && NEU) ? faceDist(fv, NEU) : 0;
    if (!pv && strength < MIN_STRENGTH){ weak++; continue; }

    if (fv){
      const pool = [...LIST.filter(e => e.face).map(e => e.face), ...accepted];
      let nd = Infinity;
      for (const v of pool) nd = Math.min(nd, faceDist(fv, v));
      if (nd < .09){ dup++; continue; }      // 组内查重比单张严一点
    }

    const s = Math.min(1, 720 / img.width);
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);

    const base = TERM_CN[f.term] || f.term || '表情';
    const name = `${base}${accepted.filter(Boolean).length ? '' : ''}`.slice(0, 12);
    const resp = await api('/api/memes', {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ name, dataUrl: cv.toDataURL('image/jpeg', .86), face: fv, pose: pv }),
    });
    if (!resp.ok){ noVec++; continue; }
    if (fv) accepted.push(fv);
    log(`收下「${name}」 强度 ${strength.toFixed(2)} ${[fv?'表情':null, pv?'动作':null].filter(Boolean).join('+')}`, 'ok');
    ok++;
  }
  log(`—— 筛完：收下 ${ok}／候选 ${files.length}　（提不出向量 ${noVec}，表情太淡 ${weak}，重复 ${dup}）`, 'dim');
  refresh();
}

/* ── 列表 ────────────────────────────────────────────────── */

async function refresh(){
  const r = await fetch('/api/memes');
  const d = await r.json();
  LIST = d.memes || [];

  const nf = LIST.filter(m => m.face).length, np = LIST.filter(m => m.pose).length;
  const need = LIST.filter(m => !m.face && !m.pose && !m.missing).length;
  $('#stat').innerHTML = `共 <em>${LIST.length}</em> 张　表情 <em>${nf}</em>　动作 <em>${np}</em>`;
  $('#backfill').hidden = need === 0;
  $('#backfill').textContent = `补算 ${need} 张缺向量的`;
  $('#count').textContent = `${LIST.length} 张`;
  $('#empty').hidden = LIST.length > 0;

  $('#grid').innerHTML = LIST.map(m => {
    const badges = [
      m.face ? '<span class="b face">表情</span>' : '',
      m.pose ? '<span class="b pose">动作</span>' : '',
      (!m.face && !m.pose) ? '<span class="b none">无向量</span>' : '',
    ].join('');
    return `<div class="card${m.missing ? ' missing' : ''}" data-file="${m.file}">
      <div class="thumb">${m.missing ? '文件丢了'
        : `<img src="./memes/${encodeURIComponent(m.file)}" alt="" loading="lazy">`}
        <div class="badges">${badges}</div></div>
      <div class="body">
        <input value="${(m.name || '').replace(/"/g,'&quot;')}" maxlength="20" data-name>
        <div class="meta" title="${m.file}">${m.code || ''} · ${m.file}</div>
        <div class="row">
          <button class="btn sm" data-save>改名</button>
          <button class="btn sm danger" data-del>删除</button>
        </div>
      </div></div>`;
  }).join('');

  audit();
}

/* 库体检：挨太近的会让匹配来回跳，表情太淡的会被闸门压住 */
function audit(){
  const el = $('#audit');
  const withFace = LIST.filter(m => m.face), withPose = LIST.filter(m => m.pose);
  if (!withFace.length && !withPose.length){ el.textContent = '还没有素材。'; return; }

  const NEU = withFace.length ? new Array(withFace[0].face.length).fill(0) : null;
  const fp = [], pp = [];
  for (let i = 0; i < withFace.length; i++) for (let j = i + 1; j < withFace.length; j++)
    fp.push({ a:withFace[i].name, b:withFace[j].name, d:faceDist(withFace[i].face, withFace[j].face) });
  for (let i = 0; i < withPose.length; i++) for (let j = i + 1; j < withPose.length; j++)
    pp.push({ a:withPose[i].name, b:withPose[j].name, d:rms(withPose[i].pose, withPose[j].pose) });
  fp.sort((x, y) => x.d - y.d); pp.sort((x, y) => x.d - y.d);

  const weak = NEU ? withFace.filter(m => faceDist(m.face, NEU) < .25).map(m => m.name) : [];
  const tightF = fp.filter(p => p.d < .12), tightP = pp.filter(p => p.d < .18);
  const line = (t, v, bad) => `<div${bad ? ' class="hit"' : ''}>${t}：${v}</div>`;

  el.innerHTML =
    line('可用', `表情 ${withFace.length} 张 · 动作 ${withPose.length} 张`) +
    (fp.length ? line('表情两两距离', `最小 ${fp[0].d.toFixed(3)} · 中位 ${fp[fp.length>>1].d.toFixed(3)}`) : '') +
    (pp.length ? line('动作两两距离', `最小 ${pp[0].d.toFixed(3)} · 中位 ${pp[pp.length>>1].d.toFixed(3)}`) : '') +
    line('表情偏淡（躺着也能蒙）', weak.length ? weak.join('、') : '无', weak.length > 0) +
    line('表情挨太近（匹配会跳）', tightF.length ? tightF.slice(0,6).map(p=>`${p.a}↔${p.b} ${p.d.toFixed(3)}`).join('　') : '无', tightF.length > 0) +
    line('动作挨太近', tightP.length ? tightP.slice(0,6).map(p=>`${p.a}↔${p.b} ${p.d.toFixed(3)}`).join('　') : '无', tightP.length > 0) +
    (LIST.length > 30 ? '<div class="hit">超过 30 张：表情空间就那么大，张数越多匹配越糊，建议精简</div>' : '');
}

/* ── 事件 ────────────────────────────────────────────────── */

$('#grid').addEventListener('click', async e => {
  const card = e.target.closest('.card'); if (!card) return;
  const file = card.dataset.file;
  if (e.target.matches('[data-del]')){
    if (!confirm(`删掉「${card.querySelector('[data-name]').value}」？文件也会一起删。`)) return;
    await api(`/api/memes/${encodeURIComponent(file)}`, { method:'DELETE' });
    refresh();
  }
  if (e.target.matches('[data-save]')){
    const name = card.querySelector('[data-name]').value.trim();
    await api(`/api/memes/${encodeURIComponent(file)}`, {
      method:'PATCH', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ name }),
    });
    refresh();
  }
});

$('#pick').addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });
$('#backfill').addEventListener('click', backfill);
$('#harvest').addEventListener('click', importHarvest);
const drop = $('#drop');
['dragenter','dragover'].forEach(ev => document.addEventListener(ev, e => {
  e.preventDefault(); drop.classList.add('on');
}));
['dragleave','drop'].forEach(ev => document.addEventListener(ev, e => {
  e.preventDefault();
  if (ev === 'dragleave' && e.relatedTarget) return;
  drop.classList.remove('on');
  if (ev === 'drop') addFiles([...e.dataTransfer.files]);
}));

refresh();
initModels()
  .then(() => log('模型就绪，可以拖图了', 'dim'))
  .catch(e => log('模型加载失败：' + e.message, 'no'));
