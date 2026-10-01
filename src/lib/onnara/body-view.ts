/**
 * 문서카드의 '본문보기' 버튼.
 *
 * ★ 클라우드 온나라는 목록에서 문서를 열면 문서카드(문서정보·보고경로·붙임)만 보여 주고,
 *   본문은 '본문보기'를 눌러야 나온다. 카드만 읽고 끝내면 모델이 메타정보를 요약하게 된다.
 * ★ 기안기의 '본문작성'과 다르다. 그쪽은 편집 화면을 여는 동작이라 여기서 누르지 않는다.
 */

const CANDIDATES = 'a, button, input[type="button"], input[type="image"], input[type="submit"], img, span, li, td, div, [role="button"]';
const LABEL = /^본문(?:바로)?보기/;
const EXCLUDED = /본문작성|본문편집|본문수정|본문저장/;

function labelOf(element: HTMLElement): string {
  return (
    element.textContent ||
    (element as HTMLInputElement).value ||
    (element as HTMLImageElement).alt ||
    element.title ||
    element.getAttribute('aria-label') ||
    ''
  ).replace(/\s+/g, '');
}

function isShown(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
    const style = view?.getComputedStyle(current);
    if (style?.display === 'none' || style?.visibility === 'hidden') return false;
  }
  return !(element as HTMLButtonElement).disabled;
}

/** 화면에 보이는 '본문보기' 버튼. 글자를 감싼 바깥 칸이 아니라 실제로 누를 요소를 돌려준다. */
export function findBodyViewButton(doc: Document = document): HTMLElement | null {
  let best: { element: HTMLElement; length: number } | null = null;
  for (const element of doc.querySelectorAll<HTMLElement>(CANDIDATES)) {
    const label = labelOf(element);
    // 버튼 글자만 가진 요소를 고른다. 긴 안내 문장이나 도구 모음 전체를 버튼으로 오인하지 않는다.
    if (label.length > 12 || !LABEL.test(label) || EXCLUDED.test(label) || !isShown(element)) continue;
    const target = element.closest<HTMLElement>('a, button, input, [onclick], [role="button"]') ?? element;
    const length = target.outerHTML.length;
    if (!best || length < best.length) best = { element: target, length };
  }
  return best?.element ?? null;
}
