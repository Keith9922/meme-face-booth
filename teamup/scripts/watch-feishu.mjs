#!/usr/bin/env node
/**
 * 定时检查飞书表格有没有更新，有才拉。
 *
 *   node scripts/watch-feishu.mjs          # 检查一次，变了就同步（给 systemd timer / cron 用）
 *   node scripts/watch-feishu.mjs --force  # 不管有没有变都同步一次
 *   node scripts/watch-feishu.mjs --loop 300  # 自己每 300 秒转一圈（不想配 timer 时用）
 *
 * 变更检测走多维表格的 revision：
 *   GET /open-apis/bitable/v1/apps/{app_token}
 * 这是一次很轻的调用，返回里的 revision 只要表格被改过就会往上走。
 * 只有 revision 变了才去翻全部 98 条记录 —— 五分钟跑一次也几乎不产生开销。
 *
 * 同步完写回 src/data/wall.json；后端在监听这个文件，会自己热重载，
 * 不需要重启服务，也不需要重新构建前端。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE = resolve(HERE, '../.sync-state.json');

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const BASE_TOKEN = process.env.FEISHU_BASE_TOKEN || 'EgKsbzAhDaf3kpsys9Tc4pesnc3';

const log = (...a) => console.log(`[watch ${new Date().toISOString().slice(0, 19)}]`, ...a);

function readState() {
  try {
    return JSON.parse(readFileSync(STATE, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(next) {
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

async function tenantToken() {
  const app_id = process.env.FEISHU_APP_ID;
  const app_secret = process.env.FEISHU_APP_SECRET;
  if (!app_id || !app_secret) {
    throw new Error(
      '缺少 FEISHU_APP_ID / FEISHU_APP_SECRET。' +
        '把自建应用的凭据写进 /etc/teamup-api.env，并确认该应用已被加为这张多维表格的协作者。',
    );
  }
  const res = await fetch(`${FEISHU_HOST}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id, app_secret }),
  });
  const j = await res.json();
  if (j.code !== 0) throw new Error(`取 token 失败 (code=${j.code}): ${j.msg}`);
  return j.tenant_access_token;
}

/** 表格的当前版本号；改一个字都会变 */
async function currentRevision(token) {
  const res = await fetch(`${FEISHU_HOST}/open-apis/bitable/v1/apps/${BASE_TOKEN}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const j = await res.json();
  if (j.code !== 0) throw new Error(`读表格版本失败 (code=${j.code}): ${j.msg}`);
  return { revision: j.data?.app?.revision, name: j.data?.app?.name };
}

function runSync() {
  return new Promise((ok, fail) => {
    const p = spawn(process.execPath, [resolve(HERE, 'sync-feishu.mjs'), '--api'], {
      stdio: 'inherit',
      env: process.env,
    });
    p.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`同步脚本退出码 ${code}`))));
    p.on('error', fail);
  });
}

async function checkOnce({ force = false } = {}) {
  const token = await tenantToken();
  const { revision, name } = await currentRevision(token);
  const state = readState();

  if (!force && state.revision === revision) {
    log(`「${name}」revision=${revision} 未变，跳过`);
    return false;
  }

  log(`「${name}」revision ${state.revision ?? '(首次)'} → ${revision}，开始同步…`);
  await runSync();
  writeState({ revision, syncedAt: new Date().toISOString(), name });
  log('同步完成，后端会自己热重载');
  return true;
}

async function main() {
  const force = process.argv.includes('--force');
  const loopIdx = process.argv.indexOf('--loop');
  const loopSec = loopIdx !== -1 ? Number(process.argv[loopIdx + 1]) || 300 : 0;

  if (!loopSec) {
    await checkOnce({ force });
    return;
  }

  log(`进入循环模式，每 ${loopSec} 秒检查一次`);
  // 循环模式下单次失败不能把进程带走 —— 网络抖一下就退出，timer 就白配了
  for (;;) {
    try {
      await checkOnce({ force: false });
    } catch (err) {
      log('检查失败：', err.message);
    }
    await new Promise((r) => setTimeout(r, loopSec * 1000));
  }
}

main().catch((err) => {
  log('失败：', err.message);
  process.exit(1);
});
