/**
 * 飞书多维表格的两条取数通道。
 *
 * 表格来源：知识库文档「创作者黑客松：队友招募墙」里内嵌的 Base
 *   wiki  https://my.feishu.cn/wiki/QoTUwRqaCiSqqHk4CL4cz9W0nhe   （docx 节点）
 *   base  EgKsbzAhDaf3kpsys9Tc4pesnc3 / tblvUyDXyVq6tS3E          （文档里的 base_refer）
 *
 * 两条通道最终都产出同一种形状：
 *   { fields: [{id, name, type}], records: [{ record_id, values: { 字段名: 原始值 } }] }
 *
 *  A. cli  —— 走本机已登录的 lark-cli（`--as user`）。开发机上开箱即用，不需要任何密钥。
 *  B. api  —— 走飞书开放平台 tenant_access_token。给 CI 用，需要 FEISHU_APP_ID / FEISHU_APP_SECRET，
 *             且该自建应用要有 bitable 读权限 + 被加为这张 Base 的协作者。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const BASE_TOKEN = process.env.FEISHU_BASE_TOKEN || 'EgKsbzAhDaf3kpsys9Tc4pesnc3';
export const TABLE_ID = process.env.FEISHU_TABLE_ID || 'tblvUyDXyVq6tS3E';
export const WIKI_URL = 'https://my.feishu.cn/wiki/QoTUwRqaCiSqqHk4CL4cz9W0nhe';

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';

/* ------------------------------------------------------------------ *
 * A. lark-cli 通道
 * ------------------------------------------------------------------ */

async function larkCli(args) {
  const { stdout } = await execFileAsync('lark-cli', args, {
    maxBuffer: 32 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout);
  if (!parsed.ok) {
    throw new Error(`lark-cli ${args[0]} ${args[1]} 失败: ${JSON.stringify(parsed.error)}`);
  }
  return parsed.data;
}

async function fetchViaCli() {
  const fieldData = await larkCli([
    'base', '+field-list',
    '--base-token', BASE_TOKEN,
    '--table-id', TABLE_ID,
    '--as', 'user',
    '--format', 'json',
  ]);
  const fields = fieldData.fields.map((f) => ({ id: f.id, name: f.name, type: f.type }));

  // +record-list 一次最多 200 条，翻页直到 has_more 为 false
  const records = [];
  for (let offset = 0; ; offset += 200) {
    const page = await larkCli([
      'base', '+record-list',
      '--base-token', BASE_TOKEN,
      '--table-id', TABLE_ID,
      '--as', 'user',
      '--limit', '200',
      '--offset', String(offset),
      '--format', 'json',
    ]);

    // 返回的是列式结构：field_id_list 是表头，data 是行数组
    const { field_id_list: fieldIds = [], record_id_list: recordIds = [], data: rows = [] } = page;
    const idToName = new Map(fields.map((f) => [f.id, f.name]));

    rows.forEach((row, i) => {
      const values = {};
      fieldIds.forEach((fid, k) => {
        values[idToName.get(fid) || fid] = row[k];
      });
      records.push({ record_id: recordIds[i], values });
    });

    if (!page.has_more || rows.length === 0) break;
  }

  return { fields, records, via: 'lark-cli' };
}

/* ------------------------------------------------------------------ *
 * B. 开放平台 API 通道（给 CI 用）
 * ------------------------------------------------------------------ */

async function apiFetch(path, { token, method = 'GET', body, query } = {}) {
  const url = new URL(FEISHU_HOST + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(`飞书 API ${path} 失败 (code=${json.code}): ${json.msg}`);
  }
  return json.data;
}

async function tenantToken() {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error('缺少 FEISHU_APP_ID / FEISHU_APP_SECRET —— API 通道需要这两个环境变量');
  }
  const res = await fetch(`${FEISHU_HOST}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(`取 tenant_access_token 失败 (code=${json.code}): ${json.msg}`);
  return json.tenant_access_token;
}

/** 开放平台的富文本字段是 [{type:'text', text:'…'}] 分段，压成纯字符串 */
function flattenApiValue(value) {
  if (Array.isArray(value) && value.length && typeof value[0] === 'object' && 'text' in value[0]) {
    return value.map((seg) => seg.text).join('');
  }
  return value;
}

async function fetchViaApi() {
  const token = await tenantToken();
  const base = `/open-apis/bitable/v1/apps/${BASE_TOKEN}/tables/${TABLE_ID}`;

  const fields = [];
  for (let pageToken; ; ) {
    const data = await apiFetch(`${base}/fields`, {
      token,
      query: { page_size: 100, page_token: pageToken },
    });
    fields.push(...data.items.map((f) => ({ id: f.field_id, name: f.field_name, type: f.type })));
    if (!data.has_more) break;
    pageToken = data.page_token;
  }

  const records = [];
  for (let pageToken; ; ) {
    const data = await apiFetch(`${base}/records/search`, {
      token,
      method: 'POST',
      body: {},
      query: { page_size: 500, page_token: pageToken },
    });
    for (const item of data.items || []) {
      const values = {};
      for (const [name, raw] of Object.entries(item.fields || {})) {
        values[name] = flattenApiValue(raw);
      }
      records.push({ record_id: item.record_id, values });
    }
    if (!data.has_more) break;
    pageToken = data.page_token;
  }

  return { fields, records, via: 'open-api' };
}

/* ------------------------------------------------------------------ */

export async function fetchTable({ mode = 'cli' } = {}) {
  return mode === 'api' ? fetchViaApi() : fetchViaCli();
}
