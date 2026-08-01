import { useEffect, useState } from 'react';

import bundled from '../data/wall.json';

/**
 * 名册数据：先用构建时打进 bundle 的那份（首屏零等待、后端挂了也能看），
 * 挂载后再去问一次后端；后端那份更新就换掉。
 *
 * 这样飞书表格更新之后，链路是
 *   定时器同步 → 后端热重载 → 用户刷新页面就是最新的，
 * 完全不需要重新构建和部署前端。
 */
export default function useLiveWall({ pollMs = 0 } = {}) {
  const [wall, setWall] = useState(bundled);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const pull = async () => {
      try {
        const res = await fetch('/api/wall', { headers: { accept: 'application/json' } });
        if (!res.ok) return;
        const next = await res.json();
        if (cancelled || !next?.entries?.length) return;

        // 只在服务端确实更新时才替换 —— 避免无谓的整树重渲染
        setWall((cur) => (next.syncedAt && next.syncedAt !== cur.syncedAt ? next : cur));
        setLive(true);
      } catch {
        // 静态托管（比如 Vercel 那份）没有后端，这里失败是预期内的，
        // 页面继续用 bundle 里的数据，什么都不用提示。
      }
    };

    pull();
    if (!pollMs) return () => {
      cancelled = true;
    };

    const t = setInterval(pull, pollMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [pollMs]);

  return { wall, live };
}
