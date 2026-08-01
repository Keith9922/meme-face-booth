#!/usr/bin/env node
/**
 * 队友招募墙 · 撮合后端
 *
 * 零依赖，只用 Node 内置模块。跑在 127.0.0.1:4611，由 nginx 反代 /api/。
 *
 *   GET  /api/health   存活探针
 *   GET  /api/stats    缺口统计（前端也能自己算，这里主要给外部脚本用）
 *   POST /api/match    表单画像 → 打分排序 + M3 写推荐语
 *   POST /api/chat     SSE 流式对话，AI 小助手读全量名册后给建议
 *
 * MiniMax key 只在这个进程里（/etc/teamup-api.env），任何响应都不回传，
 * 前端 bundle 里也不会出现。
 */

import { createServer } from 'node:http';

import { gapAnalysis, openProjects, rankMatches, scoreEntry } from '../src/lib/analytics.js';
import { FILTER_ROLES, roleKeys } from '../src/lib/taxonomy.js';
import { complete, stream } from './minimax.mjs';
import { dataset, reload, watchWall } from './dataset.mjs';

const PORT = Number(process.env.PORT) || 4611;
const HOST = process.env.HOST || '127.0.0.1';

/* ------------------------------------------------------------------ *
 * 简易限流：这是公网端点，每次调用都在烧 token
 * ------------------------------------------------------------------ */
const hits = new Map();
function rateLimited(ip, { max = 20, windowMs = 60_000 } = {}) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.start > windowMs) {
    hits.set(ip, { start: now, n: 1 });
    return false;
  }
  rec.n += 1;
  return rec.n > max;
}
// 别让 map 无限长
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of hits) if (now - rec.start > 120_000) hits.delete(ip);
}, 60_000).unref();

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */
const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(s),
  });
  res.end(s);
};

