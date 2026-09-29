// @vitest-environment jsdom
/**
 * 한글 기안기 서식 적용 삽입(메인 월드 스크립트)을 가짜 기안기 객체로 검증한다.
 * 실제 온나라 웹기안기의 지원 명령은 실환경에서 확인해야 하므로, 여기서는 "되는 방식부터 차례로 시도하고
 * 안 되면 다음 방식으로 내려가는지", "쓴 방식과 확인 결과를 돌려주는지"를 본다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleMainWorldHwpInsert } from '@/entrypoints/background';
import type { StyledInsertPayload } from '@/lib/template-format/apply';

const STYLED: StyledInsertPayload = {
  paras: [
    { text: '\u{F03DA} 추진 배경', font: 'HY견고딕', height: 1700, bold: false, spacing: 0, ratio: 100, lineSpacing: 180, prev: 1000, next: 0, left: 0, indent: 0, align: 0 },
    { text: ' ❍ 주요 내용', font: '휴먼명조', height: 1600, bold: false, spacing: 0, ratio: 100, lineSpacing: 170, prev: 0, next: 0, left: 0, indent: -2830, align: 1 },
  ],
  html: '<p>서식 HTML</p>',
  text: '\u{F03DA} 추진 배경\n ❍ 주요 내용',
};

interface FakeOptions { actions?: boolean; readback?: boolean; setTextFile?: boolean }

function fakeHwp({ actions = true, readback = true, setTextFile = false }: FakeOptions = {}) {
  const log: string[] = [];
  let current: Record<string, unknown> = { Height: 1000, FaceNameHangul: '함초롬바탕' };
  const hwp: Record<string, unknown> = {
    InsertText: (t: string) => { log.push(`T:${t}`); },
    Run: (a: string) => { log.push(`R:${a}`); },
  };
  if (actions) {
    hwp.CreateAction = (name: string) => ({
      CreateSet: () => {
        const items: Record<string, unknown> = {};
        return { items, SetItem: (k: string, v: unknown) => { items[k] = v; }, Item: (k: string) => items[k] };
      },
      GetDefault: (set: { items: Record<string, unknown> }) => { if (name === 'CharShape' && readback) Object.assign(set.items, current); },
      Execute: (set: { items: Record<string, unknown> }) => {
        if (name === 'ParaShape') log.push(`P:${set.items.LineSpacing}/${set.items.Indentation}/${set.items.AlignType}`);
        if (name === 'CharShape') {
          log.push(`C:${set.items.FaceNameHangul}/${set.items.Height}`);
          if (readback) current = { ...current, ...set.items };
        }
        if (name === 'InsertText') log.push(`T:${set.items.Text}`);
        return true;
      },
    });
  }
  if (setTextFile) {
    hwp.SetTextFile = (data: string, format: string, option: string, cb: (r: unknown) => void) => {
      log.push(`H:${format}/${option}/${data.includes('서식 HTML')}`);
      setTimeout(() => cb(true), 0);
    };
  }
  return { hwp, log };
}

function installChrome() {
  const executeScript = vi.fn(async (injection: { func: (...args: unknown[]) => unknown; args: unknown[] }) => [
    { result: await injection.func(...injection.args) },
  ]);
  vi.stubGlobal('chrome', { scripting: { executeScript } });
  return executeScript;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { HwpCtrl?: unknown }).HwpCtrl;
});

describe('한글 기안기 서식 적용 삽입', () => {
  it('서식 명령이 먹으면 문단마다 문단·글자 모양을 걸고 넣는다(적용 확인됨)', async () => {
    const { hwp, log } = fakeHwp();
    (window as unknown as { HwpCtrl: unknown }).HwpCtrl = hwp;
    installChrome();
    const res = await handleMainWorldHwpInsert(1, '원문', STYLED);
    expect(res).toMatchObject({ success: true, method: 'StyledShapeActions', styleCheck: 'verified' });
    expect(res.capabilities).toEqual(expect.arrayContaining(['CreateAction', 'InsertText', 'Run']));
    expect(log).toEqual([
      'P:180/0/0', 'C:HY견고딕/1700', 'T:\u{F03DA} 추진 배경',
      'R:BreakPara', 'P:170/-2830/1', 'C:휴먼명조/1600', 'T: ❍ 주요 내용',
    ]);
  });

  it('서식 명령 결과를 다시 읽어 맞지 않으면 글자를 넣기 전에 HTML 끼워 넣기로 넘어간다', async () => {
    const { hwp, log } = fakeHwp({ readback: false, setTextFile: true });
    (window as unknown as { HwpCtrl: unknown }).HwpCtrl = hwp;
    installChrome();
    const res = await handleMainWorldHwpInsert(1, '원문', STYLED);
    expect(res).toMatchObject({ success: true, method: 'SetTextFileHtml', styleCheck: 'mismatch' });
    expect(log.filter(l => l.startsWith('T:'))).toEqual([]); // 글자가 두 번 들어가지 않는다
    expect(log).toContain('H:HTML/insertfile/true');
  });

  it('서식 명령도 HTML도 없으면 기호·앞 칸을 맞춘 글자만 넣고 그렇다고 알린다', async () => {
    const { hwp, log } = fakeHwp({ actions: false });
    (window as unknown as { HwpCtrl: unknown }).HwpCtrl = hwp;
    installChrome();
    const res = await handleMainWorldHwpInsert(1, '원문', STYLED);
    expect(res).toMatchObject({ success: true, method: 'InsertLinesWithBreakPara', styleCheck: 'text-only', styleDetail: 'none' });
    expect(log).toEqual(['T:\u{F03DA} 추진 배경', 'R:BreakPara', 'T: ❍ 주요 내용']);
  });

  it('서식이 없는 삽입은 예전과 같이 글자만 넣고 서식 결과를 붙이지 않는다', async () => {
    const { hwp, log } = fakeHwp();
    (window as unknown as { HwpCtrl: unknown }).HwpCtrl = hwp;
    installChrome();
    const res = await handleMainWorldHwpInsert(1, '첫 줄\n둘째 줄');
    expect(res).toEqual({ success: true, method: 'InsertLinesWithBreakPara' });
    expect(log).toEqual(['T:첫 줄', 'R:BreakPara', 'T:둘째 줄']);
  });
});
