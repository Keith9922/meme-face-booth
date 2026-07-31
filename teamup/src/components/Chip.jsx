import React from 'react';
import { Tag } from 'animal-island-ui';

/**
 * 组件库的 Tag + 一套改过对比度的配色（见 styles/chips.css）。
 * taxonomy 里的 color 用的是组件库那 13 个 CardColor 名字，这里映射到 chip class。
 */
const COLOR_CLASS = {
  'app-yellow': 'chip--yellow',
  'app-blue': 'chip--blue',
  'app-pink': 'chip--pink',
  'app-teal': 'chip--teal',
  'app-green': 'chip--green',
  'app-orange': 'chip--orange',
  'app-red': 'chip--red',
  purple: 'chip--purple',
  brown: 'chip--brown',
  'lime-green': 'chip--lime',
  'yellow-green': 'chip--yellow',
  'warm-peach-pink': 'chip--orange',
  default: 'chip--brown',
};

export default function Chip({ tag, size = 'small', toggle = false, on = false, onClick, title }) {
  if (!tag) return null;
  const cls = ['chip', COLOR_CLASS[tag.color] || COLOR_CLASS.default, toggle && 'chip--toggle']
    .filter(Boolean)
    .join(' ');

  return (
    <Tag
      size={size}
      variant="solid"
      color="default"
      className={cls}
      onClick={onClick}
      style={undefined}
      // 悬停时能看到飞书里那句完整的选项文案
      title={title ?? tag.full}
      {...(toggle ? { 'data-on': String(on), 'aria-pressed': on } : {})}
    >
      {tag.emoji ? `${tag.emoji} ` : ''}
      {tag.label}
    </Tag>
  );
}
