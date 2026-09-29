// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeStyleResult, directInsertAtTarget } from './draft-editor';
import type { StyledInsertPayload } from '../template-format/apply';

const STYLED: StyledInsertPayload = {
  paras: [{ text: ' ❍ 품질 확보', font: '휴먼명조', height: 1600, bold: false, spacing: 0, ratio: 100, lineSpacing: 170, prev: 0, next: 0, left: 0, indent: -2830, align: 1 }],
  html: "<p style=\"font-family:'휴먼명조';font-size:16pt;\">&nbsp;❍ 품질 확보</p>",
  text: ' ❍ 품질 확보',
};

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('서식 적용 삽입 안내', () => {
  it('쓴 방식과 확인 결과에 따라 안내 문구를 붙인다', () => {
    expect(describeStyleResult({ success: true, method: 'InsertLinesWithBreakPara' })).toBe('');
    expect(describeStyleResult({ success: true, method: 'StyledShapeActions', styleCheck: 'verified' })).toContain('등록한 서식 적용됨');
    expect(describeStyleResult({ success: true, method: 'SetTextFileHtml', styleCheck: 'mismatch' })).toContain('HTML');
    expect(describeStyleResult({ success: true, method: 'InsertLinesWithBreakPara', styleCheck: 'text-only' })).toContain('기호·들여쓰기만');
  });

  it('한글 기안기 대상이면 서식 묶음을 백그라운드 삽입 요청에 실어 보내고 결과를 안내에 담는다', async () => {
    const sendMessage = vi.fn(async () => ({ success: true, method: 'StyledShapeActions', styleCheck: 'verified', capabilities: ['CreateAction'] }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    document.body.innerHTML = '<div id="HwpCtrl"></div>';
    const res = await directInsertAtTarget(document.getElementById('HwpCtrl'), STYLED.text, undefined, undefined, document, STYLED);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'DRAFT_MAIN_WORLD_HWP_INSERT', text: STYLED.text, styled: STYLED });
    expect(res.status).toBe('applied');
    expect(res.message).toContain('등록한 서식 적용됨');
    expect(res.hwp?.capabilities).toEqual(['CreateAction']);
  });

  it('웹 편집기(contenteditable)에는 서식 있는 HTML을 넣는다', async () => {
    vi.stubGlobal('chrome', undefined);
    document.body.innerHTML = '<div id="ed" contenteditable="true"></div>';
    const exec = vi.fn(() => true);
    Object.assign(document, { execCommand: exec, queryCommandSupported: () => true });
    await directInsertAtTarget(document.getElementById('ed'), STYLED.text, undefined, undefined, document, STYLED);
    expect(exec).toHaveBeenCalledWith('insertHTML', false, STYLED.html);
  });
});
