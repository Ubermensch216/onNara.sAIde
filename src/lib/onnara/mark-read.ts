/**
 * 온나라 받은문서 목록의 `읽기처리` — 체크한 문서를 `미열람` → `열람`으로 바꾼다.
 *
 * ★ 문서를 열어서는 열람으로 바뀌지 않았다(2026-09-23 확인). 온나라가 열람 처리를 위해
 *   따로 두고 있는 길은 "목록에서 체크하고 `읽기처리`를 누르는 것"이고, 여기서는 그 버튼을
 *   사람이 누르는 것과 똑같이 누른다. 온나라 내부 함수 이름에 기대지 않는다.
 *
 * ★ 두 걸음으로 나눈다.
 *   1. [prepareMarkRead] (확장 영역) — 행을 찾아 체크하고 버튼에 표지를 붙인다.
 *   2. [clickMarkedReadButton] (페이지 영역, MAIN world) — 페이지의 `confirm`을 잠시
 *      수락으로 바꾸고 버튼을 누른다. 확장 영역의 `confirm`을 바꿔서는 페이지 스크립트가
 *      띄우는 확인창에 닿지 않는다.
 *
 * ★ **대상 외 문서의 체크는 먼저 푼다.** 사용자가 체크해 둔 다른 문서가 함께 열람 처리되면
 *   되돌릴 수 없다.
 */

import { findDocumentRow } from './document-list';

export const READ_BUTTON_LABEL = '읽기처리';
/** 1단계가 찾은 버튼에 붙이는 표지. 2단계는 이 표지로만 버튼을 찾는다. */
export const READ_BUTTON_MARK = 'data-saide-read-button';

const CHECKBOX_SELECTOR = 'input[type="checkbox"]';
const BUTTON_SELECTOR = 'button, a, input[type="button"], input[type="submit"], input[type="image"], [role="button"], [onclick], span, img';

export type MarkReadPrepared =
  | { ok: true; checked: string[]; missing: string[] }
  | { ok: false; message: string; hint?: string };

function compact(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, '');
}

function visible(element: Element): boolean {
  const html = element as HTMLElement;
  if (html.hidden || html.closest?.('[hidden], [aria-hidden="true"]')) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(html);
  return style?.display !== 'none' && style?.visibility !== 'hidden';
}

function labelOf(element: Element): string {
  const input = element as HTMLInputElement;
  return compact(element.textContent) || compact(input.value) ||
    compact(element.getAttribute('alt')) || compact(element.getAttribute('title'));
}

/**
 * `읽기처리` 버튼. 글자가 정확히 같은 것만 본다.
 *
 * ★ `<a><span>읽기처리</span></a>`처럼 겹쳐 있으면 누를 수 있는 바깥 요소를 고른다.
 *   같은 글자의 서로 다른 버튼이 둘 이상이면 고르지 않는다 — 엉뚱한 것을 누르느니 멈춘다.
 */
export function findReadButton(root: Document = document): HTMLElement | null {
  const matches = [...root.querySelectorAll<HTMLElement>(BUTTON_SELECTOR)]
    .filter(element => labelOf(element) === READ_BUTTON_LABEL && visible(element));
  const clickable = matches.map(element =>
    element.closest<HTMLElement>('button, a, input, [role="button"], [onclick]') ?? element);
  const unique = [...new Set(clickable)];
  // 바깥 요소가 안쪽 요소를 품고 있으면 같은 버튼이다.
  const outer = unique.filter(element => !unique.some(other => other !== element && other.contains(element)));
  return outer.length === 1 ? outer[0]! : null;
}

function rowCheckbox(row: Element): HTMLInputElement | null {
  return row.querySelector<HTMLInputElement>(CHECKBOX_SELECTOR);
}

