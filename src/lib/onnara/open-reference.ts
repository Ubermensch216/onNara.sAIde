/** executeScript(MAIN)에 그대로 넘기므로 외부 변수·import에 의존하지 않는 읽기 전용 함수. */
export async function readOpenReferenceFrame(): Promise<{ text: string; title: string; id: string; bodyOnly?: boolean } | null> {
  const field = (names: string[]) => {
    for (const name of names) {
      const node = document.querySelector<HTMLElement>(`input[name="${name}"], textarea[name="${name}"], #${name}`);
      const value = node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ? node.value : node?.textContent;
      if (value?.trim()) return value.trim();
    }
    return '';
  };
  const titleLabel = [...document.querySelectorAll('th, td')].find(node => /^제\s*목\s*[:：]?$/.test(node.textContent?.trim() ?? ''));
  const title = field(['doctitle', 'docTitle', 'reportTitle', 'reporttitle']) || titleLabel?.nextElementSibling?.textContent?.trim() || '';
  const id = field(['docid', 'docId', 'documentId', 'reportId']) || new URL(location.href).searchParams.get('docid') || new URL(location.href).searchParams.get('docId') || '';
  const w = window as unknown as Record<string, any>;
  const controls = [...new Set([w.HwpCtrl, w.pHwpCtrl, w.vHwpCtrl, w.hwpCtrl, w.WebHwpCtrl,
    document.getElementById('HwpCtrl'), document.getElementById('hwpCtrl')].filter(Boolean))];
  for (const h of controls) {
    if (typeof h.GetTextFile === 'function') {
      const text = await new Promise<string>(resolve => {
        let done = false;
        const finish = (value: any) => {
          if (done) return;
          done = true; clearTimeout(timer);
          const text = typeof value === 'string' ? value : value?.data ?? value?.result ?? value?.text;
          resolve(typeof text === 'string' ? text.trim() : '');
        };
        const timer = setTimeout(() => finish(''), 1800);
        try {
          const value = h.GetTextFile('TEXT', '', finish);
          if (typeof value === 'string') finish(value);
          else if (value?.then) value.then(finish).catch(() => finish(''));
        } catch { finish(''); }
      });
      if (text.length >= 20) return { text, title, id };
    }
    if (typeof h.GetFieldText === 'function') {
      try {
        const text = h.GetFieldText('본문');
        if (typeof text === 'string' && text.trim().length >= 20) return { text: text.trim(), title, id, bodyOnly: true };
      } catch { /* 다른 읽기 방식 시도 */ }
    }
  }
  // 문서관리카드 전체/결재정보/관련정보는 본문으로 취급하지 않는다.
  const body = document.querySelector<HTMLElement>('#reportBody, #div_report_body, .reportBody, #divBodyContent, .doc_body, table.report_body, textarea[name="body"], textarea[name="docBody"]');
  if (!body) return title || id ? { text: '', title, id } : null;
  let text: string;
  if (body instanceof HTMLTextAreaElement) text = body.value;
  else {
    const clone = body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('script, style, button, input, select, iframe, object, embed, [hidden]').forEach(node => node.remove());
    clone.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
    clone.querySelectorAll('td, th').forEach(node => node.append(' '));
    clone.querySelectorAll('p, div, tr, li').forEach(node => node.append('\n'));
    text = clone.textContent || '';
  }
  return text.trim().length >= 20 ? { text: text.trim(), title, id, bodyOnly: true } : null;
}
