import { expect, it } from 'vitest';
import {
  classifyOnnaraPage,
  compareRunContext,
  configuredOnnaraOrigins,
  createDocumentKey,
  createRunContext,
  isConfiguredOnnaraUrl,
  type OnnaraSnapshot,
} from './context';
import { selectOnnaraAdapter, type OnnaraAdapter } from './adapter';

const snapshot = (overrides: Partial<OnnaraSnapshot> = {}): OnnaraSnapshot => ({
  tabId: 7,
  frameId: 0,
  url: 'https://onnara.example.go.kr/main?menu=1',
  title: '온나라',
  capturedAt: 1_800_000_000_000,
  signals: { documentView: true, sourceDocumentId: 'DOC-2026-001' },
  ...overrides,
});

it('명시적으로 배포된 origin만 온나라 실행 환경으로 인정한다', () => {
  const origins = configuredOnnaraOrigins('https://ONNARA.example.go.kr/path, invalid,https://other.go.kr');
  expect(origins).toEqual(['https://onnara.example.go.kr', 'https://other.go.kr']);
  expect(isConfiguredOnnaraUrl(snapshot().url, origins)).toBe(true);
  expect(isConfiguredOnnaraUrl('https://onnara.example.go.kr.evil.test/', origins)).toBe(false);
});

it('URL 이름이 아니라 수집된 DOM 신호로 화면을 분류한다', () => {
  expect(classifyOnnaraPage({ distributionForm: true, documentView: true })).toBe('distribution');
  expect(classifyOnnaraPage({ draftEditor: true })).toBe('draft-editor');
  expect(classifyOnnaraPage({})).toBe('unknown');
});

it('문서 키는 원천 문서 ID 또는 관리번호와 생산일자 조합으로만 만든다', () => {
  expect(createDocumentKey({ sourceDocumentId: 'DOC-1' })).toMatchObject({ value: 'DOC-1', basis: 'source-document-id' });
  expect(createDocumentKey({ managementNumber: '행정-42', createdDate: '2026-09-17' })).toMatchObject({ value: '행정-42@2026-09-17' });
  expect(createDocumentKey({ managementNumber: '행정-42' })).toBeNull();
});

it('실행 직전에 탭·프레임·URL·문서 동일성을 다시 확인한다', () => {
  const expected = createRunContext(snapshot(), ['https://onnara.example.go.kr']);
  const changed = createRunContext(snapshot({ signals: { documentView: true, sourceDocumentId: 'DOC-2' } }), ['https://onnara.example.go.kr']);
  expect(expected).not.toBeNull();
  expect(changed).not.toBeNull();
  expect(compareRunContext(expected!, changed!)).toEqual({ ok: false, reason: 'document-changed' });
});

it('여러 화면 어댑터 중 우선순위가 높은 어댑터를 안정적으로 선택한다', () => {
  const adapter = (id: string, priority: number): OnnaraAdapter<string> => ({ id, priority, matches: () => true, extract: async () => id });
  expect(selectOnnaraAdapter(snapshot(), [adapter('generic', 1), adapter('document-v2', 10)])?.id).toBe('document-v2');
});
