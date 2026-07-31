/* ──────────────────────────────────────────────────────────────
   素材采集：从 Openverse 拉 CC0 / 公有领域图片到 harvest/

   只要 license=cc0,pdm —— 这两类可商用、无需署名。刻意不碰 CC-BY 等
   需要署名的，小票上没地方印署名，用了就是违约。

   注意：这一步只负责「按授权把候选图弄下来」，能不能用要看能不能提取出
   表情/动作向量 —— 那一步在管理台里做（/admin.html → 从 harvest 导入）。
   实测风景照、合影、侧脸占多数，命中率不会高，属正常。

   用法：node tools/harvest.mjs [每个词最多几张]
   ────────────────────────────────────────────────────────────── */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'harvest');
const META = join(OUT, '_source.json');
const PER = Number(process.argv[2]) || 12;

/* 按「表情动作幅度大」挑词，太温和的表情匹配时会被闸门压住 */
const TERMS = [
  'shocked face', 'surprised face', 'screaming person', 'angry face',
  'laughing out loud', 'crying face', 'silly face', 'funny face',
  'grimace', 'tongue out', 'wink', 'yawning',
  'excited person', 'frustrated face', 'thinking pose', 'facepalm',
  'thumbs up person', 'shrug', 'pointing person', 'hands on head',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function search(q){
  const u = new URL('https://api.openverse.org/v1/images/');
  u.searchParams.set('q', q);
  u.searchParams.set('license', 'cc0,pdm');
  u.searchParams.set('page_size', String(PER));
  u.searchParams.set('mature', 'false');
  const r = await fetch(u, { headers:{ 'User-Agent':'mimic-photo-booth/1.0 (asset harvesting)' } });
  if (!r.ok) throw new Error(`${q}: HTTP ${r.status}`);
  return (await r.json()).results || [];
}

async function main(){
  await mkdir(OUT, { recursive: true });
  let meta = {};
  try { meta = JSON.parse(await readFile(META, 'utf8')); } catch {}

  let got = 0, skip = 0, fail = 0;
  for (const term of TERMS){
    let res = [];
    try { res = await search(term); }
    catch (e){ console.log(`  ✘ ${term}: ${e.message}`); continue; }

    let n = 0;
    for (const r of res){
      const ext = (r.filetype && ['jpg','jpeg','png','webp'].includes(r.filetype)) ? r.filetype : 'jpg';
      const file = `${term.replace(/\s+/g,'-')}-${r.id.slice(0,8)}.${ext}`;
      if (meta[file]){ skip++; continue; }
      try {
        const img = await fetch(r.url, { headers:{ 'User-Agent':'mimic-photo-booth/1.0' } });
        if (!img.ok) throw new Error('HTTP ' + img.status);
        const buf = Buffer.from(await img.arrayBuffer());
        if (buf.length < 8_000 || buf.length > 12_000_000) throw new Error('尺寸不合适');
        await writeFile(join(OUT, file), buf);
        /* 记录出处：CC0/PDM 不强制署名，但留个来源方便日后自查 */
        meta[file] = { term, license:`${r.license}/${r.license_version}`,
                       source:r.source, foreign_landing_url:r.foreign_landing_url, title:r.title };
        got++; n++;
      } catch (e){ fail++; }
      await sleep(120);
    }
    console.log(`  ${term.padEnd(20)} 新增 ${n}`);
    await sleep(250);
  }
  await writeFile(META, JSON.stringify(meta, null, 2) + '\n');
  console.log(`\n下载完成：新增 ${got}，已存在跳过 ${skip}，失败 ${fail}`);
  console.log(`全部在 harvest/，出处记录在 harvest/_source.json`);
  console.log(`下一步：打开 http://localhost:5173/admin.html 点「从 harvest 筛选导入」`);
  console.log(`（这些只是按授权筛过的候选，能不能用要看提不提取得出表情/动作向量）`);
}

main().catch(e => { console.error(e); process.exit(1); });
