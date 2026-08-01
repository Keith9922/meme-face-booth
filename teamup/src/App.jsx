import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackTop, Card, Cursor, Footer, Title } from 'animal-island-ui';

import './styles/chips.css';
import './styles/card.css';
import './styles/sections.css';

import WallCard from './components/WallCard.jsx';
import FilterBar, { FLAGS } from './components/FilterBar.jsx';
import GapBars from './components/GapBars.jsx';
import Matchmaker from './components/Matchmaker.jsx';
import OpenProjects from './components/OpenProjects.jsx';
import NavBar from './components/NavBar.jsx';
import { Cloud } from './components/icons.jsx';
import { FILTER_ROLES, roleKeys } from './lib/taxonomy.js';
import { gapAnalysis, openProjects, scoreEntry } from './lib/analytics.js';
import useLiveWall from './lib/useLiveWall.js';

function matchesQuery(entry, q) {
  if (!q) return true;
  const hay = [entry.id, entry.project, entry.intro, entry.nickname, entry.extra, entry.stage]
    .concat(entry.skills, entry.recruit)
    .join(' ')
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

const VIEW_KEYS = ['wall', 'match', 'gap', 'open'];
const viewFromHash = () => {
  const h = window.location.hash.replace('#', '');
  return VIEW_KEYS.includes(h) ? h : 'wall';
};

export default function App() {
  // 板块跟 URL hash 绑定：可以直接把 #match 发给别人，浏览器前进后退也管用
  const [view, setViewState] = useState(viewFromHash);
  const setView = useCallback((next) => {
    setViewState(next);
    if (window.location.hash.replace('#', '') !== next) {
      window.history.pushState(null, '', `#${next}`);
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  useEffect(() => {
    const onPop = () => setViewState(viewFromHash());
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
    };
  }, []);

  // 首屏用 bundle 里的数据，挂载后拉一次 /api/wall；飞书更新过就自动换成新的
  const { wall, live } = useLiveWall();

  const { ENTRIES, GAPS, OPEN_PROJECTS, DEMAND, SUPPLY, ROLE_INDEX } = useMemo(() => {
    const entries = wall.entries;
    const gaps = gapAnalysis(entries);
    return {
      ENTRIES: entries,
      GAPS: gaps,
      OPEN_PROJECTS: openProjects(entries),
      DEMAND: Object.fromEntries(gaps.map((g) => [g.key, g.demand])),
      SUPPLY: Object.fromEntries(gaps.map((g) => [g.key, g.supply])),
      // 预先归一化每条记录的方向，筛选时就不用反复解析那些长文案
      ROLE_INDEX: new Map(
        entries.map((e) => [e.recordId, { needs: roleKeys(e.recruit), has: roleKeys(e.skills) }]),
      ),
    };
  }, [wall]);

  const [kind, setKind] = useState('all');
  const [query, setQuery] = useState('');
  const [needRoles, setNeedRoles] = useState([]);
  const [haveRoles, setHaveRoles] = useState([]);
  const [stages, setStages] = useState([]);
  const [flags, setFlags] = useState([]);
  const [sortByMatch, setSortByMatch] = useState(false);
  const [profile, setProfile] = useState(null);
  const [focusId, setFocusId] = useState(null);

  const wallRef = useRef(null);

  const toggle = (setter) => (key) =>
    setter((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const list = useMemo(() => {
    let out = ENTRIES.filter((e) => {
      if (kind !== 'all' && e.kind !== kind) return false;
      if (!matchesQuery(e, query)) return false;

      const idx = ROLE_INDEX.get(e.recordId);
      if (needRoles.length && !needRoles.some((r) => idx.needs.includes(r))) return false;
      if (haveRoles.length && !haveRoles.some((r) => idx.has.includes(r))) return false;
      if (stages.length && !stages.includes(e.stage)) return false;
      if (flags.length) {
        const defs = FLAGS.filter((f) => flags.includes(f.key));
        if (!defs.some((f) => f.test(e))) return false;
      }
      return true;
    });

    if (sortByMatch && profile) {
      out = out
        .map((e) => ({ e, s: scoreEntry(profile, e).score }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.e);
    }
    return out;
  }, [ENTRIES, ROLE_INDEX, kind, query, needRoles, haveRoles, stages, flags, sortByMatch, profile]);

  const dirty =
    kind !== 'all' ||
    query !== '' ||
    needRoles.length > 0 ||
    haveRoles.length > 0 ||
    stages.length > 0 ||
    flags.length > 0 ||
    sortByMatch;

  const reset = () => {
    setKind('all');
    setQuery('');
    setNeedRoles([]);
    setHaveRoles([]);
    setStages([]);
    setFlags([]);
    setSortByMatch(false);
  };

  /**
   * 从缺口条 / 推荐结果 / 小助手气泡跳到墙上某张卡。
   * 要先切回组队墙这个板块、再清掉筛选（否则目标可能正好被筛掉），
   * 两次 rAF 是等 React 把新板块和重置后的列表都渲染进 DOM。
   */
  const openCard = useCallback((recordId) => {
    setView('wall');
    reset();
    setFocusId(recordId);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-record="${recordId}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }),
    );
  }, []);

  const pickRole = useCallback((roleKey) => {
    setNeedRoles((prev) => (prev.includes(roleKey) ? prev.filter((k) => k !== roleKey) : [roleKey]));
    setView('wall');
    requestAnimationFrame(() =>
      requestAnimationFrame(() => wallRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })),
    );
  }, []);

  const scarce = GAPS.find((g) => g.gap > 0);

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
            正面是<b>「在做什么」</b>，翻过来是<b>「谁在做、怎么找到 ta」</b>。
          </p>
        </header>

        <NavBar
          view={view}
          setView={setView}
          // 全站的数字只在这里出现一次：每块牌子报自己那一栏的量
          counts={{
            wall: `${wall.counts.total} 位选手`,
            match: '算互补度 / 问 AI',
            gap: scarce ? `最缺 ${scarce.short} +${scarce.gap}` : '供需缺口',
            open: `${OPEN_PROJECTS.length} 个项目`,
          }}
        />

        <main className="view" key={view}>
          {view === 'match' && (
            <Matchmaker
              entries={ENTRIES}
              onOpen={openCard}
              onProfile={(p) => {
                setProfile(p);
                setSortByMatch(false);
              }}
            />
          )}

          {view === 'gap' && (
            <GapBars
              gaps={GAPS}
              onPick={pickRole}
              activeRole={needRoles.length === 1 ? needRoles[0] : null}
            />
          )}

          {view === 'open' && <OpenProjects projects={OPEN_PROJECTS} onOpen={openCard} />}

          {view === 'wall' && (
            <section className="section" ref={wallRef}>
              <header className="section__head section__head--tight">
                <h2 className="section__title">全部 {wall.counts.total} 位选手</h2>
                <p className="section__lead">
                  点卡片翻面看发起人和联系方式。
                  只想看还缺人的项目就去
                  <button type="button" className="section__jump" onClick={() => setView('open')}>
                    在招项目
                  </button>
                  ，不知道找谁就让
                  <button type="button" className="section__jump" onClick={() => setView('match')}>
                    小助手推荐
                  </button>
                  。
                </p>
              </header>

              <FilterBar
                kind={kind}
                setKind={setKind}
                query={query}
                setQuery={setQuery}
                needRoles={needRoles}
                toggleNeed={toggle(setNeedRoles)}
                haveRoles={haveRoles}
                toggleHave={toggle(setHaveRoles)}
                stages={stages}
                toggleStage={toggle(setStages)}
                flags={flags}
                toggleFlag={toggle(setFlags)}
                sortByMatch={sortByMatch}
                setSortByMatch={setSortByMatch}
                canSortByMatch={Boolean(profile)}
                demandCounts={DEMAND}
                supplyCounts={SUPPLY}
                count={list.length}
                dirty={dirty}
                onReset={reset}
              />

              <ul className="wall" id="wall">
                {list.length ? (
                  list.map((entry, i) => (
                    <WallCard
                      key={entry.recordId}
                      entry={entry}
                      index={i}
                      focused={focusId === entry.recordId}
                      onFocusHandled={() => setFocusId(null)}
                    />
                  ))
                ) : (
                  <li className="wall__empty">
                    <Card type="dashed">
                      <strong>这片草地上还没有符合条件的纸条 🍃</strong>
                      换个关键词，或者点「重置」看看全部的 {wall.counts.total} 位选手。
                    </Card>
                  </li>
                )}
              </ul>
            </section>
          )}
        </main>
      </div>

      <BackTop visibilityHeight={700} duration={520} />

      <Footer type="tree" />

      <footer className="foot">
        <div className="foot__plate">
          <p className="foot__note">
            数据来自飞书多维表格「创作者黑客松：队友招募墙」，
            <br />
            由参赛选手自愿填写，最后同步于{' '}
            {new Date(wall.syncedAt).toLocaleString('zh-CN', { hour12: false })}
            {live ? '（本页已从服务端取到最新一份）' : ''}。
          </p>
          <p className="foot__note">
            撮合小助手由 MiniMax M3 驱动，只读得到项目和能力标签，读不到任何人的联系方式。
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
