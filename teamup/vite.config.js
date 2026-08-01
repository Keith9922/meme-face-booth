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
  // 端口交给 PORT 环境变量决定，避免和仓库里另一个 dev server 撞车。
  // /api 转发到本地后端，这样开发环境和线上（nginx 反代）是同一套同源路径，
  // 前端代码里不需要任何 if (dev) 分支。
  server: {
    port: Number(process.env.PORT) || 5174,
    host: true,
    proxy: {
      '/api': {
        target: process.env.API_ORIGIN || 'http://127.0.0.1:4611',
        changeOrigin: true,
        // SSE 必须关掉缓冲，否则小助手要等整段生成完才一次性蹦出来
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            proxyRes.headers['cache-control'] = 'no-cache, no-transform';
          });
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    // 字体和 svg 全部 inline 不划算（noto-sans-sc 单个 woff2 就好几百 KB），保持独立文件走 CDN 缓存
    assetsInlineLimit: 4096,
  },
});
