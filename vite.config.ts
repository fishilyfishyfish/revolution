import { defineConfig } from 'vite';

// GitHub Pages 하위 경로에서도 동작하도록 상대 경로 사용.
// 워커는 IIFE(클래식 워커)로 묶고 문법 수준을 낮춰 오래된 브라우저에서도 시작되게 한다.
export default defineConfig({
  base: './',
  worker: { format: 'iife' },
  build: { target: 'es2019', outDir: 'dist' },
});
