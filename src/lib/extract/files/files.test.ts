// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { deflateSync, strToU8, zipSync } from 'fflate';
import { FileExtractError, decodeText, detectFormat, extractFileBytes, sha256Hex, UPLOAD_MAX_CHARS } from './index';
import { classifyLine } from './blocks';

const HP = 'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"';
const para = (text: string, attrs = '') => `<hp:p ${attrs}><hp:run><hp:t>${text}</hp:t></hp:run></hp:p>`;
const cell = (text: string, extra = '') => `<hp:tc>${extra}<hp:subList>${para(text)}</hp:subList></hp:tc>`;

function hwpx(sections: string[], extraFiles: Record<string, Uint8Array> = {}): Uint8Array {
  const files: Record<string, Uint8Array> = { mimetype: strToU8('application/hwp+zip'), ...extraFiles };
  sections.forEach((body, index) => {
    files[`Contents/section${index}.xml`] = strToU8(`<?xml version="1.0"?><hs:sec ${HP}>${body}</hs:sec>`);
  });
  return zipSync(files);
}

/** 테스트용 최소 CFB(OLE2) 컨테이너 조립 (루트 + 지정 스토리지/스트림). */
function buildTestCfb(tree: Array<{ name: string; type: 1 | 2; data?: Uint8Array; children?: Array<{ name: string; data: Uint8Array }> }>): Uint8Array {
  // 평탄화 디렉터리 엔트리 구성: 0=Root, 그 뒤 최상위 항목 및 자식 항목
  interface Entry { name: string; type: number; data: Uint8Array; left: number; right: number; child: number; startSector: number }
  const entries: Entry[] = [{ name: 'Root Entry', type: 5, data: new Uint8Array(0), left: 0xffffffff, right: 0xffffffff, child: 1, startSector: 0xfffffffe }];
  const topIds: number[] = [];

  for (const item of tree) {
    const id = entries.length;
    topIds.push(id);
    entries.push({ name: item.name, type: item.type, data: item.data ?? new Uint8Array(0), left: 0xffffffff, right: 0xffffffff, child: 0xffffffff, startSector: 0xfffffffe });
    if (item.children?.length) {
      const childIds: number[] = [];
      for (const ch of item.children) {
        const cid = entries.length;
        childIds.push(cid);
        entries.push({ name: ch.name, type: 2, data: ch.data, left: 0xffffffff, right: 0xffffffff, child: 0xffffffff, startSector: 0xfffffffe });
      }
      entries[id]!.child = childIds[0]!;
      for (let k = 0; k + 1 < childIds.length; k++) entries[childIds[k]!]!.right = childIds[k + 1]!;
    }
  }
  for (let k = 0; k + 1 < topIds.length; k++) entries[topIds[k]!]!.right = topIds[k + 1]!;

  // 모든 스트림을 일반 섹터(512B)에 배치 (miniStreamCutoff=0)
  const sectorSize = 512;
  const sectors: Uint8Array[] = [];
  const fat: number[] = [];

  const allocChain = (raw: Uint8Array): number => {
    if (!raw.byteLength) return 0xfffffffe;
    const count = Math.ceil(raw.byteLength / sectorSize);
    const first = sectors.length;
    for (let s = 0; s < count; s++) {
      const buf = new Uint8Array(sectorSize);
      buf.set(raw.subarray(s * sectorSize, (s + 1) * sectorSize));
      const sid = sectors.length;
      sectors.push(buf);
      fat[sid] = s + 1 < count ? sid + 1 : 0xfffffffe;
    }
    return first;
  };

  for (let i = 1; i < entries.length; i++) {
    if (entries[i]!.type === 2) entries[i]!.startSector = allocChain(entries[i]!.data);
  }

  // 디렉터리 섹터 작성
  const dirBytes = new Uint8Array(Math.ceil((entries.length * 128) / sectorSize) * sectorSize);
  const dirView = new DataView(dirBytes.buffer);
  entries.forEach((e, idx) => {
    const off = idx * 128;
    for (let k = 0; k < e.name.length; k++) dirView.setUint16(off + k * 2, e.name.charCodeAt(k), true);
    dirView.setUint16(off + 64, (e.name.length + 1) * 2, true);
    dirBytes[off + 66] = e.type;
    dirBytes[off + 67] = 1; // black
    dirView.setUint32(off + 68, e.left, true);
    dirView.setUint32(off + 72, e.right, true);
    dirView.setUint32(off + 76, e.child, true);
    dirView.setUint32(off + 116, e.startSector, true);
    dirView.setUint32(off + 120, e.data.byteLength, true);
  });
  const firstDirSector = allocChain(dirBytes);

  // FAT 섹터(1개)
  const fatSectorId = sectors.length;
  fat[fatSectorId] = 0xfffffffd; // FATSECT
  const fatBuf = new Uint8Array(sectorSize);
  const fatView = new DataView(fatBuf.buffer);
  for (let i = 0; i < 128; i++) fatView.setUint32(i * 4, fat[i] ?? 0xffffffff, true);
  sectors.push(fatBuf);

  // 512B 헤더
  const header = new Uint8Array(sectorSize);
  header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  const hv = new DataView(header.buffer);
  hv.setUint16(24, 0x003e, true);
  hv.setUint16(26, 0x0003, true);
  hv.setUint16(28, 0xfffe, true);
  hv.setUint16(30, 9, true); // 512
  hv.setUint16(32, 6, true); // 64
  hv.setUint32(44, 1, true); // fatSectorCount
  hv.setUint32(48, firstDirSector, true);
  hv.setUint32(56, 0, true); // miniStreamCutoff = 0 (모두 일반 섹터)
  hv.setUint32(60, 0xfffffffe, true);
  hv.setUint32(64, 0, true);
  hv.setUint32(68, 0xfffffffe, true);
  hv.setUint32(72, 0, true);
  hv.setUint32(76, fatSectorId, true);
  for (let i = 1; i < 109; i++) hv.setUint32(76 + i * 4, 0xffffffff, true);

  const out = new Uint8Array(sectorSize * (1 + sectors.length));
  out.set(header, 0);
  sectors.forEach((s, idx) => out.set(s, sectorSize * (1 + idx)));
  return out;
}

