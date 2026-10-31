/**
 * 다운로드 이름 예약 (B5).
 *
 * ★ 여기서 지키는 것 둘.
 *   ① 예약은 **한 번만** 쓰인다. 남아 있으면 그다음에 사용자가 직접 내려받은 파일까지 개명된다.
 *   ② 시간이 지나면 스스로 만료된다. 첨부를 눌렀는데 다운로드가 시작되지 않은 경우를 위해서다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDownloadName, consumeDownloadName, holdDownloadName, registerDownloadNaming, reserveDownloadName } from './rename';

beforeEach(() => {
  vi.useRealTimers();
  clearDownloadName();
});

describe('예약 소비', () => {
  it('예약이 없으면 브라우저가 정한 이름을 그대로 둔다', () => {
    expect(consumeDownloadName('붙임1.hwp')).toBeNull();
  });

  it('예약이 있으면 정규화한 이름을 준다', () => {
    reserveDownloadName('붙임1.hwp', { docTitle: '예산 편성 지침', reportDate: '2026-09-30' });
    expect(consumeDownloadName('붙임1.hwp')).toBe('20260930_예산 편성 지침_붙임1.hwp');
  });

  // ★ 이게 깨지면 사용자가 직접 받은 파일까지 공문 이름으로 바뀐다.
  it('★ 한 번 쓰면 사라진다', () => {
    reserveDownloadName('붙임1.hwp', { docTitle: '예산 편성 지침' });
    consumeDownloadName('붙임1.hwp');
    expect(consumeDownloadName('내 파일.pdf')).toBeNull();
  });

  it('브라우저가 준 이름의 확장자를 따른다', () => {
    reserveDownloadName('붙임1', { docTitle: '예산 편성 지침' });
    expect(consumeDownloadName('실제이름.pdf')).toBe('예산 편성 지침_실제이름.pdf');
  });

  it('브라우저가 이름을 주지 않으면 화면에서 읽은 이름을 쓴다', () => {
    reserveDownloadName('붙임1.hwp', { docTitle: '예산 편성 지침' });
    expect(consumeDownloadName('')).toBe('예산 편성 지침_붙임1.hwp');
  });

  it('예약을 지우면 개명하지 않는다', () => {
    reserveDownloadName('붙임1.hwp', { docTitle: '예산 편성 지침' });
    clearDownloadName();
    expect(consumeDownloadName('붙임1.hwp')).toBeNull();
  });

  it('계획이 없으면 예약 자체가 서지 않는다', () => {
    reserveDownloadName('붙임1.hwp', null);
    expect(consumeDownloadName('붙임1.hwp')).toBeNull();
  });

  // ★ 첨부를 눌렀는데 다운로드가 시작되지 않은 채 사용자가 다른 파일을 받는 경우.
  it('★ 시간이 지난 예약은 쓰지 않는다', () => {
    vi.useFakeTimers();
    reserveDownloadName('붙임1.hwp', { docTitle: '예산 편성 지침' }, 1_000);
    vi.advanceTimersByTime(1_500);
    expect(consumeDownloadName('붙임1.hwp')).toBeNull();
  });

  it('★ 눈치코치 꾸러미(rename: false)에서 브라우저가 data URL 기본 이름(다운로드.pdf)을 제안해도 공문 본문 제목을 파일명으로 쓴다', () => {
    const docTitle = '2026년도 공직유관단체 채용실태 전수조사 계획 송부';
    reserveDownloadName(
      `${docTitle}.pdf`,
      { docTitle, reportDate: '2026. 10. 31.', folder: true, rename: false, root: 'onNara.sAIde/수집/20261031_143700_1234' },
      { preferFallback: true },
    );
    expect(consumeDownloadName('다운로드.pdf')).toBe(
      `onNara.sAIde/수집/20261031_143700_1234/20261031_${docTitle}/${docTitle}.pdf`,
    );
  });

  it('preferFallback이 켜져 있으면 서블릿 기본 이름(Document.pdf 등) 대신 예약한 공문 본문 제목을 파일명으로 쓴다', () => {
    const docTitle = '2026년도 공직유관단체 채용실태 전수조사 계획 송부';
    reserveDownloadName(`${docTitle}.pdf`, { docTitle, rename: false }, { preferFallback: true });
    expect(consumeDownloadName('Document.pdf')).toBe(`${docTitle}.pdf`);
  });

  it('브라우저가 임시 기본 이름(download.pdf, 다운로드 (1).pdf)을 줄 때는 fallbackName과 제안된 확장자를 결합한다', () => {
    reserveDownloadName('붙임1', { docTitle: '예산 편성 지침', rename: false });
    expect(consumeDownloadName('다운로드 (1).pdf')).toBe('붙임1.pdf');
  });
});

describe('확장 페이지의 blob 다운로드 (꾸러미 package.json)', () => {
  type Listener = (item: { url?: string; filename?: string; byExtensionId?: string }, suggest: (s?: { filename: string; conflictAction: string }) => void) => boolean | undefined;

  function install() {
    const store: Record<string, unknown> = {};
    let listener!: Listener;
    vi.stubGlobal('chrome', {
      runtime: { id: 'ext-id' },
      storage: { session: {
        get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(store, values); }),
      } },
      downloads: { onDeterminingFilename: { addListener: (fn: Listener) => { listener = fn; } } },
    });
    registerDownloadNaming();
    return (item: Parameters<Listener>[0]) => new Promise<unknown>(resolve => {
      const async = listener(item, suggestion => resolve(suggestion ?? null));
      expect(async).toBe(true);
    });
  }

  // ★ 이게 깨지면 package.json이 꾸러미 폴더 밖에 UUID 이름으로 떨어져 눈치코치가 읽지 못한다.
  it('★ 맡겨 둔 저장 경로를 blob 주소에 적용하고, 한 번만 쓴다', async () => {
    const run = install();
    const url = 'blob:chrome-extension://ext-id/767c0ee1-9803-4bd8-b30a-68b010e05400';
    await holdDownloadName(url, 'onNara.sAIde/수집/20261031_150000_abcd/package.json');
    const item = { url, filename: '767c0ee1-9803-4bd8-b30a-68b010e05400.json', byExtensionId: 'ext-id' };
    expect(await run(item)).toEqual({ filename: 'onNara.sAIde/수집/20261031_150000_abcd/package.json', conflictAction: 'overwrite' });
    expect(await run(item)).toBeNull();
  });

  it('맡긴 이름이 없으면 브라우저 기본 동작으로 넘긴다', async () => {
    const run = install();
    expect(await run({ url: 'blob:chrome-extension://ext-id/other', byExtensionId: 'ext-id' })).toBeNull();
  });
});
