import { validBubbleBody } from '@/lib/messaging/draft-protocol';
import { loadSettings } from '@/lib/storage/settings';
import { assertAiDestination, mayContainSensitiveContent } from './destination';
import { abortable } from '@/lib/async';
import { withOffscreen, OFFSCREEN_TARGET } from '@/lib/extract/pdf-offscreen';
import { assertRequestBudget } from '@/lib/ollama/stream';

const active = new Map<string, AbortController>();
function key(raw: unknown, sender: chrome.runtime.MessageSender): string | null {
  const requestId = (raw as { requestId?: unknown })?.requestId;
  return typeof requestId === 'string' && /^[\w-]{1,100}$/.test(requestId)
    ? [sender.tab?.id, sender.frameId, sender.documentId ?? sender.url, requestId].join(':') : null;
}

export function cancelBubbleRequest(raw: unknown, sender: chrome.runtime.MessageSender): void {
  const id = key(raw, sender);
  if (id) active.get(id)?.abort();
}
export function cancelBubbleRequestsForDocument(tabId: number, frameId?: number): void {
  const prefix = frameId === undefined ? tabId + ':' : tabId + ':' + frameId + ':';
  for (const [id, controller] of active) if (id.startsWith(prefix)) controller.abort();
}
export async function runBubbleRequest(raw: unknown, sender: chrome.runtime.MessageSender): Promise<{ result?: string; error?: string }> {
  const id = key(raw, sender);
  const body = (raw as { body?: unknown })?.body;
  if (!id || !validBubbleBody(body) || active.has(id)) throw new Error('유효하지 않은 AI 변환 요청입니다.');
  const controller = new AbortController();
  active.set(id, controller);
  const cancel = () => { void chrome.runtime.sendMessage({ target: OFFSCREEN_TARGET, type: 'CANCEL_AI', requestId: id }).catch(() => undefined); };
  controller.signal.addEventListener('abort', cancel, { once: true });
  try {
    const settings = await loadSettings();
    const endpoint = await assertAiDestination(settings.endpoint, controller.signal, mayContainSensitiveContent(JSON.stringify(body)));
    const request = { ...body, model: settings.model, options: { ...body.options, num_ctx: settings.numCtx }, stream: false };
    assertRequestBudget({ ...request, stream: true });
    return await withOffscreen(async () => {
      controller.signal.throwIfAborted();
      return await abortable(chrome.runtime.sendMessage({ target: OFFSCREEN_TARGET, type: 'TRANSFORM_AI', requestId: id, endpoint, body: request }), controller.signal);
    });
  } finally {
    controller.signal.removeEventListener('abort', cancel);
    active.delete(id);
  }
}
