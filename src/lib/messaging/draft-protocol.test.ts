import { describe, expect, it } from 'vitest';
import {
  isAllowedOriginMatch,
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
