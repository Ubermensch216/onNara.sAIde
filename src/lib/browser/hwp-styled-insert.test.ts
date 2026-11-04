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

/** 온나라 누름틀 이름 꼴('NormalField72¡본문¡…')을 흉내 낸 가짜 기안기. */
function fakeHwpWithFields(opts: { fields?: string[]; bodyText?: string; curField?: string } = {}) {
  const log: string[] = [];
  const fields = opts.fields ?? ['CellField2¡제목¡F', 'NormalField72¡본문¡본문을 입력하십시오¡T¡T'];
  const hwp: Record<string, unknown> = {
    InsertText: (t: string) => { log.push(`T:${t}`); },
    Run: (a: string) => { log.push(`R:${a}`); },
    GetFieldList: () => fields.join('\x02'),
    GetFieldText: (name: string) => (name.includes('¡본문¡') ? (opts.bodyText ?? '') : ''),
    GetCurFieldName: () => opts.curField ?? '',
    MoveToField: (name: string, text: boolean, start: boolean, select: boolean) => { log.push(`M:${name}/${text}/${start}/${select}`); return true; },
  };
  return { hwp, log };
}

describe('한글 기안기 클릭 없이 본문 삽입(atBody)', () => {
  it('캐럿이 본문 밖이면 본문 누름틀 끝으로 옮긴 뒤 넣는다(빈 본문은 문단을 나누지 않는다)', async () => {
    const { hwp, log } = fakeHwpWithFields({ curField: 'CellField2¡제목¡F' });
    (window as unknown as { HwpCtrl: unknown }).HwpCtrl = hwp;
    installChrome();
    const res = await handleMainWorldHwpInsert(1, '첫 줄\n둘째 줄', undefined, true);
    expect(res.success).toBe(true);
    expect(log).toEqual(['M:NormalField72¡본문¡본문을 입력하십시오¡T¡T/true/false/false', 'T:첫 줄', 'R:BreakPara', 'T:둘째 줄']);
  });

  it('본문에 이미 글이 있으면 기존 내용은 두고 문단을 나눠 그 뒤에 잇는다', async () => {
    const { hwp, log } = fakeHwpWithFields({ bodyText: '1. 기존 내용' });
    (window as unknown as { HwpCtrl: unknown }).HwpCtrl = hwp;
    installChrome();
    const res = await handleMainWorldHwpInsert(1, '추가 글', undefined, true);
    expect(res.success).toBe(true);
    expect(log).toEqual(['M:NormalField72¡본문¡본문을 입력하십시오¡T¡T/true/false/false', 'R:BreakPara', 'T:추가 글']);
  });

  it('캐럿이 이미 본문 누름틀 안이면 옮기지 않고 그 자리에 넣는다', async () => {
    const { hwp, log } = fakeHwpWithFields({ bodyText: '기존', curField: 'NormalField72¡본문¡본문을 입력하십시오¡T¡T{{0}}' });
    (window as unknown as { HwpCtrl: unknown }).HwpCtrl = hwp;
    installChrome();
    const res = await handleMainWorldHwpInsert(1, '끼워 넣기', undefined, true);
    expect(res.success).toBe(true);
    expect(log).toEqual(['T:끼워 넣기']);
  });

  it('본문 누름틀을 못 찾으면 엉뚱한 곳에 넣지 않고 사유와 함께 실패하며, 바로 다시 시도해도 막히지 않는다', async () => {
    const { hwp, log } = fakeHwpWithFields({ fields: ['CellField2¡제목¡F'] });
    (window as unknown as { HwpCtrl: unknown }).HwpCtrl = hwp;
    installChrome();
    const res = await handleMainWorldHwpInsert(1, '글', undefined, true);
    expect(res).toMatchObject({ success: false, error: 'NO_BODY_FIELD' });
    expect(log).toEqual([]);
    const again = await handleMainWorldHwpInsert(1, '글', undefined, true);
    expect(again).toMatchObject({ success: false, error: 'NO_BODY_FIELD' }); // 'Deduplicated' 성공으로 오인되지 않는다
  });

  it('atBody가 아니면 예전처럼 누름틀을 건드리지 않고 현재 커서에 넣는다', async () => {
    const { hwp, log } = fakeHwpWithFields();
    (window as unknown as { HwpCtrl: unknown }).HwpCtrl = hwp;
    installChrome();
    const res = await handleMainWorldHwpInsert(1, '글');
    expect(res.success).toBe(true);
    expect(log).toEqual(['T:글']);
  });
});
