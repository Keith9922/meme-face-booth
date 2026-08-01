/**
 * 表单选项 → 展示用短标签 + 配色。
 *
 * 飞书里的选项文案很长（「💻 技术开发（前端、后端、AI、算法、小程序等）」），
 * 直接铺在卡片上会把版面撑爆，所以这里统一收敛成「emoji + 四个字」，
 * 全文留在 title 属性里，鼠标悬停还能看到。
 *
 * color 取值必须是 animal-island-ui 的 13 个 CardColor 之一。
 */

/** 能力 / 招募方向 —— 招募 tag 和「我的能力」tag 共用同一套 */
export const ROLE_TAGS = [
  { key: 'product', match: '创意', emoji: '💡', short: '创意 / 产品', color: 'app-yellow' },
  { key: 'dev', match: '技术开发', emoji: '💻', short: '技术开发', color: 'app-blue' },
  { key: 'design', match: '设计', emoji: '🎨', short: '设计', color: 'app-pink' },
  { key: 'ops', match: '内容', emoji: '📢', short: '内容 / 运营', color: 'app-teal' },
  { key: 'teamed', match: '已有队友', emoji: '🎉', short: '已有队友', color: 'app-green' },
  { key: 'other', match: '其他', emoji: '🌱', short: '其他', color: 'brown' },
];

/** 项目进度 —— 从「刚有个想法」到「已完成部分功能」，颜色由浅到深表示推进程度 */
export const STAGE_TAGS = [
  { match: '刚有一个想法', emoji: '🌱', short: '刚有想法', color: 'lime-green' },
  { match: '已经有方案设计', emoji: '📐', short: '有方案设计', color: 'app-teal' },
  { match: '已经开始制作', emoji: '🔨', short: '已开工', color: 'app-blue' },
  { match: '已有 Demo', emoji: '🚀', short: '已有 Demo', color: 'purple' },
  { match: '已完成部分功能', emoji: '✨', short: '已跑通部分', color: 'app-orange' },
];

/** 参与方式 —— 决定卡片是「项目卡」还是「找项目卡」 */
export const INTENT_TAGS = [
  { match: '我有明确的创造计划', emoji: '🚀', short: '发起项目', color: 'app-orange' },
  { match: '我希望加入其他人', emoji: '🤝', short: '想加入项目', color: 'app-teal' },
  { match: '既可以发起', emoji: '🌟', short: '发起 / 加入都行', color: 'app-yellow' },
  { match: '还没想好', emoji: '🎲', short: '现场再看', color: 'purple' },
];

/** 组队意愿 */
export const TEAM_MODE_TAGS = [
  { match: 'Solo', emoji: '🧍', short: '想独立完成', color: 'brown' },
  { match: '希望招募队友', emoji: '🙌', short: '正在招队友', color: 'app-orange' },
  { match: '都可以', emoji: '😌', short: '有合适的就加入', color: 'app-teal' },
  { match: '还没决定', emoji: '🤔', short: '还没决定', color: 'purple' },
  { match: '已经有队友', emoji: '🎉', short: '已经有队友', color: 'app-green' },
];

/** 在团队里想承担的角色 */
export const POSITION_TAGS = [
  { match: '主导项目', emoji: '🌟', short: '想主导方向', color: 'app-orange' },
  { match: '负责具体任务', emoji: '🤝', short: '负责具体任务', color: 'app-teal' },
  { match: '学习参与', emoji: '📚', short: '学习式参与', color: 'app-blue' },
];

/** 创造偏好 */
export const MOTIVATION_TAGS = [
  { match: '提出新的想法', emoji: '🔭', short: '爱想点子', color: 'app-yellow' },
  { match: '把想法做出来', emoji: '🛠️', short: '爱做东西', color: 'app-orange' },
  { match: '探索新的 AI 工具', emoji: '🧪', short: '爱折腾新工具', color: 'app-blue' },
  { match: '分享自己的作品', emoji: '📣', short: '爱分享作品', color: 'app-pink' },
];

/** 是否接受组委会撮合 */
export const MATCH_TAGS = [
  { match: '可以，希望推荐', emoji: '✅', short: '欢迎组委会牵线', color: 'app-green' },
  { match: '再决定', emoji: '🤔', short: '可以看看推荐', color: 'app-yellow' },
  { match: '希望自己寻找', emoji: '🙋', short: '想自己找', color: 'brown' },
];

const FALLBACK = { emoji: '🍀', short: '', color: 'default' };

/** 把一条原始选项文案翻译成展示用 tag；认不出来的原样保留，不丢数据 */
export function toTag(raw, dict) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const hit = dict.find((d) => text.includes(d.match));
  const base = hit || FALLBACK;
  return {
    key: hit?.key || text,
    emoji: base.emoji,
    label: base.short || text.replace(/^\p{Emoji_Presentation}\s*/u, '').replace(/（.*?）/g, ''),
    color: base.color,
    full: text,
  };
}

/** 数组字段 → tag 数组 */
export function toTags(raw, dict) {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((item) => toTag(item, dict)).filter(Boolean);
}

/** 筛选栏用的「招募方向」选项（不含「已有队友」「其他」这类非能力项） */
export const FILTER_ROLES = ROLE_TAGS.filter((r) => ['product', 'dev', 'design', 'ops'].includes(r.key));

/**
 * 把一条原始选项文案归到四个方向之一，认不出来返回 null。
 *
 * 必须走 ROLE_TAGS 的顺序做「首个命中」，不能各自 includes ——
 * 「💡 创意 / 产品（想法策划、需求分析、产品设计）」里含「设计」两个字，
 * 单独判断 includes('设计') 会把一大批产品人误算成设计师，
 * 缺口统计会直接反过来。
 */
export function roleKeyOf(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const hit = ROLE_TAGS.find((d) => text.includes(d.match));
  return hit && ['product', 'dev', 'design', 'ops'].includes(hit.key) ? hit.key : null;
}

/** 一条记录归一化后的方向集合（去重） */
export function roleKeys(list) {
  return [...new Set((list || []).map(roleKeyOf).filter(Boolean))];
}
