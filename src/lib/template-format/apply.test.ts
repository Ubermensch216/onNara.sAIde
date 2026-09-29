import { describe, expect, it } from 'vitest';
import { buildStyledInsert, formatHierarchyPrompt, layoutDraft, paragraphsToHtml, paragraphsToHwp, paragraphsToText } from './apply';
import type { CharStyle, LevelStyle, ParaStyle, TemplateFormat } from './types';

const char = (font: string, sizePt: number, bold = false): CharStyle => ({ font, sizePt, bold, spacingPct: 0, ratioPct: 100 });
const para = (lineSpacingPct: number, extra: Partial<ParaStyle> = {}): ParaStyle => ({ lineSpacingPct, beforePt: 0, afterPt: 0, leftPt: 0, indentPt: 0, align: 'justify', ...extra });
const level = (key: string, glyph: string, leadSpaces: number, c: CharStyle, p: ParaStyle, glyphs = [glyph]): LevelStyle =>
  ({ key, label: key, glyph, glyphs, sample: '', leadSpaces, char: c, para: p, count: 3 });
const format = (levels: LevelStyle[], extra: Partial<TemplateFormat> = {}): TemplateFormat => ({
  version: 1, source: { fileName: 'x.odt', kind: 'odt', sha256: '', importedAt: 0 }, docKind: 'report', levels, boxes: [], headings: [], notes: [], ...extra,
});

/** 감리 추진 보고(업무보고형) 서식. */
const REPORT = format([
  level('section', '\u{F03DA}', 0, char('HY견고딕', 17), para(180, { beforePt: 10 })),
  level('item', '❍', 1, char('휴먼명조', 16), para(170, { indentPt: -28.3 })),
  level('sub', '-', 3, char('휴먼명조', 15), para(170)),
]);

describe('초안에 서식 입히기', () => {
  it('모델이 1. 가. -로 써도 서식의 □ ❍ - 기호·앞 칸·글자 서식으로 바꾼다', () => {
    const paras = layoutDraft('1. 추진 배경\n가. 품질 확보\n- 제3자 감리 실시\n2. 향후 계획\n가. 결과 반영', REPORT);
    expect(paras.map(p => p.text)).toEqual([
      '\u{F03DA} 추진 배경', ' ❍ 품질 확보', '   - 제3자 감리 실시', '\u{F03DA} 향후 계획', ' ❍ 결과 반영',
    ]);
    expect(paras[0]!.char).toMatchObject({ font: 'HY견고딕', sizePt: 17 });
    expect(paras[1]!.para).toMatchObject({ lineSpacingPct: 170, indentPt: -28.3 });
    expect(paras[2]!.char.sizePt).toBe(15);
  });

  it('서식과 같은 단계 기호(○)는 모양만 서식 기호(❍)로 바꾼다', () => {
    const paras = layoutDraft('□ 추진 배경\n○ 품질 확보\n  - 감리', REPORT);
    expect(paras.map(p => p.text)).toEqual(['\u{F03DA} 추진 배경', ' ❍ 품질 확보', '   - 감리']);
  });

  it('시행문: 번호를 새로 매기고 윗단계가 나오면 아랫단계 번호를 다시 센다', () => {
    const official = format([
      level('num', '1.', 0, char('돋움체', 12), para(160, { indentPt: -17.8 }), ['1.', '2.']),
      level('ga', '가.', 2, char('돋움체', 12), para(160)),
      level('sub', '-', 4, char('돋움체', 12), para(160)),
    ], { docKind: 'official' });
    const paras = layoutDraft('1. 관련 문서입니다.\n1. 개최 계획을 알립니다.\n가. 일시\n가. 장소\n- 화명생태공원\n3. 협조 바랍니다.\n가. 안전 관리', official);
    expect(paras.map(p => p.text)).toEqual([
      '1. 관련 문서입니다.', '2. 개최 계획을 알립니다.', '  가. 일시', '  나. 장소', '    - 화명생태공원', '3. 협조 바랍니다.', '  가. 안전 관리',
    ]);
  });

  it('보고서형 HWPX: Ⅰ 대제목 막대와 한컴 원문자 제목(󰊱 󰊲) 번호를 이어 매긴다', () => {
    const hwpx = format([
      level('title', '', 0, char('HY헤드라인M', 23), para(160, { align: 'center' })),
      level('sym-pua', '\u{F02B1}', 0, char('HY헤드라인M', 16), para(160), ['\u{F02B1}', '\u{F02B2}']),
      level('item', 'ㅇ', 1, char('휴먼명조', 15), para(200)),
    ], {
      boxes: [{ role: 'chapter', sample: '', char: char('HY헤드라인M', 17), para: para(140), leadChar: char('함초롬돋움', 17, true) }],
    });
    const paras = layoutDraft('나이트마켓 개최 계획\n\nⅠ. 추진 배경\n◎ 행사 위치\nㅇ 위치도\n◎ 프로그램\n\n\nⅡ. 행사 개요\n◎ 개요\nㅇ 일시', hwpx);
    expect(paras.map(p => [p.role, p.lead ?? '', p.text])).toEqual([
      ['title', '', '나이트마켓 개최 계획'],
      ['text', '', ''],
      ['chapter', 'Ⅰ', '추진 배경'],
      ['text', '', '\u{F02B1} 행사 위치'],
      ['text', '', ' ㅇ 위치도'],
      ['text', '', '\u{F02B2} 프로그램'],
      ['text', '', ''], // 빈 줄 여러 개는 하나로
      ['chapter', 'Ⅱ', '행사 개요'],
      ['text', '', '\u{F02B1} 개요'], // 대제목이 바뀌면 원문자 번호를 다시 센다
      ['text', '', ' ㅇ 일시'],
    ]);
    expect(paras[0]!.char.sizePt).toBe(23);
    expect(paras[2]!.leadChar).toMatchObject({ font: '함초롬돋움', bold: true });
    expect(paragraphsToText(paras).split('\n')[2]).toBe('Ⅰ. 추진 배경');
  });

  it('기호 없는 줄은 바로 앞 단계 서식으로 두 칸 더 들여 이어 쓴다', () => {
    const paras = layoutDraft('○ 사업 개요\n세부 내용은 붙임 참조', REPORT);
    expect(paras.map(p => p.text)).toEqual([' ❍ 사업 개요', '   세부 내용은 붙임 참조']);
    expect(paras[1]!.char.font).toBe('휴먼명조');
  });
});

