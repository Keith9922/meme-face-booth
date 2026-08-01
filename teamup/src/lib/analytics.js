/**
 * 从 wall.json 派生的统计与撮合算法。
 *
 * 这个文件同时被前端和后端 import —— 后端拿它算候选排序，
 * 前端拿它做即时筛选和「缺口」板块，两边必须是同一套口径，
 * 否则 AI 推荐的顺序和页面上看到的对不上。
 */

import { FILTER_ROLES, roleKeys } from './taxonomy.js';

/* ------------------------------------------------------------------ *
 * 缺口：某个方向有多少人在招、多少人会做
 * ------------------------------------------------------------------ */

export function gapAnalysis(entries) {
  return FILTER_ROLES.map((role) => {
    // 在招 = 有人把这个方向写进「希望招募的伙伴」
    const demand = entries.filter((e) => roleKeys(e.recruit).includes(role.key)).length;
    // 会做 = 有人把这个方向写进「我的主要能力」
    const supply = entries.filter((e) => roleKeys(e.skills).includes(role.key)).length;
    return {
      ...role,
      demand,
      supply,
      gap: demand - supply,
    };
  }).sort((a, b) => b.gap - a.gap);
}

/** 缺口最大的那个方向，用来写头部那句「现在最缺 X」 */
export function scarcest(entries) {
  const [top] = gapAnalysis(entries);
  return top && top.gap > 0 ? top : null;
}

/* ------------------------------------------------------------------ *
 * 还在招人的项目
 * ------------------------------------------------------------------ */

const STAGE_ORDER = ['已有 Demo', '已完成部分功能', '已经开始制作', '已经有方案设计', '刚有一个想法'];

export function openProjects(entries) {
  return entries
    .filter((e) => e.kind === 'project' && roleKeys(e.recruit).length > 0)
    .sort((a, b) => {
      // 推进得越远的排前面 —— 想加入的人最关心「这个项目真的在动吗」
      const ai = STAGE_ORDER.indexOf(a.stage);
      const bi = STAGE_ORDER.indexOf(b.stage);
      const an = ai === -1 ? 99 : ai;
      const bn = bi === -1 ? 99 : bi;
      if (an !== bn) return an - bn;
      return String(a.id).localeCompare(String(b.id), 'zh-CN', { numeric: true });
    });
}

/* ------------------------------------------------------------------ *
 * 撮合打分
 * ------------------------------------------------------------------ *
 * 输入是一份「我是谁」的画像，输出是按互补度排序的候选。
 * 全部是可解释的加分项 —— 每一分都能说清楚为什么，
 * 这样 AI 那边只需要润色理由，不需要自己编一个分数出来。
 */

export const MAX_SCORE = 100;

/**
 * @param {object} me    { skills: string[](role key), wants: string[](role key),
 *                         intent: 'join'|'lead'|'both', stages: string[], keywords: string }
 * @param {object} entry wall.json 里的一条
 */
export function scoreEntry(me, entry) {
  const reasons = [];
  let score = 0;

  const mySkills = me.skills || [];
  const myWants = me.wants || [];
  const theirNeeds = roleKeys(entry.recruit);
  const theirSkills = roleKeys(entry.skills);

  // ① 我会的，正好是对方缺的 —— 撮合的核心信号，给最高权重
  const iFillTheirGap = mySkills.filter((s) => theirNeeds.includes(s));
  if (iFillTheirGap.length) {
    const pts = Math.min(46, 26 + (iFillTheirGap.length - 1) * 10);
    score += pts;
    reasons.push({
      kind: 'fill',
      roles: iFillTheirGap,
      text: `ta 正缺${labelOf(iFillTheirGap)}，而这正是你会的`,
      pts,
    });
  }

  // ② 对方会的，正好是我缺的（我自己也在找人时才有意义）
  const theyFillMyGap = myWants.filter((w) => theirSkills.includes(w));
  if (theyFillMyGap.length) {
    const pts = Math.min(26, 14 + (theyFillMyGap.length - 1) * 6);
    score += pts;
    reasons.push({
      kind: 'complement',
      roles: theyFillMyGap,
      text: `ta 会${labelOf(theyFillMyGap)}，正好补上你要找的`,
      pts,
    });
  }

  // ③ 角色不打架：两个都想主导的人凑一起通常不成
  if (me.intent === 'join' && entry.position.includes('主导')) {
    score += 8;
    reasons.push({ kind: 'role', text: 'ta 想主导方向，你想加入执行，分工不冲突', pts: 8 });
  } else if (me.intent === 'lead' && entry.position.includes('负责具体任务')) {
    score += 8;
    reasons.push({ kind: 'role', text: 'ta 愿意负责具体任务，配你主导刚好', pts: 8 });
  } else if (me.intent === 'lead' && entry.position.includes('主导')) {
    score -= 6;
    reasons.push({ kind: 'role', text: '你们都想主导方向，得先聊清楚谁拍板', pts: -6 });
  }

  // ④ ta 明确在招人 / 愿意被撮合
  if (entry.teamMode.includes('希望招募队友')) {
    score += 10;
    reasons.push({ kind: 'open', text: 'ta 明确写了「正在招队友」', pts: 10 });
  } else if (entry.teamMode.includes('都可以')) {
    score += 5;
    reasons.push({ kind: 'open', text: 'ta 说有合适的人就欢迎加入', pts: 5 });
  } else if (entry.teamMode.includes('Solo')) {
    score -= 14;
    reasons.push({ kind: 'open', text: 'ta 倾向独立完成，可能不招人', pts: -14 });
  }

  // ⑤ 项目进度对上了我的偏好
  if (me.stages?.length && entry.stage && me.stages.includes(entry.stage)) {
    score += 7;
    reasons.push({ kind: 'stage', text: `进度是「${entry.stage}」，正是你想参与的阶段`, pts: 7 });
  }

  // ⑥ 关键词命中项目介绍 —— 兴趣匹配，权重不高但很能解释「为什么是这个」
  const kw = (me.keywords || '').trim();
  if (kw) {
    const hay = `${entry.project} ${entry.intro} ${entry.extra}`.toLowerCase();
    const hits = kw
      .split(/[\s,，、;；/]+/)
      .filter((t) => t.length >= 2)
      .filter((t) => hay.includes(t.toLowerCase()));
    if (hits.length) {
      const pts = Math.min(16, hits.length * 8);
      score += pts;
      reasons.push({ kind: 'keyword', text: `项目里提到了「${hits.join('、')}」`, pts });
    }
  }

  return {
    score: Math.max(0, Math.min(MAX_SCORE, Math.round(score))),
    reasons: reasons.sort((a, b) => b.pts - a.pts),
  };
}

function labelOf(keys) {
  return keys
    .map((k) => FILTER_ROLES.find((r) => r.key === k)?.short || k)
    .join('、');
}

/**
 * 排出 top N。默认只看项目卡 —— 想加入的人要找项目；
 * 如果我自己是发起人（intent === 'lead'），那要找的是人，改看 seeker。
 */
export function rankMatches(me, entries, { limit = 12 } = {}) {
  const pool =
    me.intent === 'lead'
      ? entries.filter((e) => e.kind === 'seeker')
      : entries.filter((e) => e.kind === 'project');

  return pool
    .map((entry) => ({ entry, ...scoreEntry(me, entry) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || String(a.entry.id).localeCompare(String(b.entry.id)))
    .slice(0, limit);
}
