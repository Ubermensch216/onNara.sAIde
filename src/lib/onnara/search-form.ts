/**
 * 온나라 목록(문서등록대장 등) 검색 폼에 조건을 채운다.
 *
 * ★ 원칙: 조건만 채우고 [검색/조회] 버튼은 자동으로 누르지 않는다.
 *   기관마다 검색 버튼의 스크립트와 필수 조건이 다르므로, 사용자가 눈으로 확인하고
 *   직접 조회 버튼을 누르게 안내한다.
 */

export interface DocumentSearchCriteria {
  authorName?: string;
  department?: string;
  startDate?: string;
  endDate?: string;
  keyword?: string;
  taskCard?: string;
  docType?: string;
}

export interface SearchFormFillResult {
  filled: Array<keyof DocumentSearchCriteria>;
  missing: Array<keyof DocumentSearchCriteria>;
  message: string;
}

type FieldControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function normalizeLabel(text: string | null | undefined): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/[\s()（）/·:：*~〜\-_]/g, '')
    .trim();
}

function isEditableInput(el: Element): el is FieldControl {
  if ((el as HTMLElement).hidden || el.getAttribute('aria-hidden') === 'true') return false;
  if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    return !el.disabled;
  }
  if (el instanceof HTMLInputElement) {
    const type = (el.type || 'text').toLowerCase();
    if (['hidden', 'button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image'].includes(type)) {
      return false;
    }
    return !el.disabled && !el.readOnly;
  }
  return false;
}

function labelForControl(control: FieldControl, root: ParentNode): string {
  const parts: string[] = [];
  if (control.id) {
    const explicit = root.querySelector(`label[for="${CSS.escape(control.id)}"]`);
    if (explicit?.textContent) parts.push(explicit.textContent);
  }
  const wrappingLabel = control.closest('label');
  if (wrappingLabel?.textContent) parts.push(wrappingLabel.textContent);

  const cell = control.closest('td, dd, .search-item, .form-group, li, div');
  if (cell) {
    const prev = cell.previousElementSibling;
    if (prev && /^(TH|DT|LABEL|SPAN|STRONG)$/i.test(prev.tagName) && prev.textContent) {
      parts.push(prev.textContent);
    }
    const inlineLabel = cell.querySelector('label, th, dt, .label, .tit');
    if (inlineLabel && !inlineLabel.contains(control) && inlineLabel.textContent) {
      parts.push(inlineLabel.textContent);
    }
  }
  const row = control.closest('tr');
  if (row) {
    const th = row.querySelector('th');
    if (th?.textContent) parts.push(th.textContent);
  }

  for (const attr of ['aria-label', 'title', 'placeholder', 'name', 'id']) {
    const val = control.getAttribute(attr);
    if (val) parts.push(val);
  }
  return normalizeLabel(parts.join(' '));
}

function setControlValue(control: FieldControl, value: string): boolean {
  const view = control.ownerDocument.defaultView;
  const EventCtor = view?.Event ?? Event;
  if (control instanceof HTMLSelectElement) {
    const normWanted = normalizeLabel(value);
    const option = [...control.options].find(
      opt => normalizeLabel(opt.value) === normWanted || normalizeLabel(opt.text) === normWanted || normalizeLabel(opt.text).includes(normWanted),
    );
    if (!option) return false;
    control.value = option.value;
  } else {
    control.value = value;
  }
  control.dispatchEvent(new EventCtor('input', { bubbles: true }));
  control.dispatchEvent(new EventCtor('change', { bubbles: true }));
  return true;
}

