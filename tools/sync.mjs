/* ──────────────────────────────────────────────────────────────
   把服务器上的素材库同步到本地。

   现场装置不该直连服务器跑 —— 活动现场的网一抖就白屏，而开场那几秒
   全靠它。正确姿势是：大家平时往服务器传素材，活动前跑一次这个脚本
   把库拉到本地，现场 node serve.mjs 全离线运行。

   用法：node tools/sync.mjs http://你的服务器:5173
        node tools/sync.mjs http://你的服务器:5173 --dry   只看差异不动文件

   只读，不需要 token。
   ────────────────────────────────────────────────────────────── */

import { mkdir, writeFile, readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = (process.argv[2] || '').replace(/\/$/, '');
const DRY = process.argv.includes('--dry');
const MEMES = join(process.cwd(), 'memes');
const MANIFEST = join(MEMES, 'manifest.json');

if (!BASE){
  console.error('用法: node tools/sync.mjs http://服务器:5173 [--dry]');
  process.exit(1);
}

const r = await fetch(`${BASE}/api/memes`).catch(e => {
  console.error(`连不上 ${BASE}：${e.message}`); process.exit(1);
});
if (!r.ok){ console.error(`${BASE} 返回 HTTP ${r.status}`); process.exit(1); }
const remote = (await r.json()).memes.filter(m => !m.missing);

await mkdir(MEMES, { recursive: true });
let local = { memes: [] };
try { local = JSON.parse(await readFile(MANIFEST, 'utf8')); } catch {}
let files = [];
try { files = await readdir(MEMES); } catch {}
const have = new Set(files);

const add = remote.filter(m => !have.has(m.file));
const gone = local.memes.filter(l => !remote.some(m => m.file === l.file));

console.log(`远端 ${remote.length} 张　本地 ${local.memes.length} 张`);
console.log(`  要下载 ${add.length} 张${add.length ? '：' + add.map(m => m.name).join('、') : ''}`);
console.log(`  要删除 ${gone.length} 张${gone.length ? '：' + gone.map(m => m.name).join('、') : ''}`);

if (DRY){ console.log('\n（--dry，没有改动任何文件）'); process.exit(0); }

let ok = 0;
for (const m of add){
  const u = `${BASE}/memes/${encodeURIComponent(m.file)}`;
  try {
    const img = await fetch(u);
    if (!img.ok) throw new Error('HTTP ' + img.status);
    await writeFile(join(MEMES, m.file), Buffer.from(await img.arrayBuffer()));
    ok++;
  } catch (e){ console.log(`  ✘ ${m.file}: ${e.message}`); }
}
for (const g of gone){ try { await unlink(join(MEMES, g.file)); } catch {} }

/* 清单整份replace：向量也一并同步过来，本地不用重算 */
await writeFile(MANIFEST, JSON.stringify(
  { _note:'由 tools/sync.mjs 从服务器同步', memes: remote.map(({ missing, ...e }) => e) },
  null, 2) + '\n');

console.log(`\n同步完成：下载 ${ok}，删除 ${gone.length}，清单 ${remote.length} 条。`);
console.log('现在可以断网跑：node serve.mjs');
