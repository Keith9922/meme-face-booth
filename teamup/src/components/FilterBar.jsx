import React, { useState } from 'react';
import { Button, Input, Tabs } from 'animal-island-ui';

import Chip from './Chip.jsx';
import { SearchIcon } from './icons.jsx';
import { FILTER_ROLES, STAGE_TAGS } from '../lib/taxonomy.js';

const KINDS = [
  { key: 'all', label: '全部' },
  { key: 'project', label: '🚀 项目招人' },
  { key: 'seeker', label: '🙋 想加入' },
];

/** 「其他」那一排开关，每个都是一个直接落到字段上的判断 */
export const FLAGS = [
  { key: 'lead', emoji: '🌟', label: '想主导', color: 'app-orange', test: (e) => e.position.includes('主导') },
  { key: 'learn', emoji: '📚', label: '学习跟随', color: 'app-blue', test: (e) => e.position.includes('学习') },
  {
    key: 'rec',
    emoji: '✅',
    label: '求组委会推荐',
    color: 'app-green',
    test: (e) => e.matchHelp.includes('可以，希望推荐'),
  },
  { key: 'solo', emoji: '🚶', label: 'Solo', color: 'brown', test: (e) => e.teamMode.includes('Solo') },
];

function ChipRow({ label, options, value, onToggle, counts }) {
  return (
    <div className="toolbar__row">
      <span className="toolbar__label">{label}</span>
      <div className="toolbar__tags">
        {options.map((o) => {
          const on = value.includes(o.key);
          return (
            <Chip
              key={o.key}
              tag={{ key: o.key, emoji: o.emoji, label: counts ? `${o.label} ${counts[o.key] ?? 0}` : o.label, color: o.color }}
              size="medium"
              toggle
              on={on}
              onClick={() => onToggle(o.key)}
              title={on ? `取消：${o.label}` : `只看：${o.label}`}
            />
          );
        })}
      </div>
    </div>
  );
}

export default function FilterBar({
  kind,
  setKind,
  query,
  setQuery,
  needRoles,
  toggleNeed,
  haveRoles,
  toggleHave,
  stages,
  toggleStage,
  flags,
  toggleFlag,
  sortByMatch,
  setSortByMatch,
  canSortByMatch,
  demandCounts,
  supplyCounts,
  count,
  dirty,
  onReset,
}) {
  const roleOpts = FILTER_ROLES.map((r) => ({ key: r.key, emoji: r.emoji, label: r.short, color: r.color }));
  const stageOpts = STAGE_TAGS.map((s) => ({ key: s.match, emoji: s.emoji, label: s.short, color: s.color }));

  const detailCount = needRoles.length + haveRoles.length + stages.length + flags.length;
  // 展开着的详细筛选有 400px 高，默认收起来，第一屏才看得见卡片。
  // 一旦有条件生效就自动展开，否则用户会看不到自己筛了什么。
  const [open, setOpen] = useState(false);
  const expanded = open || detailCount > 0;

  return (
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

        <button
          type="button"
          className="toolbar__more"
          aria-expanded={expanded}
          onClick={() => setOpen((v) => !v)}
        >
          {expanded ? '收起筛选' : '更多筛选'}
          {detailCount > 0 && <b>{detailCount}</b>}
          <span className="toolbar__caret" data-open={String(expanded)} aria-hidden="true" />
        </button>

        {canSortByMatch && (
          <Chip
            tag={{ key: 'sort', emoji: '✨', label: '按匹配度排', color: 'purple' }}
            size="medium"
            toggle
            on={sortByMatch}
            onClick={() => setSortByMatch(!sortByMatch)}
            title="用你刚才在撮合里填的画像给整面墙排序"
          />
        )}

        <span className="toolbar__count">
          共 <b>{count}</b> 张
        </span>

        {dirty && (
          <Button size="small" onClick={onReset}>
            重置
          </Button>
        )}
      </div>

      {/* 四组筛选在宽屏铺成多列，不然光筛选栏就把卡片推到首屏外面 */}
      {expanded && (
        <div className="toolbar__grid">
          <ChipRow label="ta 在招" options={roleOpts} value={needRoles} onToggle={toggleNeed} counts={demandCounts} />
          <ChipRow label="ta 会做" options={roleOpts} value={haveRoles} onToggle={toggleHave} counts={supplyCounts} />
          <ChipRow label="项目进度" options={stageOpts} value={stages} onToggle={toggleStage} />
          <ChipRow label="其他" options={FLAGS} value={flags} onToggle={toggleFlag} />
        </div>
      )}
    </section>
  );
}
