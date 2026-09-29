// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { FileExtractError } from '../extract/files/types';
import { analyzeTemplateBytes, classifyMarker, countLeadSpaces, detectTemplateKind } from './index';
import { lengthToPt, odtLineHeightToHwp } from './units';

/* ── 합성 ODT: 온나라 내려받기 문서의 구조(결재란 표 · 제목 표 · □ ❍ - 본문)를 본뜬다 ── */

const ODT_NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
].join(' ');

const textStyle = (name: string, font: string, size: number, extra = '') =>
  `<style:style style:name="${name}" style:family="text"><style:text-properties style:font-name-asian="${font}" fo:font-size="${size}pt" style:font-size-asian="${size}pt" ${extra}/></style:style>`;
const paraStyle = (name: string, props: string) =>
  `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties ${props}/></style:style>`;
const p = (style: string, span: string, body: string) => `<text:p text:style-name="${style}"><text:span text:style-name="${span}">${body}</text:span></text:p>`;
const framed = (table: string) => `<text:p text:style-name="P0"><draw:frame><draw:text-box>${table}</draw:text-box></draw:frame></text:p>`;
const cell = (body: string, attrs = '') => `<table:table-cell ${attrs}>${body}</table:table-cell>`;

function odt(body: string): Uint8Array {
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ODT_NS}>
<office:font-face-decls>
  <style:font-face style:name="휴먼명조" svg:font-family="휴먼명조"/>
  <style:font-face style:name="HY견고딕" svg:font-family="HY견고딕"/>
  <style:font-face style:name="굴림체" svg:font-family="굴림체"/>
  <style:font-face style:name="돋움체" svg:font-family="돋움체"/>
</office:font-face-decls>
<office:automatic-styles>
  ${paraStyle('P0', 'fo:line-height="100%"')}
  ${paraStyle('PH', 'fo:line-height="138%" fo:margin-top="0.529cm" fo:text-align="justify"')}
  ${paraStyle('PI', 'fo:line-height="131%" fo:margin-left="1cm" fo:text-indent="-1cm" fo:text-align="start"')}
  ${paraStyle('PS', 'fo:line-height="131%" fo:text-align="justify"')}
  ${paraStyle('PO', 'fo:line-height="123%" fo:margin-left="0.627cm" fo:text-indent="-0.627cm"')}
  ${textStyle('TA', '굴림체', 10)}
  ${textStyle('TH', 'HY견고딕', 17)}
  ${textStyle('TI', '휴먼명조', 16)}
  ${textStyle('TS', '휴먼명조', 15, 'fo:letter-spacing="-1.20pt"')}
  ${textStyle('TB', '휴먼명조', 17, 'fo:font-weight="bold"')}
  ${textStyle('TO', '돋움체', 12)}
</office:automatic-styles>
<office:body><office:text>${body}</office:text></office:body></office:document-content>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${ODT_NS}>
<office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="21.000cm" fo:page-height="29.700cm" fo:margin-left="2.000cm" fo:margin-right="2.000cm" fo:margin-top="1.000cm" fo:margin-bottom="0.500cm"/></style:page-layout></office:automatic-styles>
<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles></office:document-styles>`;
  return zipSync({ mimetype: strToU8('application/vnd.oasis.opendocument.text'), 'content.xml': strToU8(content), 'styles.xml': strToU8(styles) });
}

const APPROVAL = framed(`<table:table><table:table-row>${cell(p('P0', 'TA', '등록번호'), 'table:protected="true"')}${cell(p('P0', 'TA', '감사담당관-1<text:bookmark text:name="CellField1¡문서번호¡F"/>'))}</table:table-row></table:table>`);
const TITLE = framed(`<table:table>
  <table:table-row>${cell(p('P0', 'TB', '제목:'))}${cell(p('P0', 'TH', '시스템 구축 보고<text:bookmark text:name="CellField2¡제목¡F"/>'))}</table:table-row>
  <table:table-row>${cell(p('P0', 'TS', '<text:s text:c="2"/>시스템 구축 추진사항을 보고함.'), 'table:number-columns-spanned="2"')}<table:covered-table-cell/></table:table-row>
