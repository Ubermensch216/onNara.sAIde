/**
 * 관련정보 원문 열기 요청 가로채기.
 *
 * 기안기 관련정보 링크는 `javascript:viewEnfDoc('ENF…','N')`처럼 페이지 함수로 새 창을 연다.
 * 조회 주소·필드는 기관·문서 종류마다 달라 추측할 수 없으므로, 그 함수를 한 번 실행하되
 * window.open과 form.submit을 잠시 가로채 **창을 열지 않고** 보낼 요청만 기록한다.
 * 기록한 요청은 related-document-fetch가 같은 로그인으로 fetch한다.
 *
 * ★ executeScript(MAIN)에 그대로 넘기므로 외부 변수·import에 의존하지 않는다.
 * ★ 링크의 href가 `함수명('문자열',…)` 형태이고 첫 인자가 선택한 문서 ID일 때만 실행한다.
 */
export interface CapturedOpenRequest {
  method: 'GET' | 'POST';
  url: string;
  fields: Array<[string, string]>;
}

export async function captureRelatedOpenRequest(docId: string): Promise<CapturedOpenRequest | { error: string }> {
  const OPENER = /^(?:view\w*Doc\w*|view\w*Report\w*|open\w*Doc\w*|fn_view\w*|fn_open\w*)$/i;
  const call = [...document.querySelectorAll<HTMLAnchorElement>('a[href^="javascript:"]')]
    .map(link => link.getAttribute('href')!.replace(/^javascript:\s*/i, '').trim().replace(/;$/, ''))
    .map(code => code.match(/^([A-Za-z_$][\w$]*)\(\s*((?:'[^'\\]*'|"[^"\\]*")(?:\s*,\s*(?:'[^'\\]*'|"[^"\\]*"))*)?\s*\)$/))
    .find(match => match && match[2]?.includes(docId));
  if (!call) return { error: '관련정보 링크에서 이 문서의 열기 함수를 찾지 못했습니다.' };
  const name = call[1]!;
  const args = [...(call[2] ?? '').matchAll(/'([^'\\]*)'|"([^"\\]*)"/g)].map(match => match[1] ?? match[2] ?? '');
  const w = window as unknown as Record<string, unknown>;
  if (!OPENER.test(name) || typeof w[name] !== 'function' || args[0] !== docId) {
    return { error: `허용되지 않은 열기 함수입니다: ${name}` };
  }

  let captured: CapturedOpenRequest | null = null;
  const fields = (form: HTMLFormElement): Array<[string, string]> =>
    [...new FormData(form)].filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  const fakeWindow = { closed: false, name: '', focus() {}, blur() {}, close() {}, opener: window, location: { href: 'about:blank' } };
  const original = {
    open: window.open, submit: HTMLFormElement.prototype.submit, requestSubmit: HTMLFormElement.prototype.requestSubmit,
    alert: window.alert, confirm: window.confirm,
  };
  window.open = ((url?: string | URL, target?: string) => {
    fakeWindow.name = target ?? '';
    // 주소로 바로 여는 경우도 기록한다. 빈 주소는 뒤이은 form.submit(target)을 기다린다.
    const href = url ? new URL(String(url), location.href).href : '';
    if (href && href !== 'about:blank' && !captured) captured = { method: 'GET', url: href, fields: [] };
    return fakeWindow as unknown as Window;
  }) as typeof window.open;
  HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
    if (!captured) {
      captured = {
        method: (this.getAttribute('method') || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET',
        url: new URL(this.getAttribute('action') || location.href, location.href).href,
        fields: fields(this),
      };
    }
  };
  HTMLFormElement.prototype.requestSubmit = function (this: HTMLFormElement) { HTMLFormElement.prototype.submit.call(this); };
  // "이미 열린 창을 닫고 여시겠습니까?" 같은 확인창이 사용자에게 뜨지 않게 한다. 실제 창은 열리지 않는다.
  window.alert = () => undefined;
  window.confirm = () => true;
  try {
    (w[name] as (...values: string[]) => unknown)(...args);
    // setTimeout으로 제출을 미루는 화면도 있어 잠시(최대 1초) 가로채기를 유지한다.
    for (let waited = 0; !captured && waited < 1000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50));
  } catch (error) {
    if (!captured) return { error: `열기 함수 실행 실패: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    window.open = original.open;
    HTMLFormElement.prototype.submit = original.submit;
    HTMLFormElement.prototype.requestSubmit = original.requestSubmit;
    window.alert = original.alert;
    window.confirm = original.confirm;
  }
  const result = captured as CapturedOpenRequest | null;
  if (!result) return { error: '열기 함수가 창 열기 요청을 만들지 않았습니다.' };
  if (new URL(result.url).origin !== location.origin) return { error: '열기 요청이 다른 출처로 향합니다.' };
  return result;
}