function hwpRec(tagId: number, level: number, payload: Uint8Array): Uint8Array {
  const hdr = (tagId & 0x3ff) | ((level & 0x3ff) << 10) | ((payload.byteLength & 0xfff) << 20);
  const out = new Uint8Array(4 + payload.byteLength);
  new DataView(out.buffer).setUint32(0, hdr >>> 0, true);
  out.set(payload, 4);
  return out;
}

function utf16Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  const v = new DataView(out.buffer);
  for (let i = 0; i < s.length; i++) v.setUint16(i * 2, s.charCodeAt(i), true);
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.byteLength; }
  return out;
}

describe('형식 판별', () => {
  it('구형 한글 3.x와 .doc/.ppt는 안내 메시지로 거절하고, ZIP/OLE2는 내부 구조로 자동 판별한다', () => {
    expect(() => detectFormat('옛문서.hwp', strToU8('HWP Document File V3.00 \x1a'))).toThrow(/3\.x/);
    const unknownOle = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(() => detectFormat('보고서.doc', unknownOle)).toThrow(/구형 오피스/);

    // 확장자 없는 ZIP 파일도 내부 구조로 hwpx/docx/pptx/odt 판별
    expect(detectFormat('noname', hwpx([para('본문')]))).toBe('hwpx');
    expect(detectFormat('noname', zipSync({ 'word/document.xml': strToU8('<w:document/>') }))).toBe('docx');
    expect(detectFormat('noname', zipSync({ 'ppt/presentation.xml': strToU8('<p:presentation/>') }))).toBe('pptx');
    expect(detectFormat('noname', zipSync({ mimetype: strToU8('application/vnd.oasis.opendocument.text'), 'content.xml': strToU8('<doc/>') }))).toBe('odt');
  });

  it('이미지·지원하지 않는 형식은 거절하고, %PDF 머리면 확장자 없이도 PDF로 본다', () => {
    expect(() => detectFormat('scan.png', new Uint8Array([0x89, 0x50]))).toThrow(/OCR/);
    expect(() => detectFormat('a.exe', new Uint8Array([0x4d, 0x5a]))).toThrow(/지원하지 않는/);
    expect(detectFormat('noname', strToU8('%PDF-1.7\n'))).toBe('pdf');
  });
});

