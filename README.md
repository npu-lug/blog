# NPULUG Blog

这是西北工业大学 Linux 用户组 (NPULUG) 的技术博客。

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/npu-lug/blog)

<!-- Add other relevant buttons if needed -->

Features:

- ✅ 基于 Astro 构建，性能优异
- ✅ SEO 友好 (Canonical URLs, OpenGraph)
- ✅ Sitemap 和 RSS Feed 支持
- ✅ Markdown & MDX 内容支持
- ✅ 支持文章多作者展示
- ✅ 可选的原文链接/标题
- ✅ 平滑的页面过渡效果 (View Transitions)
- ✅ 深色模式：跟随系统配色偏好自动切换
- ✅ 中文日期格式化

## 🚀 项目结构

```text
├── public/         # 静态资源 (图片, favicons等)
├── src/
│   ├── components/   # Astro / UI 框架组件
│   ├── content/      # 内容集合 (博客文章等)
│   │   └── blog/     # 博客文章 Markdown/MDX 文件
│   ├── layouts/      # 页面布局
│   └── pages/        # 页面路由
├── astro.config.mjs  # Astro 配置文件
├── README.md
├── package.json
└── tsconfig.json
```

博客文章存放在 `src/content/blog/` 目录中。每篇文章的元数据 (frontmatter) 在 `src/content.config.ts` 中定义。

静态资源（如图片）可以放在 `public/` 目录下。

## 发布元数据

生产站点地址在 `astro.config.mjs` 的 `site` 中配置为 `https://npulug.org`。
Canonical、Open Graph、Twitter、Sitemap 和 RSS 均使用此地址，不使用本地预览服务器的地址。
默认分享图片复用 `public/favicon.png`；PNG 图标声明为 `image/png`。
RSS 按 `pubDate` 倒序排列；文章链接与页面路由保持一致，优先使用 frontmatter 的 `slug`，未填写时使用移除扩展名后的内容 ID。
文章使用 `pubDate` 表示发布日期，可选的 `updatedDate` 表示更新日期；两者仅作为 Open Graph 时间元数据输出，不改变页面上的日期展示。
可选的 `heroImage` 用作 Open Graph 和 Twitter 分享图片，未填写时使用默认图片。

## 页面导航

博客列表、文章页和关于页提供“返回顶部”链接，复用返回按钮的圆形样式。
启用 JavaScript 时，向下滚动超过 300px 后显示按钮，点击后平滑回到主内容顶部并转移键盘焦点；系统开启“减少动态效果”时直接回顶。
按钮在桌面端靠近正文右侧，手机端保留边缘留白并使用 85% 不透明度的半透明底色；回到顶部后隐藏。页面切换时自动清理滚动和点击监听器。
未启用 JavaScript 时，保留可见的原生 `#top` 链接作为回顶入口。
博客列表底部保留额外间距，并计入固定页脚和设备安全区域，避免最后一篇文章贴近页面底部。



## 🧞 命令

所有命令都在项目根目录下运行：

| Command         | Action                                   |
| :-------------- | :--------------------------------------- |
| `bun install`   | 安装依赖                                 |
| `bun dev`       | 启动本地开发服务器 (localhost:4321)      |
| `bun build`     | 构建生产版本到 `./dist/`                 |
| `bun preview`   | 本地预览构建后的站点                     |
| `bun astro ...` | 运行 Astro CLI 命令 (例如 `astro check`) |

## 协议

本项目使用 MIT License。
