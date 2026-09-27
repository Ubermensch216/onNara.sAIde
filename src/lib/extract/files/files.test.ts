// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { FileExtractError, decodeText, detectFormat, extractFileBytes, sha256Hex, UPLOAD_MAX_CHARS } from './index';
import { classifyLine } from './blocks';

const HP = 'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"';
const para = (text: string) => `<hp:p><hp:run><hp:t>${text}</hp:t></hp:run></hp:p>`;
const cell = (text: string) => `<hp:tc><hp:subList>${para(text)}</hp:subList></hp:tc>`;

function hwpx(sections: string[]): Uint8Array {
  const files: Record<string, Uint8Array> = { mimetype: strToU8('application/hwp+zip') };
  sections.forEach((body, index) => { files[`Contents/section${index}.xml`] = strToU8(`<?xml version="1.0"?><hs:sec ${HP}>${body}</hs:sec>`); });
  return zipSync(files);
}

describe('형식 판별', () => {
  it('구형 .hwp는 HWPX·PDF로 저장하라고 안내한다', () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(() => detectFormat('지침.hwp', ole)).toThrow(/HWPX.*PDF/);
    // 이름만 hwpx로 바꾼 구형 파일도 같은 안내
    expect(() => detectFormat('지침.hwpx', ole)).toThrow(FileExtractError);
  });
  it('이미지·지원하지 않는 형식은 거절한다', () => {
    expect(() => detectFormat('scan.png', new Uint8Array([0x89, 0x50]))).toThrow(/OCR/);
    expect(() => detectFormat('a.exe', new Uint8Array([0x4d, 0x5a]))).toThrow(/지원하지 않는/);
  });
  it('확장자가 pdf가 아니어도 머리가 %PDF면 PDF로 본다', () => {
    expect(detectFormat('noname', strToU8('%PDF-1.7\n'))).toBe('pdf');
  });
});

describe('HWPX', () => {
  it('문단 순서, 개조식 단계, 표 행을 보존하고 머리말은 뺀다', async () => {
    const body = [
      para('2026년 공공데이터 개방 추진계획'),
      para('1. 추진 배경'),
      para('가. 「공공데이터법」 제17조에 따라 개방 목록을 제출'),
      `<hp:p><hp:run><hp:ctrl><hp:header><hp:subList>${para('○○시청 머리말')}</hp:subList></hp:header></hp:ctrl></hp:run></hp:p>`,
      `<hp:p><hp:run><hp:tbl><hp:tr>${cell('구분')}${cell('기한')}</hp:tr><hp:tr>${cell('목록 제출')}${cell('2026. 10. 15.(목)')}</hp:tr></hp:tbl></hp:run></hp:p>`,
      `<hp:p><hp:run><hp:t>탭<hp:tab/>구분</hp:t></hp:run></hp:p>`,
    ].join('');
    const result = await extractFileBytes('계획.hwpx', hwpx([body, para('2. 향후 일정')]));
    expect(result.format).toBe('hwpx');
    expect(result.text).toContain('2026년 공공데이터 개방 추진계획\n1. 추진 배경\n가. 「공공데이터법」');
    expect(result.text).toContain('[표 1]\n구분 | 기한\n목록 제출 | 2026. 10. 15.(목)');
    expect(result.text).toContain('탭 구분');
    expect(result.text).not.toContain('머리말');
    // 섹션 순서
    expect(result.text.indexOf('2. 향후 일정')).toBeGreaterThan(result.text.indexOf('목록 제출'));
    expect(result.blocks.find(block => block.text.startsWith('가.'))?.level).toBe(2);
    expect(result.blocks.filter(block => block.kind === 'table-row').map(block => block.row)).toEqual([1, 2]);
  });

  it('본문 섹션이 없으면 다시 저장하라고 안내한다', async () => {
    await expect(extractFileBytes('빈.hwpx', zipSync({ mimetype: strToU8('x') }))).rejects.toThrow(/section/);
  });
});

