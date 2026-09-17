/** Actual application components, isolated browser API fixtures and sample data.
 * This is a UI capture harness, not an extension or Ollama integration test.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_SETTINGS } from '@/lib/storage/settings';

const mode = new URLSearchParams(location.search).get('view') || 'panel';
window.addEventListener('unhandledrejection', event => {
  document.getElementById('root')!.textContent = String(event.reason?.stack || event.reason);
});
window.addEventListener('error', event => {
  document.getElementById('root')!.textContent = event.message;
});
const sampleTab = { tabId: 1, url: 'https://example.com/guide', title: '로컬 AI 활용 가이드', active: true };
const listeners = new Set<Function>();
const data: Record<string, unknown> = {
  'saide.settings': { ...DEFAULT_SETTINGS, theme: 'light', warmupOnOpen: false },
};
const event = { addListener() {}, removeListener() {} };
Object.assign(window, { chrome: {
  storage: {
    local: {
      async get(key: string) { return { [key]: data[key] }; },
      async set(patch: Record<string, unknown>) {
        const changes = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, { newValue: value }]));
        Object.assign(data, patch);
        listeners.forEach(fn => fn(changes, 'local'));
      },
    },
    onChanged: { addListener(fn: Function) { listeners.add(fn); }, removeListener(fn: Function) { listeners.delete(fn); } },
  },
  runtime: { onMessage: event, async sendMessage() { return { type: 'ACTIVE_TAB', tab: sampleTab }; }, openOptionsPage() { location.href = '/?view=options'; } },
  permissions: { async getAll() { return { origins: ['http://localhost:11434/*'] }; }, async contains() { return false; }, async request() { return false; }, async remove() { return false; } },
} });

// Explicitly simulated health. No requests leave the documentation preview.
window.fetch = async (input) => {
  const url = String(input);
  const models = [
    { name: 'gemma4:e2b', model: 'gemma4:e2b', capabilities: ['completion', 'tools', 'thinking'] },
    { name: 'bge-m3:latest', model: 'bge-m3:latest', capabilities: ['embedding'] },
  ];
  if (url.endsWith('/api/version')) return Response.json({ version: '0.32.5' });
  if (url.endsWith('/api/tags')) return Response.json({ models });
  if (url.endsWith('/api/ps')) return Response.json({ models: [{ name: 'gemma4:e2b', size_vram: 0 }] });
  throw new Error('문서 미리보기에서는 모델 호출과 외부 요청을 지원하지 않습니다.');
};

const badge = document.createElement('div');
badge.textContent = '사용 설명용 예시 · 실제 UI / 샘플 데이터';
badge.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#14121c;color:#fff;text-align:center;font:12px sans-serif;padding:7px;z-index:9999';
document.body.append(badge);
if (!mode.startsWith('options') && mode !== 'memory' && mode !== 'presets') {
  document.getElementById('root')!.style.height = 'calc(100% - 30px)';
}

if (mode.startsWith('options') || mode === 'memory' || mode === 'presets') {
  await import('@/entrypoints/options/style.css');
  if (mode === 'memory') {
    const { db } = await import('@/lib/storage/db');
    // Empty memory fixture keeps the capture independent of IndexedDB timing.
    Object.defineProperty(db.table('pageVectors'), 'toArray', { value: async () => [] });
    const { MemoryPanel } = await import('@/entrypoints/options/MemoryPanel');
    createRoot(document.getElementById('root')!).render(<div className="wrap"><MemoryPanel /></div>);
  } else if (mode === 'presets') {
    const { PresetEditor } = await import('@/entrypoints/options/PresetEditor');
    createRoot(document.getElementById('root')!).render(<div className="wrap"><PresetEditor /></div>);
  } else {
    const { default: OptionsApp } = await import('@/entrypoints/options/OptionsApp');
    createRoot(document.getElementById('root')!).render(<OptionsApp />);
  }

} else {
  await import('@/entrypoints/sidepanel/style.css');
  const { useChat } = await import('@/lib/chat/store');
  const now = Date.now();
  const messages = [
    { id: 1, conversationId: 1, role: 'user' as const, content: '로컬 AI를 처음 사용하는 사람이 알아야 할 내용을 3줄로 정리해줘.', createdAt: now },
    { id: 2, conversationId: 1, role: 'assistant' as const, content: '1. **Ollama와 대화 모델을 설치**하고 연결 상태를 확인합니다.\n2. 읽고 있는 페이지를 첨부하면 **요약·번역·질문**을 이어갈 수 있습니다.\n3. 에이전트가 클릭·입력·이동을 제안하면 **대상과 내용을 확인한 뒤 승인**합니다.', createdAt: now + 1 },
  ];
  useChat.setState({ openForTab: async () => { useChat.setState({ messages }); } });
  const { default: App } = await import('@/entrypoints/sidepanel/App');
  createRoot(document.getElementById('root')!).render(<App />);
  setTimeout(() => {
    useChat.setState({ page: { ...sampleTab, text: '사용 설명용 예시 본문입니다.', charCount: 1200, truncated: false, keptRatio: 1, estimatedTokens: 600, method: 'readability', extractedAt: now } });
    if (mode === 'approval') useChat.setState({ pendingApproval: {
      request: { action: { kind: 'click', selector: '사용 가이드' }, humanDescription: '“사용 가이드” 링크를 클릭합니다.', targetLabel: '<a> "사용 가이드"', pageUrl: sampleTab.url, pageTitle: sampleTab.title },
      resolve() {},
    } });
  }, 1600);
}
