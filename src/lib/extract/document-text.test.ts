// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { collectDocumentText } from './document-text';

it('문서 상세의 같은 출처 하위 iframe 본문과 읽기 전용 입력칸 본문까지 모은다', () => {
  document.body.innerHTML = `<h1>안전한 어린이제품 사용환경 조성을 위한 협조 요청</h1><button>인쇄</button>
    <iframe id="body"></iframe><textarea readonly>의견: 관련 부서는 붙임 자료를 검토하여 회신하여 주시기 바랍니다.</textarea>`;
  const frame = document.getElementById('body') as HTMLIFrameElement;
  frame.contentDocument!.body.innerHTML = '<p>1. 관련: 산업통상자원부 제품안전정책과-1234</p><p>2. 어린이제품 안전관리 강화를 위하여 다음과 같이 협조를 요청합니다.</p>';
  const text = collectDocumentText();
  expect(text).toContain('협조 요청');
  expect(text).toContain('어린이제품 안전관리 강화를 위하여');
  expect(text).toContain('붙임 자료를 검토하여 회신');
});