describe('DOCX', () => {
  it('제목 스타일과 표를 읽고 삭제 표시는 뺀다', async () => {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const doc = `<?xml version="1.0"?><w:document ${W}><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>사업 개요</w:t></w:r></w:p>
      <w:p><w:r><w:t xml:space="preserve">예산 </w:t></w:r><w:del><w:r><w:delText>삭제됨</w:delText></w:r></w:del><w:r><w:t>5,000천원</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>기관</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>담당</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    </w:body></w:document>`;
    const result = await extractFileBytes('개요.docx', zipSync({ 'word/document.xml': strToU8(doc) }));
    expect(result.blocks[0]).toMatchObject({ kind: 'heading', text: '사업 개요' });
    expect(result.text).toContain('예산 5,000천원');
    expect(result.text).not.toContain('삭제됨');
    expect(result.text).toContain('[표 1]\n기관 | 담당');
  });
});

describe('XLSX', () => {
  it('공유 문자열과 빈 칸 위치를 살려 시트별 행으로 만든다', async () => {
    const files = {
      'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="제출기관" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/sharedStrings.xml': strToU8('<sst><si><t>기관명</t></si><si><t>예산</t></si><si><r><t>교육</t></r><r><t>청</t></r></si></sst>'),
      'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>1200</v></c></row></sheetData></worksheet>'),
    };
    const result = await extractFileBytes('기관.xlsx', zipSync(files));
    expect(result.text).toBe('[시트: 제출기관]\n기관명 |  | 예산\n교육청 |  | 1200');
  });
});

describe('PDF', () => {
  it('쪽 번호를 덩어리에 붙이고, 30쪽을 넘으면 알린다', async () => {
    const parsePdf = vi.fn(async () => ({ text: '1. 목적\n\n가. 세부', pages: 31, pageTexts: ['1. 목적 '.repeat(10), '가. 세부 내용입니다 '.repeat(10)] }));
    const result = await extractFileBytes('지침.pdf', strToU8('%PDF-1.7'), { parsePdf });
    expect(result.blocks[0]?.page).toBe(1);
    expect(result.blocks.at(-1)?.page).toBe(2);
    expect(result.text.startsWith('[1쪽]')).toBe(true);
    expect(result.warnings.join()).toMatch(/앞 30쪽/);
  });

  it('글자가 없는 스캔 PDF는 OCR 미지원을 알리고 거절한다', async () => {
    const parsePdf = async () => ({ text: '', pages: 3, pageTexts: ['', '', ''] });
    await expect(extractFileBytes('스캔.pdf', strToU8('%PDF-1.4'), { parsePdf })).rejects.toThrow(/스캔/);
  });

  it('해석기 오류(암호 등)를 그대로 알린다', async () => {
    const parsePdf = async () => ({ text: '', pages: 0, error: '암호로 보호된 PDF입니다' });
    await expect(extractFileBytes('잠금.pdf', strToU8('%PDF-1.4'), { parsePdf })).rejects.toThrow(/암호/);
  });
});

describe('텍스트', () => {
  it('EUC-KR 파일도 읽는다', () => {
    // "공문" in EUC-KR
    expect(decodeText(new Uint8Array([0xb0, 0xf8, 0xb9, 0xae]))).toBe('공문');
  });
  it('너무 긴 글자는 덩어리 단위로 잘라 보관하고 알린다', async () => {
    const line = '가'.repeat(999);
    const text = Array.from({ length: 250 }, () => line).join('\n');
    const result = await extractFileBytes('긴.txt', strToU8(text));
    expect(result.text.length).toBeLessThanOrEqual(UPLOAD_MAX_CHARS);
    expect(result.warnings.join()).toMatch(/보관합니다/);
  });
});

it('개조식 단계를 판별한다', () => {
  expect(classifyLine('1. 추진 배경')).toEqual({ kind: 'list', level: 1 });
  expect(classifyLine('(1) 세부')).toEqual({ kind: 'list', level: 3 });
  expect(classifyLine('□ 추진 개요')).toEqual({ kind: 'heading' });
  expect(classifyLine('2026. 9. 30.까지 제출')).toEqual({ kind: 'para' });
});

it('같은 내용이면 같은 지문을 낸다', async () => {
  expect(await sha256Hex('a')).toBe(await sha256Hex(new Uint8Array([0x61])));
});
