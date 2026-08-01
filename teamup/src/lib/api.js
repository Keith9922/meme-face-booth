/**
 * 撮合后端的调用封装。
 * 路径一律用同源的 /api —— 开发时 vite 代理到 127.0.0.1:4611，线上由 nginx 反代。
 */

/** 表单撮合。后端算分是确定性的，AI 只负责写那句推荐语 */
export async function requestMatch(profile, { signal } = {}) {
  const res = await fetch('/api/match', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(profile),
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `匹配失败（HTTP ${res.status}）`);
  }
  return res.json();
}

/**
 * 流式对话。逐段回调文本，返回完整文本。
 * 后端发的是 SSE：`event: delta|done|error` + `data: {...}`。
 */
export async function streamChat(messages, { onText, signal } = {}) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `小助手连不上（HTTP ${res.status}）`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);

      const event = frame.match(/^event:\s*(.+)$/m)?.[1]?.trim();
      const dataRaw = frame.match(/^data:\s*(.*)$/m)?.[1];
      if (!event || dataRaw == null) continue;

      let data;
      try {
        data = JSON.parse(dataRaw);
      } catch {
        continue;
      }

      if (event === 'delta' && data.text) {
        full += data.text;
        onText?.(data.text, full);
      } else if (event === 'error') {
        throw new Error(data.message || '小助手出错了');
      }
    }
  }

  return full;
}

/** 从回复里抓出 [023] 这样的编号，用来在气泡下面渲染真实卡片 */
export function extractIds(text) {
  return [...new Set([...String(text).matchAll(/\[(\d{2,4})\]/g)].map((m) => m[1]))];
}
