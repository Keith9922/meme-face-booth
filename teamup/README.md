# 队友招募墙 · Team-up Wall

创作者黑客松的组队集市。**一面草地，98 张纸条，正面写着「在做什么」，翻过来是「谁在做、怎么找到 ta」。**

数据来自飞书多维表格，构建时打包进 bundle —— 页面运行时不碰飞书，断网/接口抖动都不会白屏。

- 组件库：[animal-island-ui](https://github.com/guokaigdg/animal-island-ui)（动物森友会风格的 React 组件库）
- 数据源：飞书知识库文档 [创作者黑客松：队友招募墙](https://my.feishu.cn/wiki/QoTUwRqaCiSqqHk4CL4cz9W0nhe) 里内嵌的多维表格

---

## 本地跑

```bash
npm install
npm run dev
```

打开 <http://localhost:5174>。

---

## 更新数据

数据不是实时拉的，是**手动同步 + 重新部署**。两条通道产出同一份 `src/data/wall.json`：

### 本机同步（当下就能用）

走已经登录过的 `lark-cli`，不需要任何密钥：

```bash
npm run sync
```

然后 `git commit` + `push`，Vercel 自动重新部署。

### CI 同步（给非本机的人用）

workflow 文件放在 `teamup/ci/teamup-sync.yml`，**需要先挪到 `.github/workflows/` 才会生效**：

```bash
mkdir -p .github/workflows
cp teamup/ci/teamup-sync.yml .github/workflows/
git add .github/workflows/teamup-sync.yml && git commit -m "ci: 启用队友招募墙同步 workflow" && git push
```

> 之所以没直接放好：推送含 `.github/workflows/` 的改动需要 GitHub token 带 `workflow` scope，
> 当前这台机器上的 token 没有。补一下 scope 就能自己推了：`gh auth refresh -s workflow`。

装好之后：GitHub Actions → **「队友招募墙 · 同步飞书数据」** → Run workflow。
它会拉数据、构建验证、提交，Vercel 随之重新部署。

跑之前需要在仓库 Secrets 里配好：

| Secret | 说明 |
|---|---|
| `FEISHU_APP_ID` | 飞书自建应用的 App ID |
| `FEISHU_APP_SECRET` | 对应的 App Secret |

并且这个应用要满足两个条件，缺一个都会 403：

1. 开通 `bitable:app:readonly`（或 `bitable:app`）权限；
2. 在这张多维表格里**把该应用加为协作者**（表格右上角「⋯ → 更多 → 添加文档应用」）。

> 只想看看会拉到什么、先不提交：勾上 workflow 的 `dry_run`。

### 表格换了怎么办

`scripts/feishu-source.mjs` 顶部的 `BASE_TOKEN` / `TABLE_ID` 可以用环境变量覆盖：

```bash
FEISHU_BASE_TOKEN=xxx FEISHU_TABLE_ID=tblxxx npm run sync
```

字段名映射在 `scripts/sync-feishu.mjs` 的 `F` 常量里，飞书那边改了列名就改这里。

---

## 部署到 Vercel

这个目录是仓库里的**第二个** Vercel 项目（根目录那个是「表情复刻机」），所以要单独建一个 project：

1. Vercel → Add New Project → 选这个仓库
2. **Root Directory 填 `teamup`**（关键，不填会去构建根目录那个项目）
3. Framework 会自动识别成 Vite，构建命令 `npm run build`，输出 `dist`
4. Deploy

绑定域名：

```bash
vercel domains add <your-domain> --scope <team>
```

或者在 Vercel 项目的 Settings → Domains 里添加，然后按它给的记录去域名商那边配 DNS
（子域名配 CNAME 到 `cname.vercel-dns.com`，根域名配 A 记录到 `76.76.21.21`）。

---

## 一点设计上的取舍

**为什么标签自己配了色。** 组件库的 `Tag` 是「饱和底 + 白字」，`app-yellow` 白字只有 1.75:1，
一整面墙都是标签的时候会直接读成「样式坏了」。所以保留了 `Tag` 组件（胶囊形状、尺寸、键盘可达性都还在用），
只把配色换成同色相的「淡底 + 深字」，每一对都过了 WCAG AA。见 `src/styles/chips.css`。

**为什么砍掉了组件库自带的中文字体。** `animal-island-ui` 把 Noto Sans SC 三个字重整包打了进去，
每个 1.15MB，全中文页面会把三个都拉下来 —— 3.4MB。这是个现场用手机开的页面，
所以在 `vite.config.js` 里加了个插件把中文 `@font-face` 删掉，中文回落到系统字体，
拉丁字母和数字仍然走 Nunito。产物从 3.4MB 降到 684KB，圆润的观感本来也来自组件形状而不是字体。

**为什么卡片要 `content-visibility: auto`。** 98 张卡 × 正反两面 ≈ 7000 个 DOM 节点。
不做视口裁剪的话滚动会卡；每张卡高度固定，所以 `contain-intrinsic-size` 给得准，滚动条不会跳。
同理，叶子的摇摆只在 hover 时跑 —— 98 片叶子一起无限循环会让合成器一直满载。

**关于隐私。** 卡片背面是选手自己填的微信号/手机号。页面加了 `noindex` 元标签和
`X-Robots-Tag` 响应头，联系方式也只在翻面后才出现。如果活动结束后要下线，直接把 Vercel 项目暂停即可。

---

## 目录

```
teamup/
├── index.html
├── vite.config.js          # 含「删掉中文 webfont」的插件
├── vercel.json             # noindex + 缓存头
├── scripts/
│   ├── feishu-source.mjs   # 两条取数通道：lark-cli / 开放平台 API
│   └── sync-feishu.mjs     # 归一化 → src/data/wall.json
└── src/
    ├── App.jsx             # 页面骨架 + 筛选
    ├── components/
    │   ├── WallCard.jsx    # 一张可翻面的纸条
    │   ├── Chip.jsx        # 改过对比度的 Tag
    │   └── icons.jsx       # 叶子 / 翻面 / 云 / 放大镜
    ├── lib/taxonomy.js     # 表单选项 → 短标签 + 配色
    ├── styles/
    │   ├── global.css      # 岛的底色、头部、筛选栏、页脚
    │   ├── card.css        # 纸条的歪斜、翻面、正反面排版
    │   └── chips.css       # 标签配色
    └── data/wall.json      # 同步产物（提交进仓库）
```
