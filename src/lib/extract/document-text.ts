/**
 * 문서 상세 화면의 본문 텍스트를 모은다.
 *
 * ★ Readability를 쓰지 않는다. 공문 본문은 표 레이아웃으로 그려지는 경우가 많아
 *   리더 모드가 본문을 버리고 제목·버튼만 남기는 일이 생긴다. 화면에 보이는
 *   텍스트를 빠짐없이 모으고, 요약은 LLM이 직접 판단하게 한다.
 *
 * ★ 온나라 상세 화면은 제목·결재정보를 담은 바깥 프레임 안에 본문 iframe을
 *   다시 두는 구조가 흔하다. 같은 출처(about:blank·srcdoc 포함) 하위 프레임은
 *   여기서 직접 읽는다. 다른 출처 프레임은 서비스 워커가 따로 읽어 합친다.
 */
const MAX_FRAME_DEPTH = 4;

export function collectDocumentText(doc: Document = document, depth = 0): string {
  const parts = [visibleText(doc)];
  if (depth < MAX_FRAME_DEPTH) {
    for (const frame of doc.querySelectorAll<HTMLIFrameElement | HTMLFrameElement>('iframe, frame')) {
      let child: Document | null = null;
      try {
        child = frame.contentDocument;
      } catch {
        child = null;
      }
      if (child?.body) parts.push(collectDocumentText(child, depth + 1));
    }
  }
  return parts.map(part => part.trim()).filter(Boolean).join('\n\n');
}

function visibleText(doc: Document): string {
  const body = doc.body;
  if (!body || body.tagName === 'FRAMESET') return '';
  // jsdom 등 innerText를 구현하지 않은 환경에서는 textContent로 대신한다.
  const text = typeof body.innerText === 'string' ? body.innerText : body.textContent ?? '';
  // 읽기 전용 편집기에 본문을 넣어 두는 화면이 있다. innerText에는 값이 들어가지 않는다.
  const fields = [...doc.querySelectorAll<HTMLTextAreaElement>('textarea')]
    .map(field => field.value.trim())
    .filter(value => value.length >= 20 && !text.includes(value));
  return [text, ...fields].join('\n\n');
}
