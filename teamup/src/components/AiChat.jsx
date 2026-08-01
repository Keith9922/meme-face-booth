import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input } from 'animal-island-ui';

import { extractIds, streamChat } from '../lib/api.js';

const GREETING =
  '嗨！我看过这 98 位选手填的问卷。\n跟我说说你会点什么、想做什么方向，我帮你挑几个能一起干的。';

const SUGGESTIONS = [
  '我会写前端，想找个 AI 相关的项目',
  '我是做设计的，谁最需要我？',
  '我有想法但不会写代码，找谁搭伙',
  '现在最缺什么方向的人？',
];

/** 把回复里的 [023] 换成可点的角标 */
function renderText(text, byId, onOpen) {
  const parts = String(text).split(/(\[\d{2,4}\])/g);
  return parts.map((part, i) => {
    const m = part.match(/^\[(\d{2,4})\]$/);
    if (!m) return <React.Fragment key={i}>{part}</React.Fragment>;
    const entry = byId.get(m[1]);
    if (!entry) return <React.Fragment key={i}>{part}</React.Fragment>;
    return (
      <button
        key={i}
        type="button"
        className="chat__ref"
        onClick={() => onOpen(entry.recordId)}
        title={`跳到「${entry.project || entry.nickname}」`}
      >
        NO.{m[1]}
      </button>
    );
  });
}

export default function AiChat({ entries, onOpen }) {
  const [messages, setMessages] = useState([{ role: 'assistant', content: GREETING }]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);
  const abortRef = useRef(null);

  const byId = React.useMemo(() => new Map(entries.map((e) => [String(e.id), e])), [entries]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (text) => {
      const content = String(text ?? draft).trim();
      if (!content || busy) return;

      setError('');
      setDraft('');
      setBusy(true);

      const history = [...messages, { role: 'user', content }];
      // 先塞一条空的助手消息，流式增量往里填
      setMessages([...history, { role: 'assistant', content: '' }]);

      const ac = new AbortController();
      abortRef.current = ac;

      try {
        await streamChat(
          history.filter((m) => m.content),
          {
            signal: ac.signal,
            onText: (_delta, full) => {
              setMessages((prev) => {
                const next = prev.slice();
                next[next.length - 1] = { role: 'assistant', content: full };
                return next;
              });
            },
          },
        );
      } catch (err) {
        if (err.name !== 'AbortError') {
          setError(err.message || '小助手暂时不在，稍后再试。');
          // 把那条空气泡收掉，别留个空白
          setMessages((prev) => (prev[prev.length - 1]?.content ? prev : prev.slice(0, -1)));
        }
      } finally {
        setBusy(false);
      }
    },
    [draft, busy, messages],
  );

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="chat">
      <div className="chat__scroll" ref={scrollRef}>
        {messages.map((m, i) => {
          const streaming = busy && i === messages.length - 1 && m.role === 'assistant';
          const ids = m.role === 'assistant' ? extractIds(m.content) : [];
          return (
            <div key={i} className="chat__msg" data-role={m.role}>
              {m.role === 'assistant' && (
                <span className="chat__avatar" aria-hidden="true">
                  🦉
                </span>
              )}
              <div className="chat__bubble">
                {m.content ? renderText(m.content, byId, onOpen) : null}
                {streaming && <span className="chat__caret" aria-hidden="true" />}
                {!streaming && ids.length > 0 && (
                  <div className="chat__cards">
                    {ids
                      .map((id) => byId.get(id))
                      .filter(Boolean)
                      .map((e) => (
                        <button
                          key={e.recordId}
                          type="button"
                          className="chat__card"
                          onClick={() => onOpen(e.recordId)}
                        >
                          <b>{e.project || e.nickname}</b>
                          <span>{(e.intro || e.extra || '点开看详情').slice(0, 34)}</span>
                          <em>翻面看联系方式 →</em>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {error && <p className="chat__error">{error}</p>}
      </div>

      {messages.length <= 1 && (
        <div className="chat__suggest">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="chat__chip" onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="chat__composer">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={busy ? '小助手正在想…' : '说说你会什么、想做什么'}
          disabled={busy}
          aria-label="跟组队小助手说话"
        />
        <Button type="primary" onClick={() => send()} disabled={busy || !draft.trim()}>
          发送
        </Button>
      </div>

      <p className="chat__privacy">
        对话只发到本站后端调用 MiniMax M3，不会带上任何人的联系方式。
      </p>
    </div>
  );
}
