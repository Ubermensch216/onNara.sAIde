// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { assemblePdf, renderTextToPdfBase64 } from './text-pdf';

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 12 })),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/');
});

it('assemblePdf가 올바른 PDF 1.4 시그니처와 카탈로그 및 페이지 구조를 생성한다', () => {
  const dummyJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const pdfBytes = assemblePdf([
    { width: 1240, height: 1754, jpeg: dummyJpeg },
    { width: 1240, height: 1754, jpeg: dummyJpeg },
  ]);

  const text = new TextDecoder().decode(pdfBytes);
  expect(text.startsWith('%PDF-1.4')).toBe(true);
  expect(text).toContain('/Type /Catalog');
  expect(text).toContain('/Type /Pages');
  expect(text).toContain('/Count 2');
  expect(text).toContain('/Subtype /Image');
  expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
});

it('renderTextToPdfBase64가 텍스트 입력을 받아 유효한 Base64 PDF 문자열을 반환한다', async () => {
  const base64 = await renderTextToPdfBase64({
    title: '테스트 공문서 제목',
    text: '이것은 온나라 전자결재 테스트 본문 내용입니다.\n두 번째 단락입니다.',
    reportDate: '2026. 09. 21.',
  });

  expect(typeof base64).toBe('string');
  expect(base64.length).toBeGreaterThan(100);

  // base64 디코딩 시 %PDF-1.4 머리표 확인
  const decoded = atob(base64.slice(0, 50));
  expect(decoded.startsWith('%PDF-1.4')).toBe(true);
});
