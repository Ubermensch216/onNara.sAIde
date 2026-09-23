import { describe, it, expect } from 'vitest';
import { cleanAdminDraft } from './draft-cleaner';

describe('cleanAdminDraft', () => {
  it('마크다운 헤더 기호(##, ###)를 깔끔하게 제거한다', () => {
    const raw = `## 1. 추진 배경\n내용입니다.\n### 가. 세부 계획\n세부내용`;
    const cleaned = cleanAdminDraft(raw);
    expect(cleaned).toContain('1. 추진 배경');
    expect(cleaned).toContain('가. 세부 계획');
    expect(cleaned).not.toContain('##');
    expect(cleaned).not.toContain('###');
  });

  it('마크다운 볼드(**, __) 및 이탤릭(*, _) 기호를 제거한다', () => {
    const raw = `**중요 사항**: 해당 건은 **반드시** 이행 바람.`;
    const cleaned = cleanAdminDraft(raw);
    expect(cleaned).toBe('중요 사항: 해당 건은 반드시 이행 바람.');
  });

  it('마크다운 불릿(*)을 행정 개조식 기호(·)로 변환한다', () => {
    const raw = `* 추진 기간: 2026. 10. 1. ~ 12. 31.\n* 대상 기관: 전 부처`;
    const cleaned = cleanAdminDraft(raw);
    expect(cleaned).toContain('· 추진 기간: 2026. 10. 1. ~ 12. 31.');
    expect(cleaned).toContain('· 대상 기관: 전 부처');
    expect(cleaned).not.toContain('*');
  });

  it('코드블록 및 인용구 기호를 정제한다', () => {
    const raw = `\`\`\`markdown\n> 1. 추진 배경\n내용\n\`\`\``;
    const cleaned = cleanAdminDraft(raw);
    expect(cleaned).not.toContain('```');
    expect(cleaned).not.toContain('>');
    expect(cleaned).toContain('1. 추진 배경');
  });
});
