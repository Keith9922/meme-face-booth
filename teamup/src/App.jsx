import React, { useMemo, useState } from 'react';
import { BackTop, Button, Card, Cursor, Divider, Footer, Input, Tabs, Title } from 'animal-island-ui';

import './styles/chips.css';
import './styles/card.css';

import WallCard from './components/WallCard.jsx';
import Chip from './components/Chip.jsx';
import { Cloud, SearchIcon } from './components/icons.jsx';
import { FILTER_ROLES } from './lib/taxonomy.js';
import wall from './data/wall.json';

const KINDS = [
  { key: 'all', label: '全部' },
  { key: 'project', label: '🚀 项目招募中' },
  { key: 'seeker', label: '🙋 找项目的人' },
];

/** 招募方向筛选：项目卡看「想招谁」，找项目卡看「我会什么」 */
function matchesRoles(entry, roles) {
  if (!roles.length) return true;
  const pool = (entry.kind === 'project' ? entry.recruit : entry.skills).join(' ');
  return roles.some((r) => pool.includes(r.match));
}

function matchesQuery(entry, q) {
  if (!q) return true;
  const hay = [
    entry.id,
    entry.project,
    entry.intro,
    entry.nickname,
    entry.extra,
    entry.skills.join(' '),
    entry.recruit.join(' '),
    entry.stage,
  ]
    .join(' ')
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

export default function App() {
  const [kind, setKind] = useState('all');
  const [roles, setRoles] = useState([]);
  const [query, setQuery] = useState('');

  const list = useMemo(
    () =>
      wall.entries.filter(
        (e) =>
          (kind === 'all' || e.kind === kind) && matchesRoles(e, roles) && matchesQuery(e, query),
      ),
    [kind, roles, query],
  );

  const toggleRole = (role) =>
    setRoles((prev) =>
      prev.some((r) => r.key === role.key) ? prev.filter((r) => r.key !== role.key) : [...prev, role],
    );

  const dirty = kind !== 'all' || roles.length > 0 || query !== '';
  const reset = () => {
    setKind('all');
    setRoles([]);
    setQuery('');
  };

  return (
    <Cursor>
      <div className="island-bg" aria-hidden="true" />

      <a className="skip-link" href="#wall">
        跳到卡片墙
      </a>

      <div className="page">
        <header className="hero">
          <Cloud className="hero__cloud hero__cloud--a" />
          <Cloud className="hero__cloud hero__cloud--b" />

          <span className="hero__badge">🌴 创作者黑客松 · 组队集市</span>

          <div className="hero__title">
            <Title size="large" color="app-yellow">
              队友招募墙
            </Title>
          </div>

          <p className="hero__lead">
            这里有 <b>{wall.counts.total}</b> 张纸条别在草地上。
            <br />
            正面是<b>「在做什么」</b>，翻过来是<b>「谁在做、怎么找到 ta」</b>。
            <br />
            看到心动的，直接翻面加上联系方式就行 —— 不需要等方案成熟。
          </p>

          <div className="stats">
            <div className="stat">
              <span className="stat__num">{wall.counts.project}</span>
              <span className="stat__label">个项目在招人</span>
            </div>
            <div className="stat">
              <span className="stat__num">{wall.counts.seeker}</span>
              <span className="stat__label">位创作者找队</span>
            </div>
            <div className="stat">
              <span className="stat__num">{wall.counts.total}</span>
              <span className="stat__label">位参赛选手</span>
            </div>
          </div>
        </header>

        <Divider type="wave-yellow" />

        {/* ------------------------------- 筛选 ------------------------------- */}
        <section className="toolbar" aria-label="筛选卡片">
          <div className="toolbar__row">
            <Tabs
              items={KINDS.map((k) => ({ key: k.key, label: k.label, children: null }))}
              activeKey={kind}
              onChange={setKind}
            />
            <div className="toolbar__search">
              <Input
                allowClear
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onClear={() => setQuery('')}
                placeholder="搜项目、关键词、昵称…"
                prefix={<SearchIcon />}
                aria-label="搜索项目或创作者"
              />
            </div>
          </div>

          <div className="toolbar__row">
            <span className="toolbar__label">招募方向</span>
            <div className="toolbar__tags">
              {FILTER_ROLES.map((role) => {
                const on = roles.some((r) => r.key === role.key);
                return (
                  <Chip
                    key={role.key}
                    tag={{ key: role.key, emoji: role.emoji, label: role.short, color: role.color }}
                    size="medium"
                    toggle
                    on={on}
                    onClick={() => toggleRole(role)}
                    title={on ? `取消筛选：${role.short}` : `只看要找 ${role.short} 的`}
                  />
                );
              })}
            </div>

            <span className="toolbar__count">
              共 <b>{list.length}</b> 张
            </span>

            {dirty && (
              <Button size="small" onClick={reset}>
                重置
              </Button>
            )}
          </div>
        </section>

        {/* ------------------------------- 卡片墙 ------------------------------- */}
        <ul className="wall" id="wall">
          {list.length ? (
            list.map((entry, i) => <WallCard key={entry.recordId} entry={entry} index={i} />)
          ) : (
            <li className="wall__empty">
              <Card type="dashed">
                <strong>这片草地上还没有符合条件的纸条 🍃</strong>
                换个关键词，或者点「重置」看看全部的 {wall.counts.total} 位选手。
              </Card>
            </li>
          )}
        </ul>
      </div>

      {/* 一万多像素的墙，滚到底得有路回来 */}
      <BackTop visibilityHeight={700} duration={520} />

      <Footer type="tree" />

      <footer className="foot">
        <div className="foot__plate">
          <p className="foot__note">
            数据来自飞书多维表格「创作者黑客松：队友招募墙」，
            <br />
            由参赛选手自愿填写，最后同步于 {new Date(wall.syncedAt).toLocaleString('zh-CN', { hour12: false })}。
          </p>
          <p className="foot__note">
            信息有误或想撤下自己的卡片？回到{' '}
            <a href={wall.source.wiki} target="_blank" rel="noreferrer noopener">
              飞书表格
            </a>{' '}
            修改即可。
          </p>
        </div>
      </footer>
    </Cursor>
  );
}