</table:table>`);

describe('단계 기호 판별', () => {
  it('모양이 달라도 같은 단계면 같은 key로 묶는다', () => {
    expect(classifyMarker(' ❍ 감리명')?.key).toBe('item');
    expect(classifyMarker(' ㅇ 대상기관')?.key).toBe('item');
    expect(classifyMarker('○ 행사개요')?.key).toBe('item');
    expect(classifyMarker('\u{F03DA} 감리 개요')?.key).toBe('section');
    expect(classifyMarker('□ 추진 배경')?.key).toBe('section');
    expect(classifyMarker('    ‧ 보틀판매')?.key).toBe('detail');
    expect(classifyMarker('    · 보틀판매')?.key).toBe('detail');
  });
  it('한컴 원문자 제목은 글자가 달라도 한 단계다', () => {
    expect(classifyMarker('\u{F02B1} 행사 위치도')?.key).toBe('sym-pua');
    expect(classifyMarker('\u{F02B2} 프로그램 구성')?.key).toBe('sym-pua');
  });
  it('공문 번호와 날짜·기호 없는 문장을 가른다', () => {
    expect(classifyMarker('1. 관련 문서')?.key).toBe('num');
    expect(classifyMarker('2026. 9. 26.(토)')).toBeUndefined();
    expect(classifyMarker('가. 세부 내용')?.key).toBe('ga');
    expect(classifyMarker('-행 사 명 : 나이트 마켓')?.key).toBe('sub');
    expect(classifyMarker('붙임 계획서 1부.')?.key).toBe('attach');
    expect(classifyMarker('ㅇ은 자음이다')).toBeUndefined();
    expect(classifyMarker('일반 문장입니다')).toBeUndefined();
  });
  it('앞 공백 칸 수를 센다(전각 공백은 2칸)', () => {
    expect(countLeadSpaces('   - 항목')).toBe(3);
    expect(countLeadSpaces('　- 항목')).toBe(2);
    expect(countLeadSpaces('- 항목')).toBe(0);
  });
});

describe('단위 환산', () => {
  it('ODT 줄간격을 한글 기준으로 바꾼다(123→160, 131→170, 138→180)', () => {
    expect(odtLineHeightToHwp(123)).toBe(160);
    expect(odtLineHeightToHwp(131)).toBe(170);
    expect(odtLineHeightToHwp(138)).toBe(180);
  });
  it('길이 단위를 pt로 바꾼다', () => {
    expect(lengthToPt('2.54cm')).toBeCloseTo(72);
    expect(lengthToPt('12pt')).toBe(12);
    expect(lengthToPt('abc')).toBeUndefined();
  });
});

describe('ODT 서식 분석', () => {
  it('업무보고형: 결재란을 빼고 □ ❍ - 단계별 서식과 제목·요약 상자를 뽑는다', async () => {
    const body = [
      APPROVAL,
      TITLE,
      p('PH', 'TH', '\u{F03DA} 감리 개요'),
      p('PI', 'TI', '<text:s/>❍ 감 리 명 : 시스템 구축'),
      p('PI', 'TI', '<text:s/>❍ 발주기관 : 진흥원'),
      p('PS', 'TS', '<text:s/><text:s text:c="4"/>- 사업비가 5억원 이상인 경우'),
      p('PH', 'TH', '\u{F03DA} 추진근거'),
      p('PI', 'TI', '<text:s/>❍ 전자정부법 시행령'),
    ].join('');
    const f = await analyzeTemplateBytes('감리 보고.odt', odt(body), 1);

    expect(f.docKind).toBe('report');
    expect(f.source).toMatchObject({ fileName: '감리 보고.odt', kind: 'odt', importedAt: 1 });
    expect(f.levels.map(l => l.key)).toEqual(['section', 'item', 'sub']);

    const [section, item, sub] = f.levels;
    expect(section).toMatchObject({ glyph: '\u{F03DA}', leadSpaces: 0, count: 2 });
    expect(section!.char).toMatchObject({ font: 'HY견고딕', sizePt: 17, bold: false });
    expect(section!.para.lineSpacingPct).toBe(180);
    expect(section!.para.beforePt).toBeCloseTo(15, 0);

    expect(item).toMatchObject({ glyph: '❍', leadSpaces: 1, count: 3 });
    expect(item!.char).toMatchObject({ font: '휴먼명조', sizePt: 16 });
    // ODT "왼쪽 1cm + 첫 줄 -1cm" = 한글 "왼쪽 0 + 내어쓰기 28.3pt"
    expect(item!.para).toMatchObject({ lineSpacingPct: 170, leftPt: 0, indentPt: -28.3, align: 'left' });

    expect(sub).toMatchObject({ glyph: '-', leadSpaces: 5 });
    expect(sub!.char.spacingPct).toBe(-8); // -1.20pt ÷ 15pt

    const title = f.boxes.find(b => b.role === 'title');
    expect(title).toMatchObject({ sample: '시스템 구축 보고' });
    expect(title!.char).toMatchObject({ font: 'HY견고딕', sizePt: 17 });
    expect(title!.leadChar).toMatchObject({ font: '휴먼명조', sizePt: 17, bold: true });
    expect(f.boxes.find(b => b.role === 'summary')?.char).toMatchObject({ font: '휴먼명조', sizePt: 15 });

    expect(f.headings).toEqual(['감리 개요', '추진근거']);
    expect(f.page).toEqual({ widthMm: 210, heightMm: 297, marginMm: { top: 10, bottom: 5, left: 20, right: 20 } });
    // 결재란 글자는 어디에도 남지 않는다.
    expect(JSON.stringify(f)).not.toContain('등록번호');
    expect(f.notes.join(' ')).toMatch(/문서 틀 표 1개/);
  });

  it("시행문: '본문' 누름틀 안만 분석하고 시행문으로 판정한다", async () => {
    const body = [
      p('P0', 'TO', '발주는 부산기업으로'),
      `<text:p text:style-name="PO"><text:span text:style-name="TO"><text:bookmark-start text:name="NormalField72¡본문¡본문을 입력하십시오¡T¡T"/>1. 관련 문서입니다.</text:span></text:p>`,
      p('PO', 'TO', '2. 개최계획을 알려드립니다.'),
      p('PO', 'TO', '<text:s text:c="2"/>○ 행사개요'),
      `<text:p text:style-name="PO"><text:span text:style-name="TO"><text:s text:c="4"/>- 장소 : 화명생태공원<text:bookmark-end text:name="NormalField72¡본문¡본문을 입력하십시오¡T¡T"/></text:span></text:p>`,
      p('P0', 'TO', '부산광역시장'),
    ].join('');
    const f = await analyzeTemplateBytes('알림.odt', odt(body), 1);
    expect(f.docKind).toBe('official');
    expect(f.levels.map(l => l.key)).toEqual(['num', 'item', 'sub']);
    expect(f.levels[0]!.glyphs).toEqual(['1.', '2.']);
    expect(f.levels[0]!.char).toMatchObject({ font: '돋움체', sizePt: 12 });
    expect(f.levels[0]!.para.lineSpacingPct).toBe(160);
    expect(f.levels[1]!.leadSpaces).toBe(2);
    expect(f.levels[2]!.leadSpaces).toBe(4);
    expect(f.headings).toEqual([]); // 시행문의 1. 2.는 문장이라 항목 이름으로 쓰지 않는다.
    expect(JSON.stringify(f)).not.toMatch(/발주는|부산광역시장/);
    expect(f.notes.join(' ')).toMatch(/본문' 누름틀/);
  });
});

/* ── 합성 HWPX: 부산시 보고서형 붙임(Ⅰ 대제목 막대 · ㅇ · -)을 본뜬다 ── */

const HWPX_NS = [
  'xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"',
  'xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"',
  'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"',
  'xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"',
].join(' ');

const charPr = (id: number, font: number, height: number, extra = '', spacing = 0, ratio = 100) =>
  `<hh:charPr id="${id}" height="${height}"><hh:fontRef hangul="${font}"/><hh:ratio hangul="${ratio}"/><hh:spacing hangul="${spacing}"/>${extra}</hh:charPr>`;
const paraPr = (id: number, align: string, line: number, intent = 0, prev = 0) =>
  `<hh:paraPr id="${id}"><hh:align horizontal="${align}"/><hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar"><hh:margin><hc:intent value="${intent}" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="${prev}" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin><hh:lineSpacing type="PERCENT" value="${line}" unit="HWPUNIT"/></hp:case><hp:default><hh:margin><hc:intent value="0" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/></hh:margin><hh:lineSpacing type="PERCENT" value="100" unit="HWPUNIT"/></hp:default></hp:switch></hh:paraPr>`;
