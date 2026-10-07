import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runBubbleRequest, cancelBubbleRequest, cancelBubbleRequestsForDocument } from './bubble-request';
vi.mock('@/lib/storage/settings', () => ({ loadSettings: async () => ({ endpoint: 'http://localhost:11434', model: 'approved-model', numCtx: 4096 }) }));
vi.mock('@/lib/extract/pdf-offscreen', () => ({ OFFSCREEN_TARGET: 'saide-offscreen', withOffscreen: async (work: () => Promise<unknown>) => work() }));
const sender = { tab: { id: 1 }, frameId: 2, documentId: 'document-a' } as chrome.runtime.MessageSender;
const request = { requestId: 'r1', endpoint: 'https://unapproved.example', body: { model: 'untrusted-model', messages: [{ role: 'user', content: '다듬어 주세요' }] } };
let send: ReturnType<typeof vi.fn>;
beforeEach(() => {
  send = vi.fn(async () => ({ result: '다듬은 내용' }));
  vi.stubGlobal('chrome', { runtime: { sendMessage: send }, storage: { managed: { get: async () => ({}) } } });
});
afterEach(() => vi.unstubAllGlobals());
it('발신자가 전달한 주소·모델 대신 저장된 설정을 사용한다', async () => {
  expect(await runBubbleRequest(request, sender)).toEqual({ result: '다듬은 내용' });
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'http://localhost:11434', body: expect.objectContaining({ model: 'approved-model' }) }));
});
it('다른 프레임의 취소는 무시하고 같은 문서의 취소는 실제 오프스크린 요청까지 전달한다', async () => {
  let complete!: (value: unknown) => void;
  send.mockImplementation(async msg => msg.type === 'TRANSFORM_AI' ? new Promise(resolve => { complete = resolve; }) : { ok: true });
  const settled = vi.fn();
  const work = runBubbleRequest(request, sender);
  void work.then(settled, settled);
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
  cancelBubbleRequest(request, { ...sender, frameId: 3 });
  expect(send.mock.calls.some(([msg]) => msg.type === 'CANCEL_AI')).toBe(false);
  const failed = expect(work).rejects.toMatchObject({ name: 'AbortError' });
  cancelBubbleRequest(request, sender);
  await failed;
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'CANCEL_AI' }));
  complete({ result: '늦은 응답' });
});
it('과대 질문은 오프스크린 추론을 시작하기 전에 거부한다', async () => {
  await expect(runBubbleRequest({ ...request, body: { ...request.body, messages: [{ role: 'user', content: '가'.repeat(10000) }] } }, sender)).rejects.toThrow('입력 예산');
  expect(send).not.toHaveBeenCalled();
});

it('기안 문서를 닫거나 이동하면 해당 문서의 대기 추론을 취소한다', async () => {
  send.mockImplementation(async msg => msg.type === 'TRANSFORM_AI' ? new Promise(() => {}) : { ok: true });
  const work = runBubbleRequest(request, sender);
  await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'TRANSFORM_AI' })));
  const failed = expect(work).rejects.toMatchObject({ name: 'AbortError' });
  cancelBubbleRequestsForDocument(1, 2);
  await failed;
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'CANCEL_AI' }));
});
