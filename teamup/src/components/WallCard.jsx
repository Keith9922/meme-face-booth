import React, { useCallback, useState } from 'react';
import { Card } from 'animal-island-ui';

import Chip from './Chip.jsx';
import { Leaf, FlipIcon } from './icons.jsx';
import {
  ROLE_TAGS,
  STAGE_TAGS,
  TEAM_MODE_TAGS,
  POSITION_TAGS,
  MOTIVATION_TAGS,
  MATCH_TAGS,
  toTag,
  toTags,
} from '../lib/taxonomy.js';

/** 别针叶子的颜色，按 seed 轮换，让整面墙有色彩节奏 */
const LEAF_TONES = ['#7cc45c', '#f2b04e', '#7fc9c0', '#e88ba0', '#a48bd8', '#5fb8e0'];

/** 头像位上的小动物，同样按 seed 定 —— 纯装饰，不代表任何身份信息 */
const CRITTERS = ['🐰', '🦊', '🐻', '🐨', '🐸', '🐤', '🐱', '🦉', '🐿️', '🐧'];

function pick(list, seed) {
  return list[Math.floor(seed * list.length) % list.length];
}

/** 一组标签，空数组时返回 null 而不是留个空壳 */
function TagRow({ items, className = 'field__tags' }) {
  if (!items.length) return null;
  return (
    <div className={className}>
      {items.map((t, i) => (
        <Chip key={`${t.key}-${i}`} tag={t} />
      ))}
    </div>
  );
}

function Field({ label, children }) {
  if (!children) return null;
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      {children}
    </div>
  );
}