const hp = (para: number, char: number, text: string, inner = '') => `<hp:p paraPrIDRef="${para}" styleIDRef="0"><hp:run charPrIDRef="${char}"><hp:t>${text}</hp:t>${inner}</hp:run></hp:p>`;
const hcell = (para: number, char: number, text: string) => `<hp:tc><hp:subList>${hp(para, char, text)}</hp:subList></hp:tc>`;
const chapter = (num: string, title: string) => `<hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:tbl rowCnt="1" colCnt="2"><hp:tr>${hcell(1, 3, num)}${hcell(1, 4, title)}</hp:tr></hp:tbl></hp:run></hp:p>`;

function hwpx(body: string): Uint8Array {
  const header = `<?xml version="1.0" encoding="UTF-8"?><hh:head ${HWPX_NS}><hh:refList>
<hh:fontfaces><hh:fontface lang="HANGUL"><hh:font id="0" face="함초롬바탕"/><hh:font id="1" face="HY헤드라인M"/><hh:font id="2" face="휴먼명조"/><hh:font id="3" face="함초롬돋움"/></hh:fontface>
<hh:fontface lang="LATIN"><hh:font id="0" face="Times"/></hh:fontface></hh:fontfaces>
<hh:charProperties>${charPr(0, 0, 1000)}${charPr(1, 1, 2300, '', -1)}${charPr(2, 2, 1500)}${charPr(3, 3, 1700, '<hh:bold/>')}${charPr(4, 1, 1700, '', 0, 95)}</hh:charProperties>
<hh:paraProperties>${paraPr(0, 'JUSTIFY', 160)}${paraPr(1, 'CENTER', 160)}${paraPr(2, 'LEFT', 199)}${paraPr(3, 'LEFT', 201, -2996, 1000)}</hh:paraProperties>
<hh:styles><hh:style id="0" paraPrIDRef="0" charPrIDRef="0"/></hh:styles>
</hh:refList></hh:head>`;
  const section = `<?xml version="1.0" encoding="UTF-8"?><hs:sec ${HWPX_NS}>
<hp:p paraPrIDRef="1" styleIDRef="0"><hp:run charPrIDRef="1"><hp:secPr><hp:pagePr landscape="WIDELY" width="59528" height="84189"><hp:margin left="5669" right="5669" top="5669" bottom="2835" header="0" footer="0" gutter="0"/></hp:pagePr></hp:secPr><hp:t>나이트마켓 개최 계획</hp:t></hp:run></hp:p>
${body}</hs:sec>`;
  return zipSync({ mimetype: strToU8('application/hwp+zip'), 'Contents/header.xml': strToU8(header), 'Contents/section0.xml': strToU8(section) });
}

