#!/usr/bin/env node
/**
 * 飞书 → src/data/wall.json
 *
 *   npm run sync          本机跑，走已登录的 lark-cli
 *   npm run sync:api      CI 跑，走 FEISHU_APP_ID / FEISHU_APP_SECRET
 *
 * 产物是纯静态 JSON，构建时被 import 进 bundle —— 页面运行时不碰飞书，
 * 所以线上永远不会因为飞书接口抖动而白屏。要更新数据就重跑这个脚本再部署。
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchTable, WIKI_URL, BASE_TOKEN, TABLE_ID } from './feishu-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../src/data/wall.json');

/* ---------- 字段名 ----------
 * 每个字段给一串候选写法，按顺序「精确 → 前缀 → 包含」去表里找真名。
 *
 * 起因：主办方把「联系方式（微信/飞书）」改名成了「联系方式（微信）」，
 * 而这里原来写死了全名，于是 100 个人的联系方式全部静默变成空字符串，
 * 线上每张卡背面都显示「未留联系方式」，却没有任何地方报错。
 * 现在既做模糊匹配，也在最后做覆盖率校验（见 assertCoverage）。
 */
const FIELD_ALIASES = {
  no: ['编号'],
  project: ['项目名称'],
  intro: ['请用一句话介绍你的创造项目计划（必填）', '请用一句话介绍你的创造项目计划', '一句话介绍'],
  nickname: ['你的选手昵称', '选手昵称', '昵称'],
  contact: ['联系方式（微信）', '联系方式（微信/飞书）', '联系方式', '微信'],
  recruit: ['你希望招募什么样的伙伴？（可多选）'],
  recruitOther: ['你希望招募什么样的伙伴？（可多选）-其他-补充内容'],
  skills: ['你的主要能力是什么？'],
  skillsOther: ['你的主要能力是什么？-🌱 其他'],
  stage: ['你目前项目计划的状态是？'],
  teamMode: ['你希望如何完成这个创造项目计划？'],
  intent: ['你希望如何参与黑客松？'],
  position: ['你希望在团队中承担什么角色？'],
  motivation: ['如果只能选择一种创造方式，你最喜欢的是？'],
  matchHelp: ['是否接受组委会帮助匹配队友？'],
  teamed: ['是否已经组队成功'],
  extra: ['补充信息'],
  submittedAt: ['提交时间'],
  submitter: ['提交人'],
};

/** 关键字段：解析不到、或几乎没人填，就说明表结构变了，必须停下来 */
const CRITICAL = ['no', 'nickname', 'contact'];

function resolveFields(fieldNames) {
  const F = {};
  const unresolved = [];

  for (const [key, aliases] of Object.entries(FIELD_ALIASES)) {
    let hit = aliases.find((a) => fieldNames.includes(a));
    // 「联系方式（微信）」这种后缀改动，用前缀兜住
    if (!hit) hit = fieldNames.find((n) => aliases.some((a) => n.startsWith(a)));
    // 最后再放宽到包含关系
    if (!hit) hit = fieldNames.find((n) => aliases.some((a) => n.includes(a) || a.includes(n)));

    if (hit) F[key] = hit;
    else unresolved.push(`${key}（候选：${aliases.join(' / ')}）`);
  }

  if (unresolved.length) {
    console.warn(`[sync] 这些字段在表里没找到，将按空值处理：\n  - ${unresolved.join('\n  - ')}`);
  }
  const missingCritical = CRITICAL.filter((k) => !F[k]);
  if (missingCritical.length) {
    throw new Error(
      `关键字段解析失败：${missingCritical.join('、')}。表结构可能变了，` +
        `请对照 FIELD_ALIASES 更新。当前表里的字段是：\n  ${fieldNames.join('\n  ')}`,
    );
  }
  return F;
}

/**
 * 一个人一张卡。
 *
 * 表里有两种重复：
 *   · 连点提交 —— Zongyan 在 14 秒内交了 3 次，内容几乎一样
 *   · 改完重交 —— 淡定 隔了 2.5 小时把项目描述重写了一遍
 * 两种都按「同一个人」处理：保留提交时间最晚的那条（信息通常最全）。
 *
 * 判定同一个人用「微信 + 昵称」两个都相同，只有微信相同但昵称不同时不合并，
 * 而是留下来并打印出来 —— 那更可能是有人填错了别人的号，得人工看。
 */
function dedupe(entries) {
  const keyOf = (e) => `${e.contact.trim().toLowerCase()}|${e.nickname.trim()}`;
  const groups = new Map();
  for (const e of entries) {
    if (!e.contact.trim()) {
      groups.set(`__nocontact_${e.recordId}`, [e]);
      continue;
    }
    const k = keyOf(e);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }

  const kept = [];
  const dropped = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      kept.push(group[0]);
      continue;
    }
    const sorted = [...group].sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
    kept.push(sorted[0]);
    dropped.push(...sorted.slice(1));
  }

  if (dropped.length) {
    console.log(`[sync] 合并了 ${dropped.length} 条重复提交（同微信同昵称，保留最新的一条）：`);
    for (const d of dropped) console.log(`         丢弃 ${d.id} ${d.nickname}（${d.submittedAt}）`);
  }

  // 同一个微信落在不同昵称上 —— 不合并，但一定要报出来
  const byContact = new Map();
  for (const e of kept) {
    if (!e.contact.trim()) continue;
    const c = e.contact.trim().toLowerCase();
    if (!byContact.has(c)) byContact.set(c, []);
    byContact.get(c).push(e);
  }
  for (const [c, list] of byContact) {
    if (list.length > 1) {
      console.warn(
        `[sync] ⚠ 同一个联系方式「${c}」出现在不同昵称上，已保留全部，请人工确认：` +
          list.map((e) => `${e.id} ${e.nickname}`).join(' / '),
      );
    }
  }

  return kept;
}

