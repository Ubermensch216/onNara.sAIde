import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { aiFetch, assertAiDestination, approveAiDestination, isLoopbackEndpoint, processingLabel, AI_DESTINATION_APPROVAL_KEY } from './destination';
import { AI_POLICY_KEY } from './config';
let local: Record<string, any>;
let policy: Record<string, any>;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  local = {}; policy = {};
  fetchMock = vi.fn(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('chrome', { storage: {
    managed: { get: vi.fn(async () => ({ [AI_POLICY_KEY]: policy })) },
    local: { get: vi.fn(async () => local), set: vi.fn(async patch => { Object.assign(local, patch); }) },
  } });
});
afterEach(() => vi.unstubAllGlobals());
it('로컬 주소와 원격 서버를 구분하며 로컬처럼 보이는 DNS 이름은 거부한다', () => {
  for (const endpoint of ['http://localhost:11434','http://127.0.0.1:11434','http://127.1:11434','http://[::1]:11434']) expect(isLoopbackEndpoint(endpoint)).toBe(true);
  for (const endpoint of ['https://127.evil.example','https://localhost.evil.example','http://10.1.2.3:11434']) expect(isLoopbackEndpoint(endpoint)).toBe(false);
  expect(processingLabel('https://ai.example')).toBe('원격 서버 · ai.example');
});
it('원격 주소는 해당 주소의 승인이 있어야 전송한다', async () => {
  await expect(aiFetch('https://ai.example', '/api/chat')).rejects.toThrow('승인');
  expect(fetchMock).not.toHaveBeenCalled();
  await approveAiDestination('https://ai.example/');
  await aiFetch('https://ai.example', '/api/chat', { method: 'POST' });
  expect(fetchMock).toHaveBeenCalledWith('https://ai.example/api/chat', expect.objectContaining({ redirect: 'error', credentials: 'omit' }));
  await expect(assertAiDestination('https://other.example')).rejects.toThrow('승인');
  expect(local[AI_DESTINATION_APPROVAL_KEY].endpoint).toBe('https://ai.example');
});
it('기관 차단이 사용자 승인보다 우선한다', async () => {
  await approveAiDestination('https://ai.example'); policy = { externalEgressPolicy: 'block' };
  await expect(aiFetch('https://ai.example', '/api/chat')).rejects.toThrow('차단');
  expect(fetchMock).not.toHaveBeenCalled();
});
it('기관이 고정한 주소를 우회하거나 읽기 실패 시 전송하지 않는다', async () => {
  policy = { providers: { ollama: { endpoint: 'http://127.0.0.1:11434' } } };
  await expect(aiFetch('http://localhost:11434', '/api/chat')).rejects.toThrow('기관 정책');
  chrome.storage.managed.get = vi.fn(async () => { throw new Error('policy unavailable'); }) as any;
  await expect(aiFetch('http://127.0.0.1:11434', '/api/chat')).rejects.toThrow('policy unavailable');
  expect(fetchMock).not.toHaveBeenCalled();
});
it('취소된 요청과 API 경로 탈출을 네트워크 전에 차단한다', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(aiFetch('http://localhost:11434', '/api/chat', { signal: controller.signal })).rejects.toThrow();
  await expect(aiFetch('http://localhost:11434', '/../external')).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('기관이 원격 처리를 허용해도 개인정보 가능성이 있는 입력은 사용자 주소 승인이 필요하다', async () => {
  policy = { externalEgressPolicy: 'allow' };
  await expect(aiFetch('https://ai.example', '/api/chat', { body: JSON.stringify({ messages: [{ content: '담당자 010-1234-5678' }] }) })).rejects.toThrow('승인');
  expect(fetchMock).not.toHaveBeenCalled();
  await approveAiDestination('https://ai.example');
  await aiFetch('https://ai.example', '/api/chat', { body: JSON.stringify({ messages: [{ content: '담당자 010-1234-5678' }] }) });
  expect(fetchMock).toHaveBeenCalledOnce();
});

it('참고문서 분석의 주입된 전송 함수도 원격 차단 정책을 우회하지 못한다', async () => {
  const { analyzeChunk } = await import('@/lib/onnara/reference-analysis');
  const { analyzeReferenceForDraft } = await import('@/lib/onnara/related-info');
  policy = { externalEgressPolicy: 'block' };
  const target = { endpoint: 'https://ai.example', model: 'test' };
  await expect(analyzeChunk('원문', 'fact', '제목', 1, 1, target, fetchMock as unknown as typeof fetch)).rejects.toThrow('차단');
  await expect(analyzeReferenceForDraft('가'.repeat(12001), '제목', target, fetchMock as unknown as typeof fetch)).rejects.toThrow('차단');
  expect(fetchMock).not.toHaveBeenCalled();
});