describe('HWPX 고도화', () => {
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
    expect(result.text.indexOf('2. 향후 일정')).toBeGreaterThan(result.text.indexOf('목록 제출'));
    expect(result.blocks.find(block => block.text.startsWith('가.'))?.level).toBe(2);
    expect(result.blocks.filter(block => block.kind === 'table-row').map(block => block.row)).toEqual([1, 2]);
  });

  it('변경추적 삭제글·숨은설명·대체텍스트를 제외하고, 자동번호·병합표·수식·PUA·캡션을 복원한다', async () => {
    const headerXml = `<?xml version="1.0"?><hh:head ${HP}>
      <hh:numberings>
        <hh:numbering id="1">
          <hh:paraHead level="1" numFormat="DIGIT" start="1">^1.</hh:paraHead>
          <hh:paraHead level="2" numFormat="HANGUL_SYLLABLE" start="1">^2.</hh:paraHead>
        </hh:numbering>
      </hh:numberings>
      <hh:paraProperties>
        <hh:paraPr id="10"><hh:heading type="NUMBER" idRef="1" level="0"/></hh:paraPr>
        <hh:paraPr id="11"><hh:heading type="NUMBER" idRef="1" level="1"/></hh:paraPr>
      </hh:paraProperties>
    </hh:head>`;

    const body = [
      para('추진 목표', 'paraPrIDRef="10"'),
      para('세부 계획', 'paraPrIDRef="11"'),
      // 변경추적 삭제 + 숨은 설명 + PUA "(인)"(U+F012B) + 수식 + 체크박스
      `<hp:p><hp:run><hp:t>확정 금액 </hp:t><hp:ctrl><hp:deleteBegin/></hp:ctrl><hp:t>구 금액 100원 </hp:t><hp:ctrl><hp:deleteEnd/></hp:ctrl><hp:t>200원 서명\u{F012B}</hp:t></hp:run>
        <hp:run><hp:ctrl><hp:hiddenComment><hp:subList>${para('내부 메모 숨김')}</hp:subList></hp:hiddenComment></hp:ctrl></hp:run>
        <hp:run><hp:equation><hp:script>{A} over {B}</hp:script></hp:equation></hp:run>
        <hp:run><hp:checkBtn value="1" captionText="동의"/></hp:run></hp:p>`,
      // 개체 대체 텍스트 제거
      para('그림입니다. 원본 그림의 이름: sample.png'),
      para('사각형입니다.'),
      // rowSpan 병합 표 + 캡션
      `<hp:p><hp:run><hp:tbl>
        <hp:caption side="TOP"><hp:subList>${para('&lt;표 1&gt; 예산 현황')}</hp:subList></hp:caption>
        <hp:tr>
          ${cell('구분', '<hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="2"/>')}
          ${cell('항목', '<hp:cellAddr colAddr="1" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/>')}
          ${cell('금액', '<hp:cellAddr colAddr="2" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/>')}
        </hp:tr>
        <hp:tr>
          ${cell('인건비', '<hp:cellAddr colAddr="1" rowAddr="1"/><hp:cellSpan colSpan="1" rowSpan="1"/>')}
          ${cell('500만원', '<hp:cellAddr colAddr="2" rowAddr="1"/><hp:cellSpan colSpan="1" rowSpan="1"/>')}
        </hp:tr>
      </hp:tbl></hp:run></hp:p>`,
    ].join('');

    const bytes = hwpx([body], { 'Contents/header.xml': strToU8(headerXml) });
    const result = await extractFileBytes('공문.hwpx', bytes);
    expect(result.text).toContain('1. 추진 목표');
    expect(result.text).toContain('가. 세부 계획');
    expect(result.text).toContain('확정 금액 200원 서명(인)');
    expect(result.text).toContain('(A)/(B)');
    expect(result.text).toContain('☑ 동의');
    expect(result.text).not.toContain('구 금액 100원');
    expect(result.text).not.toContain('내부 메모 숨김');
    expect(result.text).not.toContain('원본 그림의 이름');
    expect(result.text).not.toContain('사각형입니다');
    expect(result.text).toContain('<표 1> 예산 현황');
    // rowSpan이 걸린 2행에서 첫 열이 비어 열 위치가 밀리지 않아야 한다
    expect(result.text).toContain('구분 | 항목 | 금액\n | 인건비 | 500만원');
  });

  it('암호화된 HWPX를 감지해 명확히 안내하고, 본문 섹션이 없으면 재저장을 안내한다', async () => {
    const encrypted = zipSync({
      'META-INF/manifest.xml': strToU8('<manifest><file-entry><encryption-data/></file-entry></manifest>'),
      'Contents/section0.xml': strToU8('encrypted'),
    });
    await expect(extractFileBytes('잠금.hwpx', encrypted)).rejects.toThrow(/암호/);
    await expect(extractFileBytes('빈.hwpx', zipSync({ mimetype: strToU8('x') }))).rejects.toThrow(/section/);
  });
});