/** 关键字段的覆盖率下限。低于这个值宁可让同步失败，也不要用一份残缺数据覆盖线上 */
function assertCoverage(entries) {
  const rate = (fn) => entries.filter(fn).length / Math.max(entries.length, 1);
  const checks = [
    ['编号', (e) => e.id, 0.95],
    ['昵称', (e) => e.nickname && e.nickname !== '匿名创作者', 0.8],
    ['联系方式', (e) => e.contact, 0.7],
  ];
  const bad = [];
  for (const [label, fn, min] of checks) {
    const r = rate(fn);
    const pct = (r * 100).toFixed(0);
    console.log(`[sync] 覆盖率 ${label}: ${pct}%（下限 ${(min * 100).toFixed(0)}%）`);
    if (r < min) bad.push(`${label} 只有 ${pct}%`);
  }
  if (bad.length) {
    throw new Error(
      `数据看起来不对：${bad.join('；')}。` +
        `多半是飞书那边改了字段名或权限，已中止，没有覆盖现有的 wall.json。`,
    );
  }
}

/* ---------- 取值工具 ---------- */
const text = (v) => {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(' / ');
  if (typeof v === 'object') return String(v.text ?? v.name ?? '').trim();
  return String(v).trim();
};

const list = (v) => (Array.isArray(v) ? v.map(text).filter(Boolean) : text(v) ? [text(v)] : []);

const one = (v) => list(v)[0] || '';

/** 稳定的伪随机数：同一个 id 每次构建拿到同样的角度，避免每次部署卡片都换位置 */
function seedOf(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function normalize(record, F) {
  const v = record.values;
  const project = text(v[F.project]);
  const intro = text(v[F.intro]);
  const nickname = text(v[F.nickname]);
  const submitter = text(v[F.submitter]);
  const id = text(v[F.no]) || record.record_id;

  return {
    id,
    recordId: record.record_id,
    // 有项目名 or 有一句话介绍 → 项目卡；否则是「带着技能来找项目的人」
    kind: project || intro ? 'project' : 'seeker',
    seed: seedOf(record.record_id || id),

    project,
    intro,
    nickname: nickname || submitter || '匿名创作者',
    contact: text(v[F.contact]),

    recruit: list(v[F.recruit]),
    recruitOther: text(v[F.recruitOther]),
    skills: list(v[F.skills]),
    skillsOther: text(v[F.skillsOther]),

    stage: one(v[F.stage]),
    teamMode: one(v[F.teamMode]),
    intent: one(v[F.intent]),
    position: one(v[F.position]),
    motivation: one(v[F.motivation]),
    matchHelp: one(v[F.matchHelp]),
    teamed: one(v[F.teamed]),

    extra: text(v[F.extra]),
    submittedAt: text(v[F.submittedAt]),
  };
}

/* ---------- 主流程 ---------- */
async function main() {
  const mode = process.argv.includes('--api') ? 'api' : 'cli';
  console.log(`[sync] 取数通道：${mode}  base=${BASE_TOKEN} table=${TABLE_ID}`);

  const { records, fields, via } = await fetchTable({ mode });
  console.log(`[sync] 拉到 ${records.length} 条原始记录（via ${via}）`);

  const F = resolveFields(fields.map((f) => f.name));
  console.log(`[sync] 联系方式字段解析为「${F.contact}」`);

  const entries = records
    .map((r) => normalize(r, F))
    // 空提交丢掉：既没留联系方式，也没写项目/介绍/能力 —— 这种卡片对谁都没用
    // （有人反复点了提交按钮，留下几条什么都没有的行）
    .filter((e) => e.contact || e.project || e.intro || e.skills.length > 0)
    .sort((a, b) => {
      // 项目卡排前面，同类里按编号升序
      if (a.kind !== b.kind) return a.kind === 'project' ? -1 : 1;
      return String(a.id).localeCompare(String(b.id), 'zh-CN', { numeric: true });
    });

  const deduped = dedupe(entries);

  const payload = {
    source: { wiki: WIKI_URL, baseToken: BASE_TOKEN, tableId: TABLE_ID, via },
    syncedAt: new Date().toISOString(),
    counts: {
      total: deduped.length,
      project: deduped.filter((e) => e.kind === 'project').length,
      seeker: deduped.filter((e) => e.kind === 'seeker').length,
    },
    entries: deduped,
  };

  assertCoverage(deduped);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(
    `[sync] 已写入 ${OUT}\n` +
      `       项目卡 ${payload.counts.project} 张 / 找项目 ${payload.counts.seeker} 张 / 合计 ${payload.counts.total}`,
  );
}

main().catch((err) => {
  console.error('[sync] 失败：', err.message);
  process.exit(1);
});
