/**
 * UUID v4 생성. crypto.randomUUID는 보안 컨텍스트(HTTPS·localhost)에서만 존재하므로
 * HTTP로 열린 온나라 페이지의 콘텐츠 스크립트에서는 undefined다.
 * getRandomValues는 비보안 컨텍스트에서도 쓸 수 있어 이를 대체 경로로 쓴다.
 */
export function randomId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