describe('DOCX 고도화', () => {
  it('스타일 상속·자동번호·표 병합(vMerge/gridSpan)·글상자·각주·OMML 수식을 읽고 삭제/Fallback은 제외한다', async () => {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
    const styles = `<?xml version="1.0"?><w:styles ${W}>
      <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
      <w:style w:type="paragraph" w:styleId="CustomH1"><w:name w:val="기관제목"/><w:basedOn w:val="Heading1"/></w:style>
    </w:styles>`;
    const numbering = `<?xml version="1.0"?><w:numbering ${W}>
      <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>
      <w:num w:numId="5"><w:abstractNumId w:val="1"/></w:num>
    </w:numbering>`;
    const footnotes = `<?xml version="1.0"?><w:footnotes ${W}>
      <w:footnote w:id="1"><w:p><w:r><w:t>관계 법령 제5조 참조</w:t></w:r></w:p></w:footnote>
    </w:footnotes>`;
    const doc = `<?xml version="1.0"?><w:document ${W}><w:body>
      <w:p><w:pPr><w:pStyle w:val="CustomH1"/></w:pPr><w:r><w:t>사업 개요</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr></w:pPr>
        <w:r><w:t xml:space="preserve">예산 </w:t></w:r><w:del><w:r><w:delText>삭제됨</w:delText></w:r></w:del>
        <w:ins><w:r><w:t>5,000천원</w:t></w:r></w:ins>
        <w:r><w:footnoteReference w:id="1"/></w:r>
        <m:oMath><m:f><m:num><m:r><m:t>x</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath>
        <mc:AlternateContent>
          <mc:Choice><w:drawing><w:txbxContent><w:p><w:r><w:t>글상자 핵심 안내</w:t></w:r></w:p></w:txbxContent></w:drawing></mc:Choice>
          <mc:Fallback><w:pict><w:txbxContent><w:p><w:r><w:t>중복 폴백 글상자</w:t></w:r></w:p></w:txbxContent></w:pict></mc:Fallback>
        </mc:AlternateContent>
      </w:p>
      <w:tbl>
        <w:tr>
          <w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>구분</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>1분기</w:t></w:r></w:p></w:tc>
        </w:tr>
        <w:tr>
          <w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>
          <w:tc><w:p><w:r><w:t>2분기</w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>
    </w:body></w:document>`;

    const result = await extractFileBytes('개요.docx', zipSync({
      'word/document.xml': strToU8(doc),
      'word/styles.xml': strToU8(styles),
      'word/numbering.xml': strToU8(numbering),
      'word/footnotes.xml': strToU8(footnotes),
    }));
    expect(result.blocks[0]).toMatchObject({ kind: 'heading', text: '사업 개요' });
    expect(result.text).toContain('1. 예산 5,000천원 (x)/(2)');
    expect(result.text).toContain('(주석) 관계 법령 제5조 참조');
    expect(result.text).toContain('글상자 핵심 안내');
    expect(result.text).not.toContain('삭제됨');
    expect(result.text).not.toContain('중복 폴백 글상자');
    expect(result.text).toContain('[표 1]\n구분 | 1분기\n | 2분기');
  });
});

