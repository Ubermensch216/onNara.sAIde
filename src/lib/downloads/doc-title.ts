/**
 * 파일·폴더 이름과 꾸러미에 쓰는 "원본 공문 제목".
 *
 * ★ 온나라 목록은 제목 칸에 `[auto]` 같은 표시(자동생성 아이콘의 대체 글자)를 함께 그린다.
 *   화면에서 읽은 칸 글자에는 그 표시가 섞여 있지만 공문 제목의 일부가 아니다.
 *   그대로 쓰면 `20260807_[auto]데이터…` 처럼 원본과 다른 이름이 된다.
 *
 * ★ 이름에만 적용한다. 목록에서 문서를 찾아 여는 데는 화면에 보이는 글자(표시 포함)가 필요하므로
 *   목록 행의 제목(`row.title`)은 바꾸지 않는다.
 *
 * ★ `[auto]`만 뗀다. `[AI 기반 …]`처럼 사용자가 제목에 직접 적은 대괄호는 제목이므로 건드리지 않는다.
 */

const AUTO_MARK = /^\s*(?:\[\s*auto\s*\]\s*)+|(?:\s*\[\s*auto\s*\])+\s*$/gi;

export function originalDocTitle(title: string): string {
  const cleaned = title.replace(AUTO_MARK, '').trim();
  return cleaned || title.trim();
}
