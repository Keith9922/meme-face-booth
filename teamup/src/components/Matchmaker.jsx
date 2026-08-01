import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Button, Card, Checkbox, Input, Radio, Tabs } from 'animal-island-ui';

import Chip from './Chip.jsx';
import AiChat from './AiChat.jsx';
import { FILTER_ROLES } from '../lib/taxonomy.js';
import { rankMatches } from '../lib/analytics.js';
import { requestMatch } from '../lib/api.js';

const ROLE_OPTIONS = FILTER_ROLES.map((r) => ({ label: `${r.emoji} ${r.short}`, value: r.key }));

const INTENTS = [
  { label: '🤝 我想加入别人的项目', value: 'join' },
  { label: '🚀 我在招队友', value: 'lead' },
  { label: '🌟 都行', value: 'both' },
];

const STAGE_OPTIONS = [
  { label: '🌱 刚有想法', value: '刚有一个想法' },
  { label: '📐 有方案了', value: '已经有方案设计' },
  { label: '🔨 已开工', value: '已经开始制作' },
  { label: '✨ 跑通一部分', value: '已完成部分功能' },
  { label: '🚀 已有 Demo', value: '已有 Demo' },
];

/** 一条推荐结果 */
function MatchRow({ m, rank, onOpen }) {
  return (
    <li className="mm__row">
      <button type="button" className="mm__rowbtn" onClick={() => onOpen(m.recordId)}>
        <span className="mm__rank" data-top={String(rank === 1)}>
          {rank}
        </span>

        <span className="mm__body">
          <span className="mm__name">
            {m.project || m.nickname}
            <span className="mm__no">NO.{m.id}</span>
          </span>
          {m.intro && <span className="mm__intro">{m.intro}</span>}
          <span className="mm__why">
            {m.reasons.slice(0, 2).map((r, i) => (
              <span key={i} className="mm__reason" data-neg={String(r.pts < 0)}>
                {r.text}
              </span>
            ))}
          </span>
        </span>

        <span className="mm__score" title="互补度，越高越值得先去聊">
          <b>{m.score}</b>
          <small>互补度</small>
        </span>
      </button>
    </li>
  );
}

function MatchForm({ entries, onOpen, onProfile }) {
  const [skills, setSkills] = useState([]);
  const [wants, setWants] = useState([]);
  const [intent, setIntent] = useState('join');
  const [stages, setStages] = useState([]);
  const [keywords, setKeywords] = useState('');

  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const abortRef = useRef(null);

  const profile = useMemo(
    () => ({ skills, wants, intent, stages, keywords }),
    [skills, wants, intent, stages, keywords],
  );

  const run = useCallback(async () => {
    if (!skills.length && !wants.length && !keywords.trim()) {
      setNote('至少选一个「我会什么」，或者写点感兴趣的方向，不然没法算互补度。');
      return;
    }
    setNote('');
    setBusy(true);
    // 把画像交给上层，下面那面墙就能用「按匹配度排」
    onProfile?.(profile);

    // 先用本地算法出结果 —— 后端挂了也要能用，AI 只是锦上添花
    const local = rankMatches(profile, entries, { limit: 8 }).map((r) => ({
      id: r.entry.id,
      recordId: r.entry.recordId,
      project: r.entry.project,
      nickname: r.entry.nickname,
      intro: r.entry.intro,
      score: r.score,
      reasons: r.reasons,
    }));
    setResult({ matches: local, summary: '' });

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const remote = await requestMatch(profile, { signal: ac.signal });
      if (!ac.signal.aborted) setResult({ matches: remote.matches, summary: remote.summary });
    } catch (err) {
      if (err.name !== 'AbortError') {
        setNote('小助手写推荐语失败了，下面这份是本机算出来的，同样可用。');
      }
    } finally {
      if (!ac.signal.aborted) setBusy(false);
    }
  }, [profile, entries, skills.length, wants.length, keywords]);

  return (
    <div className="mm">
      <div className="mm__form">
        <div className="mm__field">
          <span className="mm__label">我会这些</span>
          <Checkbox options={ROLE_OPTIONS} value={skills} onChange={setSkills} size="small" />
        </div>

        <div className="mm__field">
          <span className="mm__label">我想找这些</span>
          <Checkbox options={ROLE_OPTIONS} value={wants} onChange={setWants} size="small" />
        </div>

        <div className="mm__field">
          <span className="mm__label">我的打算</span>
          <Radio options={INTENTS} value={intent} onChange={setIntent} size="small" />
        </div>

        <div className="mm__field">
          <span className="mm__label">
            想参与什么阶段的项目 <em>选填</em>
          </span>
          <Checkbox options={STAGE_OPTIONS} value={stages} onChange={setStages} size="small" />
        </div>

        <div className="mm__field">
          <span className="mm__label">
            感兴趣的方向 <em>选填，空格分隔</em>
          </span>
          <Input
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="例如：AI 教育 情绪 音乐 小程序"
            allowClear
            onClear={() => setKeywords('')}
          />
        </div>

        <Button type="primary" size="large" block loading={busy} onClick={run}>
          {busy ? '正在算…' : '给我推荐队友 →'}
        </Button>

        {note && <p className="mm__note">{note}</p>}
        <p className="mm__privacy">
          你填的东西只用来算这一次推荐，不保存、不关联到任何人。
        </p>
      </div>

      <div className="mm__result" aria-live="polite">
        {!result && (
          <div className="mm__empty">
            <span aria-hidden="true">🍀</span>
            <p>
              勾几个选项，点上面的按钮。
              <br />
              算法只看一件事：<b>你会的，是不是正好是对方缺的。</b>
            </p>
          </div>
        )}

        {result && result.matches.length === 0 && (
          <div className="mm__empty">
            <span aria-hidden="true">🤔</span>
            <p>
              按这个条件没找到互补的。
              <br />
              试试少勾几个「我想找」，或者换个方向的关键词。
            </p>
          </div>
        )}

        {result && result.matches.length > 0 && (
          <>
            {result.summary && (
              <div className="mm__summary">
                <span className="mm__summary-tag">小助手说</span>
                {result.summary}
              </div>
            )}
            <ol className="mm__list">
              {result.matches.map((m, i) => (
                <MatchRow key={m.recordId || m.id} m={m} rank={i + 1} onOpen={onOpen} />
              ))}
            </ol>
            <p className="mm__tip">点任意一条，跳到墙上那张卡片，翻面就是联系方式。</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function Matchmaker({ entries, onOpen, onProfile }) {
  return (
    <section className="section" aria-labelledby="mm-title">
      <header className="section__head">
        <span className="section__kicker">MATCHMAKER</span>
        <h2 className="section__title" id="mm-title">
          找到你的队友
        </h2>
        <p className="section__lead">
          两种找法：勾选标签让算法算互补度，或者直接跟小助手说人话。
        </p>
      </header>

      <Card>
        <Tabs
          items={[
            {
              key: 'form',
              label: '🎯 按标签匹配',
              children: <MatchForm entries={entries} onOpen={onOpen} onProfile={onProfile} />,
            },
            {
              key: 'chat',
              label: '💬 问问小助手',
              children: <AiChat entries={entries} onOpen={onOpen} />,
            },
          ]}
          defaultActiveKey="form"
        />
      </Card>
    </section>
  );
}
