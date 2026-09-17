// 임시 통합 점검 — 실제 Ollama 서버 대상. 확인 후 삭제한다.
import { describe, expect, it } from 'vitest';
import { checkHealth, showModel } from './client';
import { streamChat } from './stream';

const EP = 'http://localhost:11434';

describe('live Ollama', () => {
  it('checkHealth가 실제 서버를 읽는다', async () => {
    const h = await checkHealth(EP, 'gemma4:e2b');
    console.log('  state:', h.state, '| version:', h.version,
                '| models:', h.models.length, '| resident:', h.resident, '| onGpu:', h.onGpu);
    expect(['ok', 'cold']).toContain(h.state);
    expect(h.models.length).toBeGreaterThan(0);
  }, 60_000);

  it('없는 모델을 model-missing으로 분류한다', async () => {
    const h = await checkHealth(EP, 'nonexistent-model:xyz');
    expect(h.state).toBe('model-missing');
    expect(h.error?.hint).toContain('ollama pull');
  }, 30_000);

  it('showModel이 capabilities를 돌려준다', async () => {
    const m = await showModel(EP, 'gemma4:e2b');
    console.log('  capabilities:', m.capabilities?.join(', '));
    expect(m.capabilities).toContain('tools');
    expect(m.capabilities).toContain('thinking');
  }, 30_000);

  it('streamChat이 토큰과 성능 지표를 돌려준다 (think:false)', async () => {
    let out = '';
    let thinkLen = 0;
    const perf = await streamChat(EP, {
      model: 'gemma4:e2b',
      messages: [{ role: 'user', content: '한 문장으로: 물의 화학식은?' }],
      stream: true,
      options: { num_ctx: 4096, temperature: 0 },
    }, {
      onToken: (t) => { out += t; },
      onThinking: (t) => { thinkLen += t.length; },
    });
    console.log('  답변:', out.trim().slice(0, 60));
    console.log('  perf:', JSON.stringify(perf));
    expect(out.length).toBeGreaterThan(0);
    expect(thinkLen).toBe(0);           // think:false 기본값이 실제로 먹는지
    expect(perf!.decodeTokPerSec).toBeGreaterThan(5);
  }, 180_000);
});
