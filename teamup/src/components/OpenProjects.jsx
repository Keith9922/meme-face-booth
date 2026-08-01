import React, { useState } from 'react';
import { Button, Card } from 'animal-island-ui';

import Chip from './Chip.jsx';
import { toTag, toTags, ROLE_TAGS, STAGE_TAGS } from '../lib/taxonomy.js';

const FIRST_BATCH = 12;

/**
 * 「在招项目都在做什么」——一行一个，按进度从推进得最远的排下来。
 * 想加入的人在这一屏就能扫完全部在招的项目，不用一张张翻卡片。
 */
export default function OpenProjects({ projects, onOpen }) {
  const [all, setAll] = useState(false);
  const shown = all ? projects : projects.slice(0, FIRST_BATCH);

  return (
    <section className="section" aria-labelledby="op-title">
      <header className="section__head">
        <span className="section__kicker">WHAT&apos;S BEING BUILT</span>
        <h2 className="section__title" id="op-title">
          在招项目都在做什么
        </h2>
        <p className="section__lead">
          只列<b>还缺人的 {projects.length} 个项目</b>，按推进程度从「已有 Demo」往下排 ——
          想加入的话从这里扫最快。点一行跳到那张卡片，翻面就是联系方式。
        </p>
      </header>

      <Card>
        {/* 每行结构固定：编号+进度 / 项目名 / 发起人 / 介绍 / 缺口。
            之前把名字、发起人、进度挤在同一行，遇到 50 字的项目名就整块塌掉。 */}
        <ul className="ops">
          {shown.map((p) => {
            const stage = toTag(p.stage, STAGE_TAGS);
            const needs = toTags(p.recruit, ROLE_TAGS);
            return (
              <li key={p.recordId}>
                <button type="button" className="ops__row" onClick={() => onOpen(p.recordId)}>
                  <span className="ops__meta">
                    <span className="ops__no">NO.{p.id}</span>
                    {stage && <Chip tag={stage} />}
                  </span>

                  <span className="ops__name" title={p.project}>
                    {p.project}
                  </span>

                  <span className="ops__by">{p.nickname}</span>

                  <span className="ops__intro">{p.intro || '（没写介绍，翻面直接问 ta）'}</span>

                  <span className="ops__need">
                    <span className="ops__need-label">缺</span>
                    {needs.map((t, i) => (
                      <Chip key={`${t.key}-${i}`} tag={t} />
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {!all && projects.length > FIRST_BATCH && (
          <Button block onClick={() => setAll(true)} style={{ marginTop: 14 }}>
            展开全部 {projects.length} 个项目
          </Button>
        )}
      </Card>
    </section>
  );
}
