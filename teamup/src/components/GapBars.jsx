import React from 'react';
import { Card } from 'animal-island-ui';

import Chip from './Chip.jsx';

/**
 * 「现在最缺什么」——左边有多少人在招，右边有多少人会做，差值越大越稀缺。
 * 点任意一栏，直接把墙筛到对应的人。
 */
export default function GapBars({ gaps, onPick, activeRole }) {
  const max = Math.max(...gaps.flatMap((g) => [g.demand, g.supply]), 1);

  return (
    <section className="section" aria-labelledby="gap-title">
      <header className="section__head">
        <span className="section__kicker">SUPPLY / DEMAND</span>
        <h2 className="section__title" id="gap-title">
          现在最缺什么
        </h2>
        <p className="section__lead">
          左边是「多少人在招这个方向」，右边是「多少人会做」。差值越大，你在这场里就越稀缺。
        </p>
      </header>

      <Card>
        <ul className="gaps">
          {gaps.map((g) => {
            const short = g.gap > 0;
            const on = activeRole === g.key;
            return (
              <li key={g.key} className="gap" data-on={String(on)}>
                <button
                  type="button"
                  className="gap__btn"
                  onClick={() => onPick(g.key)}
                  aria-pressed={on}
                  title={on ? '取消这个筛选' : `筛出所有要找${g.short}的`}
                >
                  <span className="gap__name">
                    {g.emoji} {g.short}
                  </span>

                  <span className="gap__bars">
                    <span className="gap__side gap__side--demand">
                      <span className="gap__num">{g.demand}</span>
                      <span className="gap__track">
                        <span
                          className="gap__fill gap__fill--demand"
                          style={{ width: `${(g.demand / max) * 100}%` }}
                        />
                      </span>
                      <span className="gap__cap">人在招</span>
                    </span>

                    <span className="gap__side gap__side--supply">
                      <span className="gap__cap">人会做</span>
                      <span className="gap__track">
                        <span
                          className="gap__fill gap__fill--supply"
                          style={{ width: `${(g.supply / max) * 100}%` }}
                        />
                      </span>
                      <span className="gap__num">{g.supply}</span>
                    </span>
                  </span>

                  <span className="gap__verdict" data-short={String(short)}>
                    <b>
                      {g.gap > 0 ? '+' : ''}
                      {g.gap}
                    </b>
                    {short ? '人手不够' : '供大于求'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="gaps__hint">点任意一栏，下面的组队墙会直接筛出「要找这个方向」的人。</p>
      </Card>
    </section>
  );
}

/** 头部那句「现在最缺 X」 */
export function ScarcityBadge({ top }) {
  if (!top) return null;
  return (
    <span className="hero__scarce">
      现在最缺 <Chip tag={{ key: top.key, emoji: top.emoji, label: top.short, color: top.color }} />
      <b>
        缺口 +{top.gap}
      </b>
      <span className="hero__scarce-sub">
        （{top.demand} 人在招 · 只有 {top.supply} 人会）
      </span>
    </span>
  );
}
