import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * animal-island-ui 把 Noto Sans SC 整包塞进了它的 CSS：
 * 400 / 500 / 700 三个字重，每个 1.15MB，全中文页面会把三个都拉下来 —— 3.4MB。
 * 这是一个活动现场用手机打开的页面，付不起这个钱。
 *
 * 去掉中文 @font-face 之后，中文字形回落到系统字体（PingFang SC / 微软雅黑），
 * 拉丁字母和数字仍然走库自带的 Nunito（三个字重加起来才 50KB），
 * 动森那股圆润劲儿本来也来自组件形状而不是这套字体。
 */
function dropCjkWebfonts() {
  return {
    name: 'drop-cjk-webfonts',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('animal-island-ui') || !id.includes('.css')) return null;
      const stripped = code.replace(
        /@font-face\s*\{[^}]*noto-sans-sc-chinese-simplified[^}]*\}/g,
        '',
      );
      return stripped === code ? null : { code: stripped, map: null };
    },
  };
}

export default defineConfig({
  plugins: [dropCjkWebfonts(), react()],
  // 端口交给 PORT 环境变量决定，避免和仓库里另一个 dev server 撞车
  server: { port: Number(process.env.PORT) || 5174, host: true },
  build: {
    outDir: 'dist',
    // 字体和 svg 全部 inline 不划算（noto-sans-sc 单个 woff2 就好几百 KB），保持独立文件走 CDN 缓存
    assetsInlineLimit: 4096,
  },
});