const FIELD_PATTERNS: Record<Exclude<keyof DocumentSearchCriteria, 'startDate' | 'endDate'>, string[]> = {
  authorName: ['기안자', '담당자', '보고자', '접수자', '작성자', '기안자명', '담당자명', 'drafter', 'author', 'reporter'],
  department: ['기안부서', '담당부서', '처리부서', '부서명', '부서', 'dept', 'department'],
  keyword: ['문서제목', '제목', '검색어', '키워드', 'title', 'searchkeyword', 'searchwrd'],
  taskCard: ['단위과제명', '단위과제', '과제카드', '기록물철', 'taskcard'],
  docType: ['생산접수', '문서구분', '등록구분', '구분', 'doctype'],
};

const START_DATE_PATTERNS = ['시작일', '검색시작일', '조회시작일', '부터', 'startdate', 'searchfrom', 'bgnde', 'fromdate', 'sdate'];
const END_DATE_PATTERNS = ['종료일', '검색종료일', '조회종료일', '까지', 'enddate', 'searchto', 'endde', 'todate', 'edate'];
const PERIOD_PATTERNS = ['기간', '등록일자', '보고일자', '시행일자', '접수일자', '일자', 'date', 'period'];

export function fillDocumentSearchForm(
  criteria: DocumentSearchCriteria,
  root: ParentNode = document,
): SearchFormFillResult {
  const controls = [...root.querySelectorAll('input, select, textarea')].filter(isEditableInput);
  const labeled = controls.map(control => ({ control, label: labelForControl(control, root) }));
  const used = new Set<FieldControl>();
  const filled: Array<keyof DocumentSearchCriteria> = [];
  const missing: Array<keyof DocumentSearchCriteria> = [];

  const fillOne = (key: keyof DocumentSearchCriteria, value: string | undefined, patterns: string[]): boolean => {
    const trimmed = (value ?? '').trim();
    if (!trimmed) return false;
    const normalizedPatterns = patterns.map(normalizeLabel);
    const found = labeled.find(
      item => !used.has(item.control) && normalizedPatterns.some(pat => item.label.includes(pat)),
    );
    if (found && setControlValue(found.control, trimmed)) {
      used.add(found.control);
      filled.push(key);
      return true;
    }
    return false;
  };

  // 1. 일반 텍스트·선택 필드
  (Object.keys(FIELD_PATTERNS) as Array<keyof typeof FIELD_PATTERNS>).forEach(key => {
    const val = criteria[key];
    if (!val || !val.trim()) return;
    if (!fillOne(key, val, FIELD_PATTERNS[key])) {
      missing.push(key);
    }
  });

  // 2. 시작일 / 종료일 (전용 라벨 우선 → 기간 행의 첫 번째/두 번째 입력칸 폴백)
  const periodControls = labeled
    .filter(item => !used.has(item.control) && !(item.control instanceof HTMLSelectElement) && PERIOD_PATTERNS.some(p => item.label.includes(normalizeLabel(p))))
    .map(item => item.control);

  if (criteria.startDate?.trim()) {
    if (!fillOne('startDate', criteria.startDate, START_DATE_PATTERNS)) {
      const firstPeriod = periodControls.find(c => !used.has(c));
      if (firstPeriod && setControlValue(firstPeriod, criteria.startDate.trim())) {
        used.add(firstPeriod);
        filled.push('startDate');
      } else {
        missing.push('startDate');
      }
    }
  }

  if (criteria.endDate?.trim()) {
    if (!fillOne('endDate', criteria.endDate, END_DATE_PATTERNS)) {
      const nextPeriod = periodControls.find(c => !used.has(c));
      if (nextPeriod && setControlValue(nextPeriod, criteria.endDate.trim())) {
        used.add(nextPeriod);
        filled.push('endDate');
      } else {
        missing.push('endDate');
      }
    }
  }

  const message = filled.length > 0
    ? '검색 조건을 채웠습니다. 온나라 화면에서 [검색/조회] 버튼을 누른 뒤 내보내기를 시작하세요.'
    : '현재 화면에서 일치하는 검색 입력칸을 찾지 못했습니다. 온나라 검색 영역이 열려 있는지 확인하세요.';

  return { filled, missing, message };
}
