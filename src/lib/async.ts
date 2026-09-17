/** Ends the caller's wait even when the underlying browser API ignores cancellation. */
export function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    // Attach both handlers even for an already-aborted signal: no unhandled rejection.
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

export function deadlineSignal(ms: number, outer?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(outer?.reason);
  if (outer?.aborted) abort();
  else outer?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), ms);
  return {
    signal: controller.signal,
    dispose() { clearTimeout(timer); outer?.removeEventListener('abort', abort); },
  };
}

/** Byte-level inactivity bound; a long but progressing generation may continue. */
export function idleSignal(ms: number, outer?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(outer?.reason);
  let timer: ReturnType<typeof setTimeout>;
  const touch = () => {
    clearTimeout(timer);
    if (!controller.signal.aborted) timer = setTimeout(() => controller.abort(new DOMException('Response timed out', 'TimeoutError')), ms);
  };
  if (outer?.aborted) abort();
  else outer?.addEventListener('abort', abort, { once: true });
  touch();
  return { signal: controller.signal, touch, dispose() { clearTimeout(timer); outer?.removeEventListener('abort', abort); } };
}
