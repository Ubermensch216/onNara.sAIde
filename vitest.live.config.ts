import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

// 실서버(Ollama) 대상 통합 점검 전용. 기본 `npm test`에는 포함되지 않는다 —
// Ollama가 꺼져 있으면 실패하므로 CI/평상시 실행과 분리한다.
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'node',
    include: ['src/**/*.itest.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
