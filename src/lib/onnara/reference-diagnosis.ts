/**
 * 관련정보 원문 진단. 실제 온나라 원문 화면이 본문을 어떻게 불러오는지 JSON으로 남긴다.
 *
 * ★ 읽기 전용: 조회(view) 요청만 보내고, 버튼을 누르거나 함수를 호출하지 않는다.
 * ★ 본문은 앞부분 일부만, 숨은 입력값은 식별자류만 남기고 나머지는 길이만 적는다.
 * runReferenceProbe는 executeScript(MAIN)에 그대로 넘기므로 외부 변수·import에 의존하지 않는다.
 */

export type ReferenceProbeKind = 'frame' | 'fetch';

export async function runReferenceProbe(
  kind: ReferenceProbeKind, docId?: string, docUrl?: string,
  open?: { method: 'GET' | 'POST'; url: string; fields: Array<[string, string]> },
): Promise<unknown> {
  const cut = (value: unknown, max = 200) => {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return text.length > max ? text.slice(0, max) + `…(${text.length}자)` : text;
  };
  const KEEP_VALUE = /(?:id|seq|no|type|kind|mode|gubun|file|path|url|ext|format|flag|yn|cd|code)$/i;
  const MUTATION = /(?:delete|remove|insert|update|save|add|modify|approve|sign|logout|markread)/i;

  const summarize = (doc: Document) => {
    const inlineHints: string[] = [];
    for (const script of doc.querySelectorAll('script:not([src])')) {
      for (const line of (script.textContent ?? '').split('\n')) {
        if (inlineHints.length >= 80) break;
        if (/\.do\b|\.hwpx?\b|\.pdf\b|\.Open\s*\(|HwpCtrl|webhwp|viewer|synap|docview|fileid|filepath|attach|body/i.test(line)) {
          inlineHints.push(cut(line, 300));
        }
      }
    }
    const relatedRows = [...doc.querySelectorAll('th, td, label, dt')]
      .filter(node => /^관련\s*정보$/.test(node.textContent?.trim() ?? ''))
      .map(node => cut((node.closest('tr') ?? node.parentElement)?.outerHTML, 4000));
    const body = doc.body;
    return {
      title: cut(doc.title, 120),
      frames: [...doc.querySelectorAll('iframe, frame, object, embed')].map(node => ({
        tag: node.tagName.toLowerCase(), id: node.id, name: node.getAttribute('name') ?? '',
        src: cut(node.getAttribute('src') ?? node.getAttribute('data') ?? '', 400),
        type: node.getAttribute('type') ?? '', hidden: (node as HTMLElement).hidden || /display\s*:\s*none/i.test(node.getAttribute('style') ?? ''),
      })).slice(0, 40),
      forms: [...doc.querySelectorAll('form')].map(form => ({
        id: form.id, name: form.getAttribute('name') ?? '', action: cut(form.getAttribute('action') ?? '', 300),
        method: form.getAttribute('method') ?? '', target: form.getAttribute('target') ?? '',
        inputs: [...form.querySelectorAll<HTMLInputElement>('input[name], textarea[name], select[name]')].slice(0, 60).map(input => ({
          name: input.name, type: input.type,
          value: KEEP_VALUE.test(input.name) ? cut(input.value, 120) : `(${input.value.length}자)`,
        })),
      })).slice(0, 20),
      hiddenOutsideForms: [...doc.querySelectorAll<HTMLInputElement>('input[type="hidden"][name], input[type="hidden"][id]')]
        .filter(input => !input.form).slice(0, 60).map(input => ({
          name: input.name, id: input.id,
          value: KEEP_VALUE.test(input.name || input.id) || /^infodes/i.test(input.name || input.id) ? cut(input.value, 200) : `(${input.value.length}자)`,
        })),
      scripts: [...doc.querySelectorAll('script[src]')].map(node => cut(node.getAttribute('src'), 300)).slice(0, 60),
      inlineHints,
      ids: [...doc.querySelectorAll('[id]')].slice(0, 200).map(node => `${node.tagName.toLowerCase()}#${node.id}`),
      bodySelectors: ['#reportBody', '#div_report_body', '.reportBody', '#divBodyContent', '.doc_body', 'table.report_body',
        'canvas', '#hwpCtrl', '#HwpCtrl', '.webhwp-container', 'textarea[name="body"]']
        .filter(selector => doc.querySelector(selector)),
      canvasCount: doc.querySelectorAll('canvas').length,
      relatedRows,
      textLength: body?.textContent?.length ?? 0,
      textSample: cut(body?.textContent ?? '', 300),
    };
  };

  if (kind === 'frame') {
    // ★ 전역 객체의 속성은 읽지 않는다. 한글 웹기안기 컨트롤은 속성 접근만으로 경고창을 띄운다
    //   ("HwpDocuments Property는 지원할 수 없습니다"). 이름과 설명자 종류만 남긴다.
    const globals: Array<{ name: string; type: string }> = [];
    for (const name of Object.getOwnPropertyNames(window)) {
      if (globals.length >= 40) break;
      if (!/hwp|viewer|pdf|synap|editor|docview/i.test(name)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(window, name);
      globals.push({ name, type: !descriptor ? 'unknown' : 'value' in descriptor ? typeof descriptor.value : 'accessor' });
    }
    const resources = performance.getEntriesByType('resource').map(entry => {
      const item = entry as PerformanceResourceTiming;
      return { url: cut(item.name, 400), initiator: item.initiatorType, bytes: item.transferSize || item.encodedBodySize || 0 };
    }).filter(item => !/\.(?:png|gif|jpe?g|svg|ico|woff2?|ttf|css)(?:$|[?#])/i.test(item.url)).slice(-150);
    return {
      url: location.href, visibility: document.visibilityState, readyState: document.readyState,
      globals, resources, dom: summarize(document),
    };
  }

  // fetch: 기안기와 같은 출처에서 원문 조회 주소를 직접 요청해 응답 구조를 본다.
  const requests: Array<{ method: 'GET' | 'POST'; url: string; body?: URLSearchParams; depth: number }> = [];
  if (open) {
    requests.push(open.method === 'POST'
      ? { method: 'POST', url: open.url, body: new URLSearchParams(open.fields), depth: 0 }
      : { method: 'GET', url: open.url, depth: 0 });
  }
  if (docUrl) {
    try { requests.push({ method: 'GET', url: new URL(docUrl, location.href).href, depth: 0 }); } catch { /* 잘못된 주소 */ }
  }
  if (docId && /^ENF/i.test(docId)) {
    requests.push({
      method: 'POST', url: new URL('/bms/dctenf/BmsDctEnfReceiptCardDetail.do', location.origin).href,
      body: new URLSearchParams({ enfdocid: docId, paperdocflag: 'N', popupflag: 'Y' }), depth: 0,
    });
  } else if (docId) {
    const view = new URL('/bms/dct/viewreport.do', location.origin).href;
    requests.push({ method: 'POST', url: view, body: new URLSearchParams({ docid: docId }), depth: 0 });
    requests.push({ method: 'GET', url: `${view}?${new URLSearchParams({ docid: docId })}`, depth: 0 });
  }
  const results: unknown[] = [];
  const seen = new Set<string>();
  while (requests.length && results.length < 8) {
    const request = requests.shift()!;
    const key = `${request.method} ${request.url} ${request.body ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let url: URL;
    try { url = new URL(request.url); } catch { continue; }
    if (url.origin !== location.origin || MUTATION.test(url.pathname)) {
      results.push({ request: { method: request.method, url: cut(request.url, 400) }, skipped: '다른 출처 또는 변경 동작 주소' });
      continue;
    }
    try {
      const response = await fetch(url.href, {
        method: request.method, credentials: 'same-origin', cache: 'no-store', redirect: 'manual',
        signal: AbortSignal.timeout(10_000), ...(request.body ? { body: request.body } : {}),
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') ?? '';
      const head = new TextDecoder().decode(bytes.subarray(0, 4096));
      const charset = contentType.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1] ?? head.match(/charset\s*=\s*["']?([^\s"'/>;]+)/i)?.[1];
      const isHtml = /html|xml/i.test(contentType) || /^\s*</.test(head);
      const entry: Record<string, unknown> = {
        request: { method: request.method, url: cut(request.url, 400), fields: request.body ? [...request.body.keys()] : [] },
        status: response.status, type: response.type, redirected: response.redirected, finalUrl: cut(response.url, 400),
        location: response.headers.get('location') ?? '', contentType, contentDisposition: response.headers.get('content-disposition') ?? '',
        bytes: bytes.length, magic: [...bytes.subarray(0, 8)].map(b => b.toString(16).padStart(2, '0')).join(' '),
      };
      if (isHtml) {
        let html: string;
        try { html = new TextDecoder(charset || 'utf-8').decode(bytes); } catch { html = new TextDecoder().decode(bytes); }
        const doc = new DOMParser().parseFromString(html, 'text/html');
        entry.dom = summarize(doc);
        if (request.depth < 2) {
          for (const node of doc.querySelectorAll('iframe[src], frame[src]')) {
            const src = node.getAttribute('src');
            if (!src || /^(?:about|javascript):/i.test(src)) continue;
            try { requests.push({ method: 'GET', url: new URL(src, url).href, depth: request.depth + 1 }); } catch { /* 잘못된 주소 */ }
          }
        }
      }
      results.push(entry);
    } catch (error) {
      results.push({ request: { method: request.method, url: cut(request.url, 400) }, error: String(error) });
    }
  }
  return results;
}
