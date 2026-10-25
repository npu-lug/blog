// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// https://astro.build/config
export default defineConfig({
  site: 'https://npulug.org',
  markdown: {
      remarkPlugins: [remarkMath],
      rehypePlugins: [rehypeKatex],
      // 同时输出浅色/深色两套着色，由 global.css 里的 [data-theme] 规则切换
      shikiConfig: {
        themes: {
          light: 'github-light',
          dark: 'github-dark',
        },
      },
  },
  integrations: [mdx(), sitemap()],
});
