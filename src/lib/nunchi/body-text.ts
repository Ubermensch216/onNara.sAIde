/**
 * 꾸러미에 싣는 본문 글자 파일(`<제목>_본문.md`).
 *
 * ★ 온나라가 본문을 PDF로 주지 않으면 우리가 가진 것은 화면에서 읽은 글자뿐이다.
 *   그 글자로 PDF를 만들어 실으면 원본처럼 보이는 사본이 하나 더 생길 뿐이다.
 *   꾸러미에는 읽은 글자를 그대로 싣고(`fidelity: "extracted-text"`), 어디서 언제
 *   읽었는지와 **끝까지 읽지 못했는지**를 머리말에 적는다.
 *
 * ★ 머리말은 YAML이다. 값은 전부 JSON 문자열로 적어, 제목에 `:`나 `#`가 있어도 깨지지 않는다.
 */

export interface BodyText {
  title: string;
  /** 목록의 보고일자 원문. 없으면 적지 않는다. */
  reportDate?: string | undefined;
  /** 본문을 읽은 화면의 주소. */
  sourceUrl?: string | undefined;
  text: string;
  /** 읽은 글자가 예산에서 잘렸다. 본문 전체가 아니다. */
  truncated: boolean;
  /** 잘리기 전 원문 길이(자). */
  charCount: number;
  now?: Date;
}

export function bodyMarkdown(body: BodyText): string {
  const lines = [
    '---',
    `title: ${JSON.stringify(body.title)}`,
    ...(body.reportDate ? [`report_date: ${JSON.stringify(body.reportDate)}`] : []),
    ...(body.sourceUrl ? [`source_url: ${JSON.stringify(body.sourceUrl)}`] : []),
    `retrieved_at: ${JSON.stringify((body.now ?? new Date()).toISOString())}`,
    'origin: "onNara.sAIde 화면 추출"',
    `char_count: ${Math.max(0, Math.floor(body.charCount))}`,
    `truncated: ${body.truncated ? 'true' : 'false'}`,
    '---',
    '',
    `# ${body.title.replace(/\s+/g, ' ').trim()}`,
    '',
    body.text.trim(),
    '',
  ];
  return lines.join('\n');
}

/**
 * 글자를 `data:` 주소로 만든다.
 *
 * ★ 서비스 워커에는 `URL.createObjectURL`이 없다. 퍼센트 인코딩은 한글 한 자가 9글자가 되어
 *   긴 본문에서 주소 길이 한도를 넘기 쉬우므로 base64로 싣는다(한글 한 자 4글자).
 */
export function markdownDataUrl(markdown: string): string {
  const bytes = new TextEncoder().encode(markdown);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:text/markdown;charset=utf-8;base64,${btoa(binary)}`;
}
