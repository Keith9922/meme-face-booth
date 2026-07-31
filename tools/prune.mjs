/* ──────────────────────────────────────────────────────────────
   库清理：把采集来的候选压成一个真正能用的库。

   四条规则，按顺序：
     1. 重复      —— 表情距离 <0.09 或 动作距离 <0.12（同一张图会是 0.000）
     2. 太淡      —— 没有动作向量、且表情强度 <0.25，会被装置的摆烂闸门压住
     3. 同名扎堆  —— 同一个搜索词最多留 2 张，否则「指人」能占 7 个坑
     4. 上限      —— 人脸表情空间就那么大，超过 30 张匹配会来回横跳

   用法：node tools/prune.mjs          只报告，不动文件
        node tools/prune.mjs --apply  真删
   ────────────────────────────────────────────────────────────── */

import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const MEMES = join(process.cwd(), 'memes');
const MANIFEST = join(MEMES, 'manifest.json');
const APPLY = process.argv.includes('--apply');

const DUP_FACE = .09, DUP_POSE = .12, MIN_STRENGTH = .25, PER_NAME = 2, MAX_TOTAL = 30;

const faceDist = (u, t) => {
  let n = 0, s = 0;
  for (let i = 0; i < u.length; i++){
    const w = .3 + Math.max(u[i], t[i]), d = u[i] - t[i];
    n += w * d * d; s += w;
  }
  return Math.sqrt(n / s);
};
const rms = (u, t) => {
  let s = 0;
  for (let i = 0; i < u.length; i++){ const d = u[i] - t[i]; s += d * d; }
  return Math.sqrt(s / u.length);
};

const m = JSON.parse(await readFile(MANIFEST, 'utf8'));
const all = m.memes;
const NEU = all.find(x => x.face) ? new Array(all.find(x => x.face).face.length).fill(0) : null;

/* 好素材优先留：既有表情又有动作 > 只有表情 > 只有动作；同档按表情强度排 */
const score = e => (e.face ? 2 : 0) + (e.pose ? 1 : 0)
                 + (e.face && NEU ? faceDist(e.face, NEU) : 0);
const sorted = [...all].sort((a, b) => score(b) - score(a));

const keep = [], drop = [];
const nameCount = {};

for (const e of sorted){
  if (keep.length >= MAX_TOTAL){ drop.push([e, `超过 ${MAX_TOTAL} 张上限`]); continue; }

  let dupOf = null;
  for (const k of keep){
    if (e.face && k.face && faceDist(e.face, k.face) < DUP_FACE){ dupOf = k; break; }
    if (e.pose && k.pose && rms(e.pose, k.pose) < DUP_POSE){ dupOf = k; break; }
  }
  if (dupOf){ drop.push([e, `与「${dupOf.name}」重复`]); continue; }

  if (!e.pose && e.face && NEU && faceDist(e.face, NEU) < MIN_STRENGTH){
    drop.push([e, `表情太淡 ${faceDist(e.face, NEU).toFixed(2)}`]); continue;
  }
  const base = (e.name || '').replace(/\d+$/, '');
  if ((nameCount[base] = (nameCount[base] || 0) + 1) > PER_NAME){
    drop.push([e, `「${base}」已有 ${PER_NAME} 张`]); continue;
  }
  keep.push(e);
}

console.log(`原有 ${all.length} 张 → 保留 ${keep.length}，删除 ${drop.length}\n`);
const why = {};
for (const [, r] of drop){ const k = r.replace(/「[^」]*」/, '「…」'); why[k] = (why[k] || 0) + 1; }
console.log('删除原因统计:');
for (const [k, v] of Object.entries(why).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);

console.log('\n保留的:');
for (const e of keep){
  const st = e.face && NEU ? faceDist(e.face, NEU).toFixed(2) : ' — ';
  console.log(`  ${e.name.padEnd(8)} 强度 ${st}  ${e.face ? '表情' : '　　'}${e.pose ? '+动作' : ''}`);
}

if (!APPLY){ console.log('\n（这是预演。真删加 --apply）'); process.exit(0); }

m.memes = keep;
await writeFile(MANIFEST, JSON.stringify(m, null, 2) + '\n');
let n = 0;
for (const [e] of drop){ try { await unlink(join(MEMES, e.file)); n++; } catch {} }
console.log(`\n已删除 ${n} 个文件，清单剩 ${keep.length} 条。`);