async function readJson(req, limitBytes = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limitBytes) throw new Error('请求体过大');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const clientIp = (req) =>
  (req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?')
    .toString()
    .split(',')[0]
    .trim();

/** 回给前端的精简条目 —— 联系方式让前端从自己 bundle 里的数据取 */
const lite = (e) => ({
  id: e.id,
  recordId: e.recordId,
  kind: e.kind,
  project: e.project,
  intro: e.intro,
  nickname: e.nickname,
  stage: e.stage,
  recruit: roleKeys(e.recruit),
  skills: roleKeys(e.skills),
});

/* ------------------------------------------------------------------ *
 * 路由
 * ------------------------------------------------------------------ */

async function handleMatch(req, res) {
  const body = await readJson(req);
  const me = {
    skills: Array.isArray(body.skills) ? body.skills : [],
    wants: Array.isArray(body.wants) ? body.wants : [],
    intent: ['join', 'lead', 'both'].includes(body.intent) ? body.intent : 'join',
    stages: Array.isArray(body.stages) ? body.stages : [],
    keywords: typeof body.keywords === 'string' ? body.keywords.slice(0, 200) : '',
  };

  const { entries } = dataset();
  const ranked = rankMatches(me, entries, { limit: 8 });
  const matches = ranked.map((r) => ({ ...lite(r.entry), score: r.score, reasons: r.reasons }));

  // 打分是确定性的、可解释的；M3 只负责把前几名串成一句人话。
  // 它挂了也不影响推荐能用 —— 所以整段包在 try 里。
  let summary = '';
  if (matches.length && body.explain !== false) {
    try {
      const brief = ranked
        .slice(0, 3)
        .map(
          (r, i) =>
            `${i + 1}. [${r.entry.id}] ${r.entry.project || r.entry.nickname}（${r.score}分）依据：${r.reasons.map((x) => x.text).join('；')}`,
        )
        .join('\n');
      summary = await complete({
        system:
          '你是黑客松组队小助手。下面是算法给某位选手排出的前三个匹配和依据。用不超过 90 个字、两三句中文，' +
          '像朋友一样告诉 ta 该先去找谁、为什么。' +
          '**用项目名称称呼它们，不要念编号**（卡片就在这段话下面，用户看得到）。' +
          '不要罗列，不要客套，不要复述分数。',
        messages: [{ role: 'user', content: `我的情况：${describeMe(me)}\n\n候选：\n${brief}` }],
        maxTokens: 300,
        temperature: 0.7,
      });
    } catch (err) {
      console.error('[match] 生成推荐语失败:', err.message);
    }
  }

  json(res, 200, { matches, summary, total: entries.length });
}

function describeMe(me) {
  const label = (ks) => ks.map((k) => FILTER_ROLES.find((r) => r.key === k)?.short || k).join('、');
  const parts = [];
  if (me.skills.length) parts.push(`我会${label(me.skills)}`);
  if (me.wants.length) parts.push(`想找${label(me.wants)}`);
  parts.push(
    me.intent === 'lead' ? '我是发起人，在招队友' : me.intent === 'both' ? '发起或加入都行' : '想加入别人的项目',
  );
  if (me.keywords) parts.push(`感兴趣的方向：${me.keywords}`);
  return parts.join('，');
}

async function handleChat(req, res) {
  const body = await readJson(req);
  const raw = Array.isArray(body.messages) ? body.messages : [];
  const messages = raw
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return json(res, 400, { error: '最后一条必须是用户消息' });
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const ac = new AbortController();
  req.on('close', () => ac.abort());

  try {
    await stream({
      system: dataset().system,
      messages,
      // M3 的 thinking 也算进 max_tokens，1100 会把回答截在半句话上
      maxTokens: 2400,
      temperature: 0.7,
      signal: ac.signal,
      onText: (t) => send('delta', { text: t }),
    });
    send('done', {});
  } catch (err) {
    if (!ac.signal.aborted) {
      console.error('[chat] 失败:', err.message);
      send('error', { message: '小助手暂时connect不上，稍后再试；也可以直接用上面的表单匹配。' });
    }
  }
  res.end();
}

/* ------------------------------------------------------------------ */

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  // 本地开发时 vite 在 5174，跟这里不同源
  if (process.env.ALLOW_CORS === '1') {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
  }

  try {
    if (req.method === 'GET' && path === '/api/health') {
      const d = dataset();
      return json(res, 200, {
        ok: true,
        entries: d.entries.length,
        syncedAt: d.raw.syncedAt,
        loadedAt: d.loadedAt,
        model: process.env.MINIMAX_MODEL || 'MiniMax-M3',
        hasKey: Boolean(process.env.MINIMAX_API_KEY),
      });
    }

    if (req.method === 'GET' && path === '/api/stats') {
      const d = dataset();
      return json(res, 200, { counts: d.raw.counts, gaps: d.gaps, openProjects: d.openCount });
    }

    // 前端首屏用 bundle 里那份，挂载后再拉这里，比自己带的新就换掉。
    // 这样飞书更新 → 定时器同步 → 后端热重载 → 页面刷新即最新，全程不用重新构建前端。
    if (req.method === 'GET' && path === '/api/wall') {
      const d = dataset();
      if (req.headers['if-none-match'] === d.etag) {
        return res.writeHead(304, { etag: d.etag, 'cache-control': 'no-cache' }).end();
      }
      res.setHeader('etag', d.etag);
      res.setHeader('cache-control', 'no-cache');
      return json(res, 200, d.raw);
    }

    if (req.method === 'POST' && (path === '/api/match' || path === '/api/chat')) {
      if (rateLimited(clientIp(req))) {
        return json(res, 429, { error: '有点快，歇一分钟再试～' });
      }
      return path === '/api/match' ? await handleMatch(req, res) : await handleChat(req, res);
    }

    json(res, 404, { error: 'not found' });
  } catch (err) {
    console.error('[server]', err);
    if (!res.headersSent) json(res, 500, { error: err.message || '服务器错误' });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  const d = dataset();
  console.log(
    `[teamup-api] http://${HOST}:${PORT}  ${d.entries.length} 条数据  syncedAt=${d.raw.syncedAt}  key=${process.env.MINIMAX_API_KEY ? 'ok' : '缺失'}`,
  );
  watchWall();
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}

export { scoreEntry };
