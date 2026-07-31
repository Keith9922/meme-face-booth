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

/* ---------- 字段名 ---------- */
const F = {
  no: '编号',
  project: '项目名称',
  intro: '请用一句话介绍你的创造项目计划（必填）',
  nickname: '你的选手昵称',
  contact: '联系方式（微信/飞书）',
  recruit: '你希望招募什么样的伙伴？（可多选）',
  recruitOther: '你希望招募什么样的伙伴？（可多选）-其他-补充内容',
  skills: '你的主要能力是什么？',
  skillsOther: '你的主要能力是什么？-🌱 其他',
  stage: '你目前项目计划的状态是？',
  teamMode: '你希望如何完成这个创造项目计划？',
  intent: '你希望如何参与黑客松？',
  position: '你希望在团队中承担什么角色？',
  motivation: '如果只能选择一种创造方式，你最喜欢的是？',
  matchHelp: '是否接受组委会帮助匹配队友？',
  teamed: '是否已经组队成功',
  extra: '补充信息',
  submittedAt: '提交时间',
  submitter: '提交人',
};

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

function normalize(record) {
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

  const { records, via } = await fetchTable({ mode });
  console.log(`[sync] 拉到 ${records.length} 条原始记录（via ${via}）`);

  const entries = records
    .map(normalize)
    // 表单测试残留的纯空行丢掉：一条记录至少得有称呼、项目、介绍或能力其中之一
    .filter((e) => e.nickname !== '匿名创作者' || e.project || e.intro || e.skills.length > 0)
    .sort((a, b) => {
      // 项目卡排前面，同类里按编号升序
      if (a.kind !== b.kind) return a.kind === 'project' ? -1 : 1;
      return String(a.id).localeCompare(String(b.id), 'zh-CN', { numeric: true });
    });

  const payload = {
    source: { wiki: WIKI_URL, baseToken: BASE_TOKEN, tableId: TABLE_ID, via },
    syncedAt: new Date().toISOString(),
    counts: {
      total: entries.length,
      project: entries.filter((e) => e.kind === 'project').length,
      seeker: entries.filter((e) => e.kind === 'seeker').length,
    },
    entries,
  };

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