/** 사람이 누른 것처럼 바꾼다. 목록 스크립트가 click/change 중 무엇을 듣든 닿게 한다. */
function toggle(box: HTMLInputElement, checked: boolean): void {
  if (box.checked === checked) return;
  box.click();
  if (box.checked !== checked) {
    box.checked = checked;
    box.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

/** 1단계: 대상 행만 체크하고 버튼에 표지를 붙인다. 아직 아무것도 처리하지 않는다. */
export function prepareMarkRead(titles: string[], root: Document = document): MarkReadPrepared {
  const button = findReadButton(root);
  if (!button) {
    return {
      ok: false,
      message: `목록 화면에서 '${READ_BUTTON_LABEL}' 버튼을 찾지 못했습니다.`,
      hint: '온나라 공유/공람 > 받은문서 목록이 화면에 보이는 탭에서 다시 시도하세요.',
    };
  }

  const targets = new Map<string, Element>();
  const missing: string[] = [];
  for (const title of titles) {
    const row = findDocumentRow(title, root);
    if (row && rowCheckbox(row)) targets.set(title, row);
    else missing.push(title);
  }
  if (!targets.size) {
    return { ok: false, message: '목록에서 처리할 문서의 행을 찾지 못했습니다.', hint: missing.slice(0, 3).join(' / ') };
  }

  // 대상 외 체크를 푼다. 머리글의 전체 선택을 풀면 행 체크가 함께 풀리므로 매번 다시 본다.
  const keep = new Set([...targets.values()].map(rowCheckbox));
  for (let guard = 0; guard < 1000; guard++) {
    const stray = [...root.querySelectorAll<HTMLInputElement>(`table ${CHECKBOX_SELECTOR}:checked, [role="grid"] ${CHECKBOX_SELECTOR}:checked`)]
      .find(box => !keep.has(box));
    if (!stray) break;
    toggle(stray, false);
  }

  const checked: string[] = [];
  for (const [title, row] of targets) {
    const box = rowCheckbox(row)!;
    toggle(box, true);
    if (box.checked) checked.push(title);
    else missing.push(title);
  }
  if (!checked.length) return { ok: false, message: '처리할 문서를 체크하지 못했습니다.' };

  for (const old of root.querySelectorAll(`[${READ_BUTTON_MARK}]`)) old.removeAttribute(READ_BUTTON_MARK);
  button.setAttribute(READ_BUTTON_MARK, '');
  return { ok: true, checked, missing };
}

/**
 * 2단계: 페이지 영역에서 표지가 붙은 버튼을 누른다. `chrome.scripting.executeScript`의
 * `func`로 쓰이므로 **바깥 이름을 참조하지 않는다**(직렬화되어 페이지에서 실행된다).
 *
 * ★ `confirm`은 잠시만 수락으로 바꾼다. `javascript:` 링크는 누른 뒤 한 박자 늦게 실행되므로
 *   바로 되돌리면 확인창을 놓친다. 그 뒤에는 원래대로 돌려 사용자의 다른 작업에 끼어들지 않는다.
 *
 * ★ 뜬 알림 글은 문서 요소 속성에 남긴다. 처리 결과 알림은 서버 응답 뒤에 늦게 뜨므로
 *   서비스 워커가 나중에 [readMarkReadDialogs]로 모아 본다.
 */
export function clickMarkedReadButton(mark: string, attr: string): { clicked: boolean } {
  const button = document.querySelector<HTMLElement>(`[${mark}]`);
  if (!button) return { clicked: false };
  button.removeAttribute(mark);
  const root = document.documentElement;
  root.setAttribute(attr, '[]');
  const record = (message: unknown) => {
    try {
      const list = JSON.parse(root.getAttribute(attr) || '[]') as string[];
      list.push(String(message ?? '').trim());
      root.setAttribute(attr, JSON.stringify(list.slice(-10)));
    } catch { /* 기록 실패는 처리에 영향이 없다 */ }
  };
  const windows: Window[] = [window];
  try { if (window.parent && !windows.includes(window.parent)) windows.push(window.parent); } catch { /* 다른 출처 */ }
  try { if (window.top && !windows.includes(window.top)) windows.push(window.top); } catch { /* 다른 출처 */ }
  const saved = windows.flatMap(target => {
    try {
      const original = { target, confirm: target.confirm, alert: target.alert };
      target.confirm = (message?: string) => { record(message); return true; };
      target.alert = (message?: unknown) => { record(message); };
      return [original];
    } catch { return []; }
  });
  try {
    button.click();
  } finally {
    setTimeout(() => { for (const item of saved) try { item.target.confirm = item.confirm; } catch { /* */ } }, 2000);
    setTimeout(() => { for (const item of saved) try { item.target.alert = item.alert; } catch { /* */ } }, 8000);
  }
  return { clicked: true };
}

/** 2단계 뒤 페이지에 뜬 알림 글. `func`로 쓰이므로 바깥 이름을 참조하지 않는다. */
export function readMarkReadDialogs(attr: string): string[] {
  try { return JSON.parse(document.documentElement.getAttribute(attr) || '[]') as string[]; } catch { return []; }
}

export const READ_DIALOG_ATTR = 'data-saide-read-dialogs';

/** 온나라가 처리 실패를 알린 글. 이 글이 뜨면 결과를 기다리지 않고 멈춘다. */
export const READ_FAILURE_PATTERN = /실패|오류|권한|선택(된|한)?\s*(문서|항목)이?\s*없|선택하(여|세요|십시오)|할\s*수\s*없/;
/** 온나라가 처리 완료를 알린 글. */
export const READ_SUCCESS_PATTERN = /처리\s*(되었|됐|완료|하였)|완료\s*되었/;