describe('HWPX 서식 분석', () => {
  it('보고서형: 제목·Ⅰ 대제목 막대·ㅇ·- 단계와 쪽 설정을 뽑는다', async () => {
    const body = [
      chapter('Ⅰ', '추진 배경'),
      hp(2, 2, ' ㅇ 야간관광 콘텐츠를 확충'),
      hp(2, 2, ' ㅇ 상설 콘텐츠 운영'),
      chapter('Ⅱ', '행사 개요'),
      hp(3, 2, '    - 내    용 : 전통주 팝업'),
      hp(3, 2, '    - 장    소 : 화명생태공원'),
      `<hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:tbl rowCnt="2" colCnt="2"><hp:tr>${hcell(0, 0, '구분')}${hcell(0, 0, '내용')}</hp:tr><hp:tr>${hcell(0, 0, 'ㅇ 표 안 문단')}${hcell(0, 0, '값')}</hp:tr></hp:tbl></hp:run></hp:p>`,
    ].join('');
    const f = await analyzeTemplateBytes('개최 계획.hwpx', hwpx(body), 1);

    expect(f.docKind).toBe('report');
    expect(f.levels.map(l => l.key)).toEqual(['title', 'item', 'sub']);
    expect(f.levels[0]!.char).toMatchObject({ font: 'HY헤드라인M', sizePt: 23, spacingPct: -1 });
    expect(f.levels[0]!.para.align).toBe('center');

    const item = f.levels[1]!;
    expect(item).toMatchObject({ glyph: 'ㅇ', leadSpaces: 1, count: 2 }); // 표 안 'ㅇ'은 세지 않는다
    expect(item.char).toMatchObject({ font: '휴먼명조', sizePt: 15 });
    expect(item.para.lineSpacingPct).toBe(200); // 199% → 5% 단위

    const sub = f.levels[2]!;
    expect(sub.leadSpaces).toBe(4);
    expect(sub.para).toMatchObject({ lineSpacingPct: 200, indentPt: -30, beforePt: 10 }); // case 값을 default보다 먼저 읽는다

    const ch = f.boxes.find(b => b.role === 'chapter');
    expect(ch).toMatchObject({ sample: 'Ⅰ 추진 배경' });
    expect(ch!.char).toMatchObject({ font: 'HY헤드라인M', sizePt: 17, ratioPct: 95 });
    expect(ch!.leadChar).toMatchObject({ font: '함초롬돋움', sizePt: 17, bold: true });
    expect(f.headings).toEqual(['추진 배경', '행사 개요']);
    expect(f.page).toEqual({ widthMm: 210, heightMm: 297, marginMm: { top: 20, bottom: 10, left: 20, right: 20 } });
    expect(f.notes.join(' ')).toMatch(/자료 표 1개/);
  });
});

describe('형식 확인', () => {
  it('구형 .hwp는 HWPX로 저장하라고 안내한다', () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(() => detectTemplateKind('서식.hwp', ole)).toThrow(/HWPX/);
    expect(() => detectTemplateKind('서식.hwpx', ole)).toThrow(FileExtractError);
  });
  it('HWPX·ODT가 아닌 파일은 거절한다', () => {
    expect(() => detectTemplateKind('서식.pdf', strToU8('%PDF-1.7'))).toThrow(/HWPX · ODT/);
    expect(() => detectTemplateKind('서식.docx', zipSync({ a: strToU8('x') }))).toThrow(/지원하지 않습니다/);
  });
  it('본문이 비어 있으면 서식을 찾지 못했다고 알린다', async () => {
    await expect(analyzeTemplateBytes('빈.odt', odt(APPROVAL))).rejects.toThrow(/서식을 찾지 못했습니다/);
  });
});
