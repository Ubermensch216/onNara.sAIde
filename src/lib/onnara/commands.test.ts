import { expect, it } from 'vitest';
import { DOCUMENT_COMMANDS, commandTargets, defaultInstruction, findDocumentCommand } from './commands';

const list = (selectedTitles: string[]) => ({
  kind: 'onnara-document-list' as const,
  listName: '받은문서',
  columns: [],
  rows: [{ title: '문서 A' }, { title: '문서 B' }, { title: '문서 C' }],
  selectedTitles,
});

it('이름과 별칭은 서로 겹치지 않고, 모두 그 명령의 접두 문자로 시작한다', () => {
  const names = DOCUMENT_COMMANDS.flatMap(command => [command.slash, ...command.aliases]);
  expect(new Set(names).size).toBe(names.length);
  for (const command of DOCUMENT_COMMANDS) {
    for (const name of [command.slash, ...command.aliases]) {
      expect(name.startsWith(command.prefix)).toBe(true);
    }
  }
});

it('★ 결과가 다른 탭에 쌓이는 명령만 `@`다', () => {
  // `/`는 답이 AI 창에 남는 명령, `@`는 주화면이 다른 탭인 명령이다. 이 구분이 흐려지면
  // 사용자는 실행할 때마다 결과를 어디서 볼지 추측해야 한다.
  const at = DOCUMENT_COMMANDS.filter(command => command.prefix === '@');
  expect(at.map(command => command.id)).toEqual(['attachments']);
  expect(at.every(command => command.opensTab)).toBe(true);
  expect(DOCUMENT_COMMANDS.filter(command => command.prefix === '/').every(command => !command.opensTab)).toBe(true);
});

it('명령 대상은 체크한 문서이고, "전체"를 붙였을 때만 화면 전체다', () => {
  expect(commandTargets(list(['문서 B']))).toEqual(['문서 B']);
  expect(commandTargets(list([]))).toEqual([]);
  expect(commandTargets(list(['문서 B']), '전체')).toEqual(['문서 A', '문서 B', '문서 C']);
  expect(commandTargets(list([]), '모든 문서')).toEqual(['문서 A', '문서 B', '문서 C']);
  // 추가 지시는 대상이 아니라 지시다. "전체"가 없으면 체크한 문서만 다룬다.
  expect(commandTargets(list(['문서 B']), '기한 위주로 정리해줘')).toEqual(['문서 B']);
});

it('추가 지시가 없을 때만 기본 지시를 쓴다', () => {
  expect(defaultInstruction('summary')).toContain('요약');
  expect(defaultInstruction('compare')).toContain('공통점');
  // 모델을 부르지 않는 명령은 지시문이 없다.
  expect(defaultInstruction('attachments')).toBe('');
  expect(defaultInstruction('refresh')).toBe('');
});

it('모델 없이 동작하는 명령을 구분해 둔다 (Ollama가 꺼져 있어도 쓸 수 있다)', () => {
  const offline = DOCUMENT_COMMANDS.filter(command => !command.usesModel).map(command => command.id);
  expect(offline).toEqual(['read', 'attachments', 'refresh']);
  expect(findDocumentCommand('summary')?.slash).toBe('/요약');
  expect(findDocumentCommand('attachments')?.slash).toBe('@첨부');
});
