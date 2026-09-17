import { findDocumentOpenTarget } from './document-list';

/** 복제 탭의 메모리 상태에 의존하지 않고 실제 목록 요청을 복원한다. */
export interface DocumentListLocation {
  url: string;
  framePath: number[];
  frameName?: string;
  form?: { method: 'get' | 'post'; fields: Array<[string, string]> };
}

function framePath(view: Window): number[] {
  const path: number[] = [];
  let current = view;
  while (current !== current.top) {
    const parent = current.parent;
    let index = 0;
    while (index < parent.length && parent.frames[index] !== current) index++;
    if (index === parent.length) throw new Error('문서 목록 프레임 위치를 확인할 수 없습니다.');
    path.unshift(index);
    current = parent;
  }
  return path;
}

function collectFields(form: HTMLFormElement): Array<[string, string]> {
  const fields: Array<[string, string]> = [];
  for (const input of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')) {
    if (!input.name || input.matches(':disabled') || input.closest('tr, [role="row"]')?.querySelector('input[name="chkDocTitle"], input[name="chkDocId"]')) continue;
    if (input instanceof HTMLInputElement) {
      if (['button', 'submit', 'reset', 'image', 'file', 'password'].includes(input.type)) continue;
      if (['checkbox', 'radio'].includes(input.type) && !input.checked) continue;
    }
    if (input instanceof HTMLSelectElement) {
      for (const option of input.selectedOptions) if (!option.disabled) fields.push([input.name, option.value]);
    } else fields.push([input.name, input.value]);
  }
  return fields;
}

export function captureDocumentListLocation(title: string, doc = document): DocumentListLocation | null {
  const target = findDocumentOpenTarget(title, doc);
  const view = doc.defaultView;
  if (!target || !view) return null;
  const location: DocumentListLocation = { url: view.location.href, framePath: framePath(view) };
  if (location.framePath.length && view.name) location.frameName = view.name;

  const current = new URL(location.url);
  const targetForm = target.closest('form');
  let selectedForm: HTMLFormElement | null = null;

  if (targetForm) {
    const rawAction = targetForm.getAttribute('action');
    const action = new URL(rawAction || location.url, location.url);
    if (action.origin === current.origin && action.pathname === current.pathname) {
      selectedForm = targetForm;
    }
  }

  if (!selectedForm) {
    for (const f of doc.forms) {
      const rawAction = f.getAttribute('action');
      const action = new URL(rawAction || location.url, location.url);
      if (action.origin === current.origin && action.pathname === current.pathname) {
        selectedForm = f;
        break;
      }
    }
  }

  if (!selectedForm) return location;
  const method = (selectedForm.getAttribute('method') || 'get').toLowerCase();
  if (method !== 'get' && method !== 'post') return location;

  const fieldsMap = new Map<string, string>();
  const searchForm = doc.querySelector<HTMLFormElement>('form[name*="search" i], form[id*="search" i]');
  if (searchForm && searchForm !== selectedForm) {
    const sAction = new URL(searchForm.getAttribute('action') || location.url, location.url);
    if (sAction.origin === current.origin && sAction.pathname === current.pathname) {
      for (const [k, v] of collectFields(searchForm)) fieldsMap.set(k, v);
    }
  }
  for (const [k, v] of collectFields(selectedForm)) fieldsMap.set(k, v);

  location.form = { method, fields: [...fieldsMap.entries()] };
  return location;
}

/** 대상 iframe의 부모만 복원한다. 원본 탭에는 이 요청을 보내지 않는다. */
export function restoreDocumentListLocation(location: DocumentListLocation, doc = document): boolean {
  const view = doc.defaultView;
  if (!view || !/^https?:$/.test(new URL(location.url).protocol)) return false;
  const parentPath = location.framePath.slice(0, -1);
  if (JSON.stringify(framePath(view)) !== JSON.stringify(parentPath)) return false;
  let targetName = '_self';
  let frame: HTMLIFrameElement | HTMLFrameElement | undefined;
  if (location.framePath.length) {
    const target = view.frames[location.framePath[location.framePath.length - 1]!];
    frame = [...doc.querySelectorAll<HTMLIFrameElement | HTMLFrameElement>('iframe, frame')]
      .find(element => location.frameName ? element.name === location.frameName : element.contentWindow === target);
    if (!frame) return false;
    targetName = frame.name || `saide-list-${crypto.randomUUID()}`;
    frame.name = targetName;
  }
  if (!location.form) {
    if (frame) frame.src = location.url;
    else view.location.assign(location.url);
    return true;
  }
  const form = doc.createElement('form');
  form.hidden = true;
  form.method = location.form.method;
  form.action = location.url;
  form.target = targetName;
  const fields = [...location.form.fields];
  if (location.form.method === 'get') {
    const names = new Set(fields.map(([name]) => name));
    for (const [name, value] of new URL(location.url).searchParams) if (!names.has(name)) fields.push([name, value]);
  }
  for (const [name, value] of fields) {
    const input = doc.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.append(input);
  }
  doc.documentElement.append(form);
  try { HTMLFormElement.prototype.submit.call(form); }
  finally { form.remove(); }
  return true;
}