describe('서식 묶음 직렬화', () => {
  it('한글 기안기 명령용 값은 HWPUNIT·정렬 번호로 바꾼다', () => {
    const [first, second] = paragraphsToHwp(layoutDraft('□ 추진 배경\n○ 품질', REPORT));
    expect(first).toMatchObject({ font: 'HY견고딕', height: 1700, lineSpacing: 180, prev: 1000, align: 0 });
    expect(second).toMatchObject({ height: 1600, indent: -2830, text: ' ❍ 품질' });
  });

  it('HTML은 글꼴·크기·줄간격을 인라인으로 적고 앞 칸을 &nbsp;로 지킨다', () => {
    const html = paragraphsToHtml(layoutDraft('□ 추진 배경\n○ 품질 <확보>', REPORT));
    expect(html).toContain("font-family:'HY견고딕';font-size:17pt");
    expect(html).toContain('line-height:170%');
    expect(html).toContain('text-indent:-28.3pt');
    expect(html).toContain('&nbsp;❍ 품질 &lt;확보&gt;');
  });

  it('buildStyledInsert는 명령·HTML·글자를 한 번에 만든다', () => {
    const payload = buildStyledInsert('□ 추진 배경', REPORT);
    expect(payload.paras).toHaveLength(1);
    expect(payload.text).toBe('\u{F03DA} 추진 배경');
    expect(payload.html).toContain('<p');
  });
});

describe('AI 요청문 단계 기호', () => {
  it('서식의 단계 순서를 일반 문자로 알려 준다(한컴 전용 문자는 쓰지 않는다)', () => {
    const prompt = formatHierarchyPrompt(REPORT);
    expect(prompt).toContain('□ → ○ → -');
    expect(prompt).not.toMatch(/[\u{F0000}-\u{FFFFD}]/u);
  });
  it('대제목 막대·원문자 제목이 있는 서식은 Ⅰ. → ◎ 순으로 알린다', () => {
    const f = format([level('sym-pua', '\u{F02B1}', 0, char('HY헤드라인M', 16), para(160)), level('item', 'ㅇ', 1, char('휴먼명조', 15), para(200))], {
      boxes: [{ role: 'chapter', sample: '', char: char('HY헤드라인M', 17), para: para(140) }],
    });
    expect(formatHierarchyPrompt(f)).toContain('Ⅰ. → ◎ → ○');
  });
});
