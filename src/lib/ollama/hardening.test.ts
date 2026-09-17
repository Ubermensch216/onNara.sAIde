import { afterEach, expect, it, vi } from 'vitest';
import { requestJson, requireCapabilities } from './client';
import { streamChat } from './stream';
const endpoint = 'http://localhost:11434';
const req = { model: 'test', messages: [], stream: true as const };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each([403, 404, 500])('JSON API의 HTTP %i를 공통 오류로 분류한다', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('failure', { status })));
  await expect(requestJson(endpoint, '/api/show')).rejects.toMatchObject({ code: status === 403 ? 'CORS_BLOCKED' : status === 404 ? 'MODEL_MISSING' : 'UNKNOWN' });
});
it('AbortSignal을 무시하는 JSON 요청도 deadline에 종료한다', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', () => new Promise(() => {}));
  const result = expect(requestJson(endpoint, '/api/show', {}, 100)).rejects.toMatchObject({ code: 'TIMEOUT' });
  await vi.advanceTimersByTimeAsync(101); await result;
});
it.each(['{"error":"inference failed"}\n', '{"message":{"content":"partial"}}\n', 'null\n', 'broken\n'])('불완전·오류 스트림을 성공으로 처리하지 않는다: %s', async body => {
  vi.stubGlobal('fetch', async () => new Response(body));
  await expect(streamChat(endpoint, req, {})).rejects.toMatchObject({ code: 'UNKNOWN' });
});
it('done 뒤 연결이 열려 있어도 완료하고 reader를 취소한다', async () => {
  const cancel = vi.fn();
  vi.stubGlobal('fetch', async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"done":true}\n')); }, cancel })));
  expect(await streamChat(endpoint, req, {})).toMatchObject({ totalMs: 0 });
  expect(cancel).toHaveBeenCalledOnce();
});
it('응답 헤더·첫 토큰·후속 토큰을 각각 하루 기다려도 최종 답변을 전달한다', async () => {
  vi.useFakeTimers();
  let respond!: (response: Response) => void;
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  vi.stubGlobal('fetch', () => new Promise<Response>(resolve => { respond = resolve; }));
  const onToken = vi.fn();
  const onDone = vi.fn();
  const settled = vi.fn();
  const result = streamChat(endpoint, req, { onToken, onDone });
  void result.then(settled, settled);
  await vi.advanceTimersByTimeAsync(86_400_000);
  expect(settled).not.toHaveBeenCalled();
  respond(new Response(new ReadableStream({ start(controller) { stream = controller; } })));
  await vi.advanceTimersByTimeAsync(86_400_000);
  expect(settled).not.toHaveBeenCalled();
  stream.enqueue(new TextEncoder().encode('{"message":{"content":"오래 기다린 "}}\n'));
  await vi.advanceTimersByTimeAsync(86_400_000);
  expect(settled).not.toHaveBeenCalled();
  expect(onToken).toHaveBeenCalledWith('오래 기다린 ');
  stream.enqueue(new TextEncoder().encode('{"message":{"content":"답변"},"done":true}\n'));
  await expect(result).resolves.toMatchObject({ totalMs: 0 });
  expect(onToken.mock.calls.map(([text]) => text).join('')).toBe('오래 기다린 답변');
  expect(onDone).toHaveBeenCalledOnce();
});
it.each(['headers', 'body'])('무기한 %s 대기도 사용자가 중단하면 즉시 종료한다', async phase => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  vi.stubGlobal('fetch', () => phase === 'headers' ? new Promise(() => {}) : Promise.resolve(new Response(new ReadableStream({ cancel }))));
  const controller = new AbortController();
  const result = expect(streamChat(endpoint, req, {}, controller.signal)).rejects.toMatchObject({ code: 'ABORTED' });
  await vi.advanceTimersByTimeAsync(86_400_000);
  controller.abort();
  await result;
  if (phase === 'body') expect(cancel).toHaveBeenCalledOnce();
});
it('초과한 컨텍스트는 HTTP 요청 전에 거부한다', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(streamChat(endpoint, { ...req, messages: [{ role: 'user', content: '가'.repeat(10000) }], options: { num_ctx: 2048 } }, {})).rejects.toThrow('입력 예산');
  expect(fetch).not.toHaveBeenCalled();
});
it('기능이 없거나 확인되지 않은 모델의 도구 사용을 차단한다', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ capabilities: ['completion'] }));
  await expect(requireCapabilities(endpoint, 'test', ['tools'])).rejects.toThrow('tools');
});