export default function WallCard({ entry, index }) {
  const [flipped, setFlipped] = useState(false);
  const [copied, setCopied] = useState(false);

  const isProject = entry.kind === 'project';
  const leaf = pick(LEAF_TONES, entry.seed);
  const critter = pick(CRITTERS, entry.seed * 7.3);

  // 歪斜角固定在 ±2.4° —— 再大就开始影响阅读了
  const rot = (entry.seed * 2 - 1) * 2.4;
  const lift = Math.round(entry.seed * 18);

  const recruitTags = toTags(entry.recruit, ROLE_TAGS);
  const skillTags = toTags(entry.skills, ROLE_TAGS);

  // 用户正在划词复制联系方式时，这一下点击是「结束选中」而不是「翻面」。
  // 只看选区是不是落在这张卡里 —— 光判断 getSelection() 非空的话，
  // 页面上任何地方（比如搜索框）残留一段选中就会让所有卡片点不动。
  const selectionInsideCard = (node) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return false;
    return node ? sel.containsNode(node, true) : false;
  };

  const toggle = useCallback((e) => {
    if (selectionInsideCard(e?.currentTarget)) return;
    setFlipped((v) => !v);
  }, []);

  const onKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        // 空格默认会滚动页面
        e.preventDefault();
        setFlipped((v) => !v);
      } else if (e.key === 'Escape' && flipped) {
        setFlipped(false);
      }
    },
    [flipped],
  );

  const copyContact = useCallback(
    async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(entry.contact);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      } catch {
        // 剪贴板被浏览器策略挡了（非 https / 无权限）——选中文本让用户自己复制
        const node = e.currentTarget.parentElement?.querySelector('.contact__value');
        if (node) {
          const range = document.createRange();
          range.selectNodeContents(node);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      }
    },
    [entry.contact],
  );

  const title = isProject ? entry.project || entry.intro : entry.nickname;
  const longTitle = title.length > 18;

  // 找项目的人没有「一句话介绍」这一栏，就把 ta 自己写下的东西拼出来当正文。
  // 不要用「还没有自己的项目…」这种模板句 —— 33 张卡片一模一样，等于没信息。
  const blurb = isProject
    ? entry.intro
    : [entry.motivation, entry.extra]
        .filter(Boolean)
        // 「我喜欢提出新的想法」是选项文案，末尾没有标点，直接接补充信息会连成一句
        .map((s) => (/[。！？~～!?.…]$/.test(s) ? s : `${s}。`))
        .join('');

  // 内容短的时候放大字号，把卡片撑满；否则短文案会在纸条中间留一大块空白，
  // 看上去像没加载完。
  // 72 这个界限是照着「4 行以内」定的：再多就该顶格排 + 底部渐隐了。
  const density = blurb.length <= 24 ? 'xs' : blurb.length <= 72 ? 'sm' : 'md';

  return (
    <li
      className="pin"
      data-flipped={String(flipped)}
      style={{
        '--rot': `${rot.toFixed(2)}deg`,
        '--lift': `${lift}px`,
        // 入场按顺序错开，但封顶 600ms，免得最后几张等太久
        '--delay': `${Math.min(index * 34, 600)}ms`,
      }}
    >
      <Leaf className="leaf" tone={leaf} />

      <div
        className="pin__inner"
        role="button"
        tabIndex={0}
        aria-pressed={flipped}
        aria-label={
          isProject
            ? `项目「${entry.project}」，${flipped ? '正在看发起人信息，按回车翻回正面' : '按回车翻面看发起人和联系方式'}`
            : `创作者「${entry.nickname}」，${flipped ? '正在看联系方式，按回车翻回正面' : '按回车翻面看联系方式'}`
        }
        onClick={toggle}
        onKeyDown={onKeyDown}
      >
        {/* ---------------- 正面 ---------------- */}
        <div className="face face--front" aria-hidden={flipped}>
          <Card>
            <div className="card__top">
              <span className="card__no">NO.{entry.id}</span>
              <span className="card__kind" data-kind={entry.kind}>
                {isProject ? '🚀 项目招募' : '🙋 找项目中'}
              </span>
            </div>

            <h3 className="card__title" data-long={String(longTitle)}>
              {title}
            </h3>
            <div className="card__rule" />

            {blurb ? (
              <p className="card__intro" data-density={density}>
                {blurb}
              </p>
            ) : (
              <p className="card__intro card__intro--muted" data-density="sm">
                {isProject
                  ? '还没写介绍，翻面直接问问 ta 在做什么。'
                  : '还没写想做什么，翻面认识一下也不错。'}
              </p>
            )}

            <div className="card__foot">
              {isProject ? (
                <>
                  <span className="card__foot-label">想找这样的伙伴</span>
                  {recruitTags.length ? (
                    <TagRow items={recruitTags} className="taglist" />
                  ) : (
                    <span className="card__foot-empty">还没写，翻面聊聊看</span>
                  )}
                </>
              ) : (
                <>
                  <span className="card__foot-label">我能帮上忙的方向</span>
                  {skillTags.length ? (
                    <TagRow items={skillTags} className="taglist" />
                  ) : (
                    <span className="card__foot-empty">翻面看看 ta 是谁</span>
                  )}
                </>
              )}
            </div>

            <span className="card__flip-hint">
              翻面 <FlipIcon />
            </span>
          </Card>
        </div>

        {/* ---------------- 背面 ---------------- */}
        <div className="face face--back" aria-hidden={!flipped}>
          <Card>
            <div className="back__head">
              <span className="back__avatar" aria-hidden="true">
                {critter}
              </span>
              <span className="back__who">
                <span className="back__role">{isProject ? '项目发起人' : '想加入的创作者'}</span>
                <span className="back__name" title={entry.nickname}>
                  {entry.nickname}
                </span>
              </span>
            </div>

            <div className="contact">
              <span className="contact__icon" aria-hidden="true">
                📮
              </span>
              {entry.contact ? (
                <>
                  <span className="contact__value">{entry.contact}</span>
                  <button
                    type="button"
                    className="contact__copy"
                    data-copied={String(copied)}
                    tabIndex={flipped ? 0 : -1}
                    onClick={copyContact}
                  >
                    {copied ? '已复制' : '复制'}
                  </button>
                </>
              ) : (
                <span className="contact__value contact__value--empty">未留联系方式</span>
              )}
            </div>

            <div className="back__scroll">
              <Field label={isProject ? '想招募的伙伴' : '想加入的方向'}>
                <TagRow items={recruitTags} />
              </Field>

              <Field label="ta 的能力">
                <TagRow items={skillTags} />
              </Field>

              {(entry.skillsOther || entry.recruitOther) && (
                <Field label="补充说明">
                  <p className="field__text">
                    {[entry.skillsOther, entry.recruitOther].filter(Boolean).join('；')}
                  </p>
                </Field>
              )}

              <Field label="状态与意愿">
                <TagRow
                  items={[
                    toTag(entry.stage, STAGE_TAGS),
                    toTag(entry.teamMode, TEAM_MODE_TAGS),
                    toTag(entry.position, POSITION_TAGS),
                    toTag(entry.motivation, MOTIVATION_TAGS),
                    toTag(entry.matchHelp, MATCH_TAGS),
                  ].filter(Boolean)}
                />
              </Field>

              {entry.extra && (
                <Field label="ta 的留言">
                  <p className="field__text">{entry.extra}</p>
                </Field>
              )}

              {/* 正面被截断的长介绍，在这里给全文 */}
              {isProject && entry.intro.length > 76 && (
                <Field label="项目介绍全文">
                  <p className="field__text">{entry.intro}</p>
                </Field>
              )}
            </div>

            <div className="back__meta">
              <span>{entry.submittedAt ? `${entry.submittedAt.slice(0, 10)} 提交` : ''}</span>
              <span className="back__meta-flip">
                翻回正面 <FlipIcon />
              </span>
            </div>
          </Card>
        </div>
      </div>
    </li>
  );
}
