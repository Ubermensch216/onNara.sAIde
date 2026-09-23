/**
 * 공문서 텍스트 정제 및 마크다운 제거 모듈.
 *
 * LLM이 생성한 텍스트에서 불필요한 마크다운 기호(##, **, *, _, `, > 등)를
 * 완전히 제거하고, 대한민국 행정업무운영편람의 표준 개조식 서식(1. -> 가. -> (1), -, ·)으로 정제한다.
 */

export function cleanAdminDraft(rawText: string): string {
  if (!rawText) return '';

  let lines = rawText.split(/\r?\n/);
  const cleanedLines: string[] = [];

  for (let line of lines) {
    let trimmed = line.trim();

    // 1. 마크다운 코드블록 제거 (``` 등)
    if (trimmed.startsWith('```')) {
      continue;
    }

    // 2. 마크다운 인용구 기호(>) 제거
    if (trimmed.startsWith('>')) {
      trimmed = trimmed.replace(/^>\s*/, '');
    }

    // 3. 마크다운 제목 기호(#, ##, ### 등) 제거
    // 예: "## 1. 추진 배경" -> "1. 추진 배경", "### 가. 목표" -> "가. 목표", "## 추진 배경" -> "1. 추진 배경"
    if (/^#{1,6}\s+/.test(trimmed)) {
      trimmed = trimmed.replace(/^#{1,6}\s+/, '');
    }

    // 4. 마크다운 볼드/이탤릭 기호 제거 (**문구**, __문구__, *문구*, _문구_)
    trimmed = trimmed.replace(/\*\*([^*]+)\*\*/g, '$1');
    trimmed = trimmed.replace(/__([^_]+)__/g, '$1');
    trimmed = trimmed.replace(/\*([^*]+)\*/g, '$1');
    trimmed = trimmed.replace(/_([^_]+)_/g, '$1');

    // 5. 인라인 코드(`코드`) 백틱 제거
    trimmed = trimmed.replace(/`([^`]+)`/g, '$1');

    // 6. 마크다운 불릿 기호(* 항목, + 항목)를 행정 표준 글머리표( - 또는 · )로 통일
    // 원문 들여쓰기 수준 유지
    const leadingSpaces = line.match(/^(\s*)/)?.[1] || '';
    if (/^[\*\+]\s+/.test(trimmed)) {
      trimmed = '  · ' + trimmed.replace(/^[\*\+]\s+/, '');
    } else if (/^-\s+/.test(trimmed)) {
      trimmed = '  - ' + trimmed.replace(/^-\s+/, '');
    } else if (leadingSpaces.length > 0) {
      trimmed = leadingSpaces + trimmed;
    }

    cleanedLines.push(trimmed);
  }

  // 7. 연속 3개 이상의 빈 줄을 1개의 빈 줄로 압축
  let result = cleanedLines.join('\n');
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}