describe('XLSX 고도화', () => {
  it('공유 문자열·빈 칸·날짜 서식(한국어 내장 포함)·부동소수점 정리·병합·후리가나 제외를 처리한다', async () => {
    const files = {
      'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="제출기관" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/styles.xml': strToU8('<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="31"/></cellXfs></styleSheet>'),
      'xl/sharedStrings.xml': strToU8('<sst><si><t>기관명</t><rPh sb="0" eb="1"><t>후리가나</t></rPh></si><si><t>예산</t></si><si><r><t>교육</t></r><r><t>청</t></r></si></sst>'),
      'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>
        <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c><c r="D1" s="1"><v>46023</v></c></row>
        <row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>132.30000000000001</v></c><c r="D2"><f>SUM(C1:C2)</f></c></row>
      </sheetData></worksheet>`),
    };
    const result = await extractFileBytes('기관.xlsx', zipSync(files));
    expect(result.text).toBe('[시트: 제출기관]\n기관명 |  | 예산 | 2026-01-01\n교육청 |  | 132.3 | =SUM(C1:C2)');
    expect(result.text).not.toContain('후리가나');
  });
});

describe('신규 포맷 (HWP 5.x · XLS · PPTX · ODT · HWPML)', () => {
  it('구형 한글(.hwp 5.x) OLE2 압축 본문과 접힌 PUA("(인)")를 브라우저 순수 TS로 파싱한다', async () => {
    const fileHeader = new Uint8Array(256);
    fileHeader.set(strToU8('HWP Document File'), 0);
    fileHeader[35] = 5;
    new DataView(fileHeader.buffer).setUint32(36, 1, true); // FLAG_COMPRESSED

    // 문단 헤더(22B) + 문단 텍스트("1. 추진 계획 서명" + 0xA12B 접힌 PUA -> "(인)")
    const paraHdr = new Uint8Array(22);
    const paraText = concatBytes([utf16Bytes('1. 추진 계획 서명'), new Uint8Array([0x2b, 0xa1, 0x0d, 0x00])]);
    const sectionRaw = concatBytes([hwpRec(0x42, 0, paraHdr), hwpRec(0x43, 1, paraText)]);
    const sectionCompressed = deflateSync(sectionRaw);

    const hwpBytes = buildTestCfb([
      { name: 'FileHeader', type: 2, data: fileHeader },
      { name: 'BodyText', type: 1, children: [{ name: 'Section0', data: sectionCompressed }] },
    ]);

    // 확장자가 .hwpx로 잘못 붙어 있어도 OLE2 내부 스트림으로 HWP 5.x 자동 감지
    expect(detectFormat('잘못된이름.hwpx', hwpBytes)).toBe('hwp');
    const result = await extractFileBytes('추진계획.hwp', hwpBytes);
    expect(result.format).toBe('hwp');
    expect(result.text).toContain('1. 추진 계획 서명(인)');
  });

  it('구형 엑셀(.xls BIFF8)의 시트·SST·숫자·날짜를 파싱한다', async () => {
    const biffRec = (op: number, data: Uint8Array) => {
      const out = new Uint8Array(4 + data.byteLength);
      const v = new DataView(out.buffer);
      v.setUint16(0, op, true);
      v.setUint16(2, data.byteLength, true);
      out.set(data, 4);
      return out;
    };
    const bofGlobals = biffRec(0x0809, new Uint8Array([0x00, 0x06, 0x05, 0x00]));
    const xfDate = biffRec(0x00e0, new Uint8Array([0x00, 0x00, 14, 0x00])); // ixfe=0, fmtId=14(date)

    // SST: "기관" (UTF-16LE)
    const sstData = new Uint8Array(8 + 3 + 4);
    const sv = new DataView(sstData.buffer);
    sv.setUint32(0, 1, true);
    sv.setUint32(4, 1, true);
    sv.setUint16(8, 2, true);
    sstData[10] = 1; // UTF-16LE
    sstData.set(utf16Bytes('기관'), 11);
    const sstRec = biffRec(0x00fc, sstData);

    // Sheet BOF offset placeholder → 계산 후 채움
    const bsName = utf16Bytes('예산');
    const bsData = new Uint8Array(8 + bsName.byteLength);
    bsData[5] = 0; // worksheet
    bsData[6] = 2; // cch
    bsData[7] = 1; // UTF-16LE
    bsData.set(bsName, 8);
    const bsPlaceholder = biffRec(0x0085, bsData);
    const eofRec = biffRec(0x000a, new Uint8Array(0));
    const sheetOffset = bofGlobals.byteLength + xfDate.byteLength + sstRec.byteLength + bsPlaceholder.byteLength + eofRec.byteLength;
    new DataView(bsData.buffer).setUint32(0, sheetOffset, true);
    const bsRec = biffRec(0x0085, bsData);

    const bofSheet = biffRec(0x0809, new Uint8Array([0x00, 0x06, 0x10, 0x00]));
    const labelSstData = new Uint8Array(10); // row=0, col=0, ixfe=0, isst=0
    const labelSst = biffRec(0x00fd, labelSstData);
    const numData = new Uint8Array(14);
    const nv = new DataView(numData.buffer);
    nv.setUint16(0, 0, true); nv.setUint16(2, 1, true); nv.setUint16(4, 0, true); // ixfe=0 -> date!
    nv.setFloat64(6, 46023, true); // 2026-01-01
    const numRec = biffRec(0x0203, numData);

    const wb = concatBytes([bofGlobals, xfDate, sstRec, bsRec, eofRec, bofSheet, labelSst, numRec, eofRec]);
    const xlsBytes = buildTestCfb([{ name: 'Workbook', type: 2, data: wb }]);

    expect(detectFormat('예산.xls', xlsBytes)).toBe('xls');
    const result = await extractFileBytes('예산.xls', xlsBytes);
    expect(result.format).toBe('xls');
    expect(result.text).toBe('[시트: 예산]\n기관 | 2026-01-01');
  });

  it('PPTX 슬라이드 순서·제목·병합 표·발표자 노트를 추출한다', async () => {
    const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const pres = `<p:presentation ${P}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`;
    const presRels = `<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>`;
    const slide1 = `<p:sld ${P}><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>2026 업무보고</a:t></a:r></a:p></p:txBody></p:sp>
      <p:graphicFrame><a:graphic><a:graphicData><a:tbl>
        <a:tr><a:tc><a:txBody><a:p><a:r><a:t>과제</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>일정</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
        <a:tr><a:tc><a:txBody><a:p><a:r><a:t>시스템 고도화</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>하반기</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame>
    </p:spTree></p:cSld></p:sld>`;
    const slide1Rels = `<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`;
    const note1 = `<p:notes ${P}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>장관님 보고 시 강조</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`;

    const bytes = zipSync({
      'ppt/presentation.xml': strToU8(pres),
      'ppt/_rels/presentation.xml.rels': strToU8(presRels),
      'ppt/slides/slide1.xml': strToU8(slide1),
      'ppt/slides/_rels/slide1.xml.rels': strToU8(slide1Rels),
      'ppt/notesSlides/notesSlide1.xml': strToU8(note1),
    });
    const result = await extractFileBytes('보고.pptx', bytes);
    expect(result.format).toBe('pptx');
    expect(result.pages).toBe(1);
    expect(result.text).toContain('[1쪽]\n2026 업무보고');
    expect(result.text).toContain('[표 1]\n과제 | 일정\n시스템 고도화 | 하반기');
    expect(result.text).toContain('(발표자 노트) 장관님 보고 시 강조');
  });

  it('온나라 ODT 본문과 병합 표·각주를 추출한다', async () => {
    const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"';
    const content = `<?xml version="1.0"?><office:document-content ${NS}><office:body><office:text>
      <text:h>추진 개요</text:h>
      <text:p>본문 내용<text:note><text:note-body><text:p>각주 근거</text:p></text:note-body></text:note></text:p>
      <table:table>
        <table:table-row><table:table-cell table:number-rows-spanned="2"><text:p>항목</text:p></table:table-cell><table:table-cell><text:p>상반기</text:p></table:table-cell></table:table-row>
        <table:table-row><table:covered-table-cell/><table:table-cell><text:p>하반기</text:p></table:table-cell></table:table-row>
      </table:table>
    </office:text></office:body></office:document-content>`;
    const bytes = zipSync({ mimetype: strToU8('application/vnd.oasis.opendocument.text'), 'content.xml': strToU8(content) });
    const result = await extractFileBytes('온나라.odt', bytes);
    expect(result.format).toBe('odt');
    expect(result.text).toContain('추진 개요\n본문 내용\n(주석) 각주 근거');
    expect(result.text).toContain('[표 1]\n항목 | 상반기\n | 하반기');
  });

  it('HWPML XML 문서를 자동 감지해 본문·표를 추출한다', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><HWPML><HEAD><MAPPINGTABLE><PARASHAPELIST><PARASHAPE Id="1" HeadingType="Outline"/></PARASHAPELIST></MAPPINGTABLE></HEAD><BODY><SECTION>
      <P ParaShape="1"><TEXT><CHAR>제1장 총칙</CHAR></TEXT></P>
      <P><TEXT><TABLE><ROW><CELL ColAddr="0" RowAddr="0" ColSpan="1" RowSpan="1"><P><TEXT><CHAR>구분</CHAR></TEXT></P></CELL><CELL ColAddr="1" RowAddr="0" ColSpan="1" RowSpan="1"><P><TEXT><CHAR>비고</CHAR></TEXT></P></CELL></ROW></TABLE></TEXT></P>
    </SECTION></BODY></HWPML>`;
    const result = await extractFileBytes('법령.hml', strToU8(xml));
    expect(result.format).toBe('hwpml');
    expect(result.blocks[0]).toMatchObject({ kind: 'heading', text: '제1장 총칙' });
    expect(result.text).toContain('[표 1]\n구분 | 비고');
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
