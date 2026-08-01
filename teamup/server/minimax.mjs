/**
 * MiniMax M3 客户端。
 *
 * MiniMax 提供 Anthropic 兼容端点，所以直接用 /v1/messages 的协议，
 * 不需要引任何 SDK（这个服务刻意做到零依赖，部署就是拷贝 + systemd）。
 *
 * 文档：https://platform.minimaxi.com/docs/token-plan/quickstart
 */

const BASE = process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/anthropic';
const MODEL = process.env.MINIMAX_MODEL || 'MiniMax-M3';

function apiKey() {
  const k = process.env.MINIMAX_API_KEY;
  if (!k) throw new Error('MINIMAX_API_KEY 未设置');
  return k;
}

function headers() {
  return {
    'x-api-key': apiKey(),
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
}

/** 一次性返回完整文本 */
export async function complete({ system, messages, maxTokens = 900, temperature = 0.6 }) {
  const res = await fetch(`${BASE}/v1/messages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, temperature, system, messages }),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.type === 'error') {
    const msg = json?.error?.message || `HTTP ${res.status}`;
    throw new Error(`MiniMax 调用失败: ${msg}`);
  }

  // M3 会返回 thinking 块，展示给用户的只取 text
  return (json.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('')
    .trim();
}

/**
 * 流式输出。回调只吐可见文本增量，thinking 块直接丢掉 ——
 * 前端要的是回答，不是模型的内心戏。
 */
export async function stream({ system, messages, maxTokens = 900, temperature = 0.6, onText, signal }) {
  const res = await fetch(`${BASE}/v1/messages`, {
    method: 'POST',
    headers: headers(),
    signal,
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      temperature,
      system,
      messages,
      stream: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`MiniMax 流式调用失败: HTTP ${res.status} ${body.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let blockType = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE 以空行分帧
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);

      const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      const payload = dataLine.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      let evt;
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }

      if (evt.type === 'content_block_start') blockType = evt.content_block?.type;
      else if (evt.type === 'content_block_stop') blockType = null;
      else if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
        if (blockType !== 'thinking' && evt.delta.text) onText(evt.delta.text);
      }
    }
  }
}
