// @author: zhjj
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5188 },
  build: { target: 'es2020', chunkSizeWarningLimit: 4096 },
});
