import React from 'react';

import { Leaf } from './icons.jsx';

/**
 * 顶部导航。四个板块各自独占一屏，避免整页往下拉几千像素。
 * 做成动森的木牌样式：选中的那块牌子往下压、插一片叶子。
 */
export const VIEWS = [
  { key: 'wall', emoji: '🌿', label: '组队墙', sub: '全部选手' },
  { key: 'match', emoji: '🎯', label: '找队友', sub: '撮合 / 小助手' },
  { key: 'gap', emoji: '📊', label: '现在最缺', sub: '供需缺口' },
  { key: 'open', emoji: '🚀', label: '在招项目', sub: '谁还缺人' },
];

export default function NavBar({ view, setView, counts }) {
  return (
    <nav className="nav" aria-label="板块导航">
      <ul className="nav__list">
        {VIEWS.map((v) => {
          const on = view === v.key;
          return (
            <li key={v.key}>
              <button
                type="button"
                className="nav__item"
                data-on={String(on)}
                aria-current={on ? 'page' : undefined}
                onClick={() => setView(v.key)}
              >
                {on && <Leaf className="nav__leaf" tone="#7cc45c" />}
                <span className="nav__emoji" aria-hidden="true">
                  {v.emoji}
                </span>
                <span className="nav__text">
                  <span className="nav__label">{v.label}</span>
                  <span className="nav__sub">{counts?.[v.key] ?? v.sub}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
