import { describe, expect, it } from 'vitest';
import { ALL_ERROR_CODES, presentError } from './describe';
import type { ErrorCode } from '@/lib/messaging/protocol';

/** protocol.ts의 ErrorCode 유니온이 커지면 여기서 잡힌다. */
const DECLARED: ErrorCode[] = [
  'OLLAMA_DOWN',
  'MODEL_MISSING',
  'CORS_BLOCKED',
  'OOM',
  'TIMEOUT',
  'ABORTED',
  'TAB_RESTRICTED',
  'HOST_PERMISSION_REQUIRED',
  'ACTION_DENIED',
  'MEMORY_OFF',
  'MEMORY_QUERY_REQUIRED',
  'SCHEDULE_INPUT_REQUIRED',
  'UNKNOWN',
];

describe('오류 문구 전수 (Phase 7-2)', () => {
  it('선언된 코드와 문구가 있는 코드가 정확히 일치한다', () => {
    expect([...ALL_ERROR_CODES].sort()).toEqual([...DECLARED].sort());
  });

  it('모든 코드에 제목이 있다', () => {
    for (const code of ALL_ERROR_CODES) {
      const p = presentError({ code, message: '원문 메시지' }, 'gemma4:e2b');
      expect(p.title, code).not.toBe('');
    }
  });

  it('조용히 넘기는 코드가 아니면 설명이 있다', () => {
    for (const code of ALL_ERROR_CODES) {
      const p = presentError({ code, message: '원문 메시지' }, 'gemma4:e2b');
      if (p.silent) continue;
      expect(p.body, code).not.toBe('');
    }
  });

  /**
   * "다시 시도하세요"만 적힌 안내는 도움이 아니다.
   * 사용자가 할 수 있는 일이 있는 코드에는 명령이든 버튼이든 있어야 한다.
   */
  it('사용자가 조치할 수 있는 오류에는 명령이나 버튼이 붙어 있다', () => {
    const actionable: ErrorCode[] = [
      'OLLAMA_DOWN',
      'CORS_BLOCKED',
      'MODEL_MISSING',
      'OOM',
      'HOST_PERMISSION_REQUIRED',
    ];
    for (const code of actionable) {
      const p = presentError({ code, message: '' }, 'gemma4:e2b');
      expect(Boolean(p.command || p.action), code).toBe(true);
    }
  });

  it('중단은 오류로 표시하지 않는다', () => {
    const p = presentError({ code: 'ABORTED', message: '생성을 중단했습니다.' });
    expect(p.severity).toBe('info');
    expect(p.silent).toBe(true);
  });

  it('CORS는 실행할 명령을 그대로 준다', () => {
    const p = presentError({ code: 'CORS_BLOCKED', message: '' });
    expect(p.command).toContain('OLLAMA_ORIGINS');
  });

  it('모델 누락은 pull 명령에 실제 모델명을 넣는다', () => {
    const p = presentError({ code: 'MODEL_MISSING', message: '' }, 'llama9:1b');
    expect(p.title).toContain('llama9:1b');
    expect(p.command).toBe('ollama pull llama9:1b');
  });

  it('분류하지 못한 오류는 원문을 감추지 않는다', () => {
    const p = presentError({ code: 'UNKNOWN', message: 'socket hang up', hint: '재시도 필요' });
    expect(p.body).toContain('socket hang up');
    expect(p.body).toContain('재시도 필요');
  });

  it('권한 오류는 허용 버튼으로 이어진다', () => {
    const p = presentError({ code: 'HOST_PERMISSION_REQUIRED', message: '' });
    expect(p.action).toBe('grant-host');
  });
});
