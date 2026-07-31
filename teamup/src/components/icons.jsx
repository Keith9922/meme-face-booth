/**
 * 页面自带的几个 SVG 图标。
 * 组件库的 Icon 只有 10 个 NookPhone 图标，这里补的是它没有的：叶子、翻面箭头、云。
 * 一律用真 SVG，不用生僻 Unicode 字符（缺字形的设备上会变成豆腐块）。
 */

/** 别住纸条的叶子 —— 动森的招牌形状 */
export function Leaf({ tone = '#7cc45c', className, style }) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M20 2c9 3.4 14.5 10.6 14.5 19.2C34.5 30.2 28 37 20 37S5.5 30.2 5.5 21.2C5.5 12.6 11 5.4 20 2Z"
        fill={tone}
        stroke="rgba(45,80,35,.55)"
        strokeWidth="2.2"
      />
      <path
        d="M20 6.5v27"
        stroke="rgba(45,80,35,.5)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M20 14.5 13 11M20 14.5l7-3.5M20 22l-7.5-3.6M20 22l7.5-3.6M20 29.5 14 26.5M20 29.5l6-3"
        stroke="rgba(45,80,35,.34)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <ellipse cx="15" cy="12.5" rx="2.6" ry="3.6" fill="rgba(255,255,255,.34)" transform="rotate(-24 15 12.5)" />
    </svg>
  );
}

/** 翻面 */
export function FlipIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path
        d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M20.6 3.4v4.4h-4.4"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 头顶飘的云 */
export function Cloud({ className }) {
  return (
    <svg className={className} viewBox="0 0 160 66" aria-hidden="true" focusable="false">
      <path d="M36 66c-14 0-25-9.6-25-21.4C11 33.6 20 24.6 32 23.3 36.7 12.6 48 5 61.4 5c15 0 27.6 9.5 30.8 22.3 2.9-1.5 6.2-2.3 9.7-2.3 12.5 0 22.6 9.2 22.6 20.5S114.4 66 101.9 66H36Z" />
    </svg>
  );
}

/** 放大镜（搜索框前缀） */
export function SearchIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="17" height="17" aria-hidden="true" focusable="false" {...props}>
      <circle cx="10.5" cy="10.5" r="6.8" stroke="currentColor" strokeWidth="2.4" />
      <path d="m15.6 15.6 4.4 4.4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
