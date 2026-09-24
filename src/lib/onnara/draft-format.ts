/**
 * 공문서 서식 보존, HTML 변환 및 클립보드/에디터 안전 주입 유틸리티.
 *
 * LLM이 생성한 공문서 초안의 문단 구분(\n, \r\n), 개조식 글머리표, 들여쓰기 공백을
 * 온나라 WebHWP(한글 기안기), 웹 contenteditable 에디터, 일반 입력창 및 클립보드에
 * 서식 손실 없이 완벽하게 보존하여 전달합니다.
 */

import { cleanAdminDraft } from './draft-cleaner';

/**
 * 공문서 텍스트를 웹 에디터 및 한컴 기안기 HTML 붙여넣기에 최적화된 HTML 문자열로 변환합니다.
 * 들여쓰기(공백)는 &nbsp;로 변환하고, 빈 줄은 높이를 가진 빈 문단으로 보존하며, 각 행을 개별 문단(<p>)으로 래핑합니다.
 */
export function draftToHtml(text: string): string {
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  return lines
    .map(line => {
      if (!line.trim()) {
        return '<p style="margin: 0; min-height: 1.2em;">&nbsp;</p>';
      }
      const leadingSpacesMatch = line.match(/^(\s+)/);
      const leadingSpacesCount = leadingSpacesMatch && leadingSpacesMatch[1] ? leadingSpacesMatch[1].length : 0;
      const content = line.slice(leadingSpacesCount);
      const escapedContent = content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      const prefix = leadingSpacesCount > 0 ? '&nbsp;'.repeat(leadingSpacesCount) : '';
      return `<p style="margin: 0 0 4px 0; line-height: 1.6; font-family: 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 11pt;">${prefix}${escapedContent}</p>`;
    })
    .join('\n');
}

/**
 * contenteditable 에디터 Range 삽입용 DocumentFragment 생성.
 * CSS white-space 설정에 구애받지 않고 줄바꿈을 100% 보존합니다.
 */
export function createDomFragmentFromText(doc: Document, text: string): DocumentFragment {
  const frag = doc.createDocumentFragment();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (i > 0) {
      frag.appendChild(doc.createElement('br'));
    }
    if (line.length > 0) {
      frag.appendChild(doc.createTextNode(line));
    }
  }
  return frag;
}

/**
 * 텍스트와 서식 있는 HTML을 클립보드에 동시 복사하여 일반 메모장부터 한컴, 워드, 웹 에디터까지 서식을 완벽하게 보존합니다.
 */
export async function copyDraftToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  const clean = cleanAdminDraft(text);
  const html = draftToHtml(clean);

  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const plainBlob = new Blob([clean], { type: 'text/plain' });
      const htmlBlob = new Blob([html], { type: 'text/html' });
      const item = new ClipboardItem({
        'text/plain': plainBlob,
        'text/html': htmlBlob,
      });
      await navigator.clipboard.write([item]);
      return true;
    }
  } catch {
    // ClipboardItem 생성이나 write 권한 실패 시 fallback
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(clean);
      return true;
    }
  } catch {
    // ignore
  }

  return false;
}

/**
 * 한컴 WebHWP / HwpCtrl 컨트롤에 다중 행(줄바꿈 및 들여쓰기)을 완벽하게 보존하여 삽입합니다.
 * HwpCtrl.InsertText의 제어문자(\n) 누락 한계를 극복하기 위해 행 단위 InsertText와 문단나누기(BreakPara) 액션을 결합합니다.
 */
export function insertMultilineIntoHwp(hwp: any, text: string): boolean {
  if (!hwp) return false;

  // 동일 컨트롤에 대한 1.5초 내 중복 삽입 방지 (allFrames 다중 실행 방탄 가드)
  const now = Date.now();
  if (hwp.__saide_last_inserted && now - hwp.__saide_last_inserted < 1500) {
    return true;
  }
  hwp.__saide_last_inserted = now;

  const lines = text.split(/\r?\n/);

  // 단일 행인 경우 단순 삽입
  if (lines.length <= 1) {
    if (typeof hwp.InsertText === 'function') {
      hwp.InsertText(text);
      return true;
    }
    if (typeof hwp.CreateAction === 'function') {
      const act = hwp.CreateAction('InsertText');
      if (act && typeof act.CreateSet === 'function') {
        const set = act.CreateSet();
        if (set && typeof set.SetItem === 'function') {
          set.SetItem('Text', text);
          act.Execute(set);
          return true;
        }
      }
    }
    if (typeof hwp.Run === 'function') {
      hwp.Run('Paste');
      return true;
    }
    return false;
  }

  // 다중 행인 경우: 행별 텍스트 삽입 + 행 간 BreakPara(엔터) 실행
  let anySuccess = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.length > 0) {
      if (typeof hwp.InsertText === 'function') {
        hwp.InsertText(line);
        anySuccess = true;
      } else if (typeof hwp.CreateAction === 'function') {
        const act = hwp.CreateAction('InsertText');
        if (act && typeof act.CreateSet === 'function') {
          const set = act.CreateSet();
          if (set && typeof set.SetItem === 'function') {
            set.SetItem('Text', line);
            act.Execute(set);
            anySuccess = true;
          }
        }
      }
    }
    // 마지막 줄이 아니면 문단 나누기(BreakPara) 실행
    if (i < lines.length - 1) {
      if (typeof hwp.Run === 'function') {
        hwp.Run('BreakPara');
        anySuccess = true;
      } else if (hwp.HAction && typeof hwp.HAction.Run === 'function') {
        hwp.HAction.Run('BreakPara');
        anySuccess = true;
      }
    }
  }

  return anySuccess;
}
