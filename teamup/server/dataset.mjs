/**
 * 名册的内存副本 + 热重载。
 *
 * 定时器把新的 wall.json 写到磁盘上，这里监听文件变化并重建所有派生数据
 * （给模型看的名册、缺口统计、系统提示词），进程不用重启，
 * 前端下次拉 /api/wall 就拿到新数据 —— 整条链路不需要重新构建前端。
 */

import { readFileSync, watch, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gapAnalysis, openProjects } from '../src/lib/analytics.js';
import { FILTER_ROLES, roleKeys } from '../src/lib/taxonomy.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const WALL_PATH = process.env.WALL_JSON || resolve(HERE, '../src/data/wall.json');

const roleShort = (keys) => keys.map((k) => FILTER_ROLES.find((r) => r.key === k)?.short || k).join('/');

/** 给模型看的一行。刻意不含联系方式 —— 推荐用不到它 */
function rosterLine(e) {
  const bits = [`[${e.id}]`];
  if (e.kind === 'project') {
    bits.push(`项目《${e.project}》`);
    if (e.intro) bits.push(`— ${e.intro.slice(0, 90)}`);
    if (e.stage) bits.push(`进度:${e.stage}`);
  } else {
    bits.push(`创作者 ${e.nickname}（想加入别人的项目）`);
    if (e.extra) bits.push(`— ${e.extra.slice(0, 70)}`);
  }
  const needs = roleKeys(e.recruit);
  const has = roleKeys(e.skills);
  if (needs.length) bits.push(`缺:${roleShort(needs)}`);
  if (has.length) bits.push(`会:${roleShort(has)}`);
  if (e.teamMode.includes('Solo')) bits.push('(倾向单干)');
  return bits.join(' ');
}

function buildSystem(entries, gaps) {
  const roster = entries.map(rosterLine).join('\n');
  const gapLine = gaps
    .map((g) => `${g.short} 在招${g.demand}人/会做${g.supply}人(缺口${g.gap > 0 ? '+' : ''}${g.gap})`)
    .join('；');

  return `你是「创作者黑客松 · 队友招募墙」的组队小助手。你的唯一任务是帮来的人找到合适的项目或队友。

## 现场情况
共 ${entries.length} 位选手：${entries.filter((e) => e.kind === 'project').length} 个项目在招人，${entries.filter((e) => e.kind === 'seeker').length} 位创作者想加入别人。
供需缺口：${gapLine}

## 全部名册
${roster}

## 怎么回答
- 用中文，语气轻松、简短，像现场帮人牵线的志愿者，不要客套和总结陈词。
- 推荐时**必须写出编号**，格式固定为 \`[编号]\`，例如「[023] EchoEcho 响响」。前端靠这个把卡片渲染出来。
- 一次最多推 3 个，并且每个都要说清楚**为什么是 ta** —— 落到具体的「你会 X，ta 正缺 X」或者项目内容本身，不要空泛地说「很适合」。
- 信息不够就先问一句：ta 会什么、想做什么方向、想主导还是想加入。别一上来就硬推。
- 名册里没有的项目绝对不要编。找不到合适的就直说，并建议放宽条件。
- 不要输出任何联系方式 —— 你也拿不到，让用户点卡片翻面自己看。`;
}

let state = null;

function build() {
  const raw = JSON.parse(readFileSync(WALL_PATH, 'utf8'));
  const entries = raw.entries;
  const gaps = gapAnalysis(entries);
  return {
    raw,
    entries,
    gaps,
    openCount: openProjects(entries).length,
    system: buildSystem(entries, gaps),
    // 前端用它判断「服务端的数据比我 bundle 里的新吗」
    etag: `"${raw.syncedAt}-${entries.length}"`,
    loadedAt: new Date().toISOString(),
  };
}

export function dataset() {
  if (!state) state = build();
  return state;
}

export function reload(reason = 'manual') {
  try {
    const next = build();
    const before = state?.entries.length ?? 0;
    state = next;
    console.log(
      `[dataset] 重新载入（${reason}）：${before} → ${next.entries.length} 条，syncedAt=${next.raw.syncedAt}`,
    );
    return true;
  } catch (err) {
    // 同步脚本可能正写到一半，保留旧数据，等下一次事件
    console.error(`[dataset] 重载失败（${reason}），继续用旧数据：${err.message}`);
    return false;
  }
}

/** 监听 wall.json。写文件常常触发多次事件，用去抖合并 */
export function watchWall() {
  let timer = null;
  let lastSize = -1;
  try {
    watch(WALL_PATH, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        let size = -1;
        try {
          size = statSync(WALL_PATH).size;
        } catch {
          return;
        }
        if (size === lastSize) return;
        lastSize = size;
        reload('文件变化');
      }, 400);
    });
    console.log(`[dataset] 已监听 ${WALL_PATH}`);
  } catch (err) {
    console.error('[dataset] 监听失败，改为只在启动时读取：', err.message);
  }
}
