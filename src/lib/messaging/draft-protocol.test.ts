import { describe, expect, it, vi } from 'vitest';
import {
  isAllowedOriginMatch,
  validDraftHostRequest,
  trustedDraftContent,
  validBubbleBody,
  isValidTargetRef,
  validatePostMessageEvent,
} from './draft-protocol';

describe('draft-protocol', () => {
  describe('isValidTargetRef', () => {
    it('올바른 TargetRef 객체를 통과시킨다', () => {
      expect(
        isValidTargetRef({
          tabId: 101,
          frameId: 0,
          origin: 'http://99.1.2.134',
          documentKey: 'DOC-12345',
          sessionEpoch: Date.now(),
        })
      ).toBe(true);
    });

    it('필수 필드가 누락된 객체는 거부한다', () => {
      expect(isValidTargetRef({ tabId: 101 })).toBe(false);
      expect(isValidTargetRef(null)).toBe(false);
      expect(isValidTargetRef('string')).toBe(false);
    });
  });

  describe('isAllowedOriginMatch', () => {
    it('포트와 프로토콜이 일치하는 origin을 통과시킨다', () => {
      expect(isAllowedOriginMatch('http://99.1.2.134', 'http://99.1.2.134/some/path')).toBe(true);
      expect(isAllowedOriginMatch('https://onnara.go.kr', 'https://onnara.go.kr')).toBe(true);
    });

    it('프로토콜이나 호스트가 다르면 거부한다', () => {
      expect(isAllowedOriginMatch('http://99.1.2.134', 'https://99.1.2.134')).toBe(false);
      expect(isAllowedOriginMatch('http://99.1.2.134', 'http://attacker.com')).toBe(false);
    });
  });

  describe('validatePostMessageEvent', () => {
    it('origin과 source가 일치할 때 통과시킨다', () => {
      const mockWindow = {} as Window;
      const event = {
        origin: 'http://99.1.2.134',
        source: mockWindow,
        data: { type: 'TEST' },
      } as unknown as MessageEvent;

      expect(validatePostMessageEvent(event, 'http://99.1.2.134', mockWindow)).toBe(true);
    });

    it('origin이 다르면 거부한다', () => {
      const mockWindow = {} as Window;
      const event = {
        origin: 'http://evil.com',
        source: mockWindow,
        data: { type: 'TEST' },
      } as unknown as MessageEvent;

      expect(validatePostMessageEvent(event, 'http://99.1.2.134', mockWindow)).toBe(false);
    });

    it('source 윈도우가 다르면 거부한다', () => {
      const mockWindow1 = {} as Window;
      const mockWindow2 = {} as Window;
      const event = {
        origin: 'http://99.1.2.134',
        source: mockWindow1,
        data: { type: 'TEST' },
      } as unknown as MessageEvent;

      expect(validatePostMessageEvent(event, 'http://99.1.2.134', mockWindow2)).toBe(false);
    });
  });
});

it('확장 ID가 다르거나 불투명한 출처이면 같은 origin으로 인정하지 않는다', () => {
  expect(isAllowedOriginMatch('chrome-extension://saide/drawer-page.html', 'chrome-extension://other')).toBe(false);
  expect(isAllowedOriginMatch('chrome-extension://saide/drawer-page.html', 'chrome-extension://saide')).toBe(true);
  expect(isAllowedOriginMatch('data:text/html,one', 'data:text/html,two')).toBe(false);
  expect(isAllowedOriginMatch('null', 'null')).toBe(false);
});
it('기안기 요청의 제목·본문 상한과 삽입 모드를 검증한다', () => {
  expect(validDraftHostRequest({ type: 'DRAFT_APPLY_TITLE', title: '정상 제목' })).toBe(true);
  expect(validDraftHostRequest({ type: 'DRAFT_APPLY_TITLE', title: 'x'.repeat(501) })).toBe(false);
  expect(validDraftHostRequest({ type: 'DRAFT_PREPARE_INSERT', payload: { text: '본문', mode: 'overwrite' } })).toBe(false);
  expect(validDraftHostRequest({ type: 'UNKNOWN' })).toBe(false);
});
it('버블 AI가 도구 호출·이미지·과대 입력을 전달하지 못하게 한다', () => {
  const body = { model: 'gemma4:e2b', messages: [{ role: 'user', content: '다듬기' }] };
  expect(validBubbleBody(body)).toBe(true);
  expect(validBubbleBody({ ...body, tools: [] })).toBe(false);
  expect(validBubbleBody({ ...body, messages: [{ role: 'user', content: 'x', images: ['base64'] }] })).toBe(false);
});

it('특권 기안 요청은 실제 기안 탭의 콘텐츠 스크립트 송신자만 통과한다', () => {
  vi.stubGlobal('chrome', { runtime: { id: 'saide' } });
  try {
    const sender = { id: 'saide', url: 'https://onnara.test/editor-frame', tab: { id: 1, url: 'https://onnara.test/bms/dct/addhwpbody.do' } } as chrome.runtime.MessageSender;
    const draftPath = (url: string) => url.endsWith('/bms/dct/addhwpbody.do');
    expect(trustedDraftContent(sender, draftPath)).toBe(true);
    expect(trustedDraftContent({ ...sender, id: 'other' }, draftPath)).toBe(false);
    expect(trustedDraftContent({ ...sender, url: 'chrome-extension://saide/drawer-page.html' }, draftPath)).toBe(false);
    expect(trustedDraftContent({ ...sender, tab: { ...sender.tab, url: 'https://unrelated.test' } as chrome.tabs.Tab }, draftPath)).toBe(false);
  } finally { vi.unstubAllGlobals(); }
});
