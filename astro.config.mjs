import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  site: 'https://visualwalkthroughs.com',
  experimental: {
    contentLayer: true,
  },
});
