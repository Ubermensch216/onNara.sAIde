// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TemplateFormat } from '@/lib/template-format/types';
import { FileExtractError } from '@/lib/extract/files/types';

const analyze = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/lib/template-format', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/template-format')>()),
  analyzeTemplateFile: analyze.fn,
}));

import { TemplateManager } from './TemplateManager';

const FORMAT: TemplateFormat = {
  version: 1,
  source: { fileName: '감리 추진 보고.odt', kind: 'odt', sha256: 'abc', importedAt: 1 },
  docKind: 'report',
  levels: [
    {
      key: 'section', label: '□ 소제목', glyph: '\u{F03DA}', glyphs: ['\u{F03DA}'], sample: '감리 개요', leadSpaces: 0, count: 6,
      char: { font: 'HY견고딕', sizePt: 17, bold: false, spacingPct: 0, ratioPct: 100 },
      para: { lineSpacingPct: 180, beforePt: 0, afterPt: 0, leftPt: 0, indentPt: 0, align: 'justify' },
    },
    {
      key: 'item', label: '○ 항목', glyph: '❍', glyphs: ['❍'], sample: '❍ 감 리 명 : 비공개 사업명', leadSpaces: 1, count: 16,
      char: { font: '휴먼명조', sizePt: 16, bold: false, spacingPct: 0, ratioPct: 100 },
      para: { lineSpacingPct: 170, beforePt: 0, afterPt: 0, leftPt: 0, indentPt: -28.3, align: 'left' },
    },
  ],
  boxes: [{ role: 'summary', sample: '요약 원문', char: { font: '휴먼명조', sizePt: 15, bold: false, spacingPct: 0, ratioPct: 100 }, para: { lineSpacingPct: 150, beforePt: 0, afterPt: 0, leftPt: 0, indentPt: 0, align: 'justify' } }],
  headings: ['감리 개요', '추진근거'],
  notes: ['ODT 줄간격은 한글 기준으로 환산한 추정값입니다(ODT 123% ≈ 한글 160%).'],
};

let root: Root;
let stored: Record<string, unknown>;

beforeEach(() => {
  stored = {};
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in stored ? { [key]: stored[key] } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(stored, items); }),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
  localStorage.clear();
  analyze.fn.mockReset();
  document.body.innerHTML = '<div id="fixture"></div>';
  root = createRoot(document.getElementById('fixture')!);
});

afterEach(async () => {
  await act(() => root.unmount());
  vi.unstubAllGlobals();
});

async function flush(ms = 20) {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
}

function chooseFile(name: string) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  expect(input.accept).toBe('.hwpx,.odt');
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], name)] });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes(text));
  if (!button) throw new Error(`버튼 없음: ${text}`);
  return button as HTMLButtonElement;
}

describe('서식관리 · 파일에서 서식 가져오기', () => {
  it("파일을 고르면 '서식을 분석합니다.'를 띄우고, 분석 결과로 등록 창을 채운 뒤 예시 문장 없이 저장한다", async () => {
    let finish!: (f: TemplateFormat) => void;
    analyze.fn.mockReturnValue(new Promise<TemplateFormat>(resolve => { finish = resolve; }));
    const onRefresh = vi.fn();
    await act(() => root.render(createElement(TemplateManager, { templates: [], onSelectTemplateForDraft: vi.fn(), onRefreshTemplates: onRefresh })));

    await act(async () => { chooseFile('감리 추진 보고.odt'); });
    const status = document.querySelector('[role="status"]');
    expect(status?.textContent).toContain('서식을 분석합니다.');
    expect(status?.textContent).toContain('감리 추진 보고.odt');

    await act(async () => { finish(FORMAT); });
    await flush(800); // 안내 최소 표시 시간

    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(document.body.textContent).toContain('새 공문서 서식 등록');
    expect(document.body.textContent).toContain('본문 서식 (보고서형)');
    expect((document.querySelector('input[placeholder^="예: 2026"]') as HTMLInputElement).value).toBe('감리 추진 보고 서식');
    // 대제목이 필수 주요 항목으로 채워진다
    const sectionInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="text"]')).map(i => i.value);
    expect(sectionInputs).toEqual(expect.arrayContaining(['감리 개요', '추진근거']));
    // 한컴 전용 □(사용자 영역 문자)는 드로어에서 보이는 □로 바꿔 보여 준다
    expect(document.querySelector('[aria-label="서식 미리보기"]')?.textContent).toContain('□ 추진 배경');
    expect(document.body.textContent).toContain('예: ❍ 감 리 명');

    await act(async () => { buttonByText('서식 등록 완료').click(); });
    await flush();

    const list = stored['saide.draft_templates'] as { title: string; format?: TemplateFormat }[];
    const saved = list.find(t => t.title === '감리 추진 보고 서식')!;
    expect(saved.format?.levels.map(l => l.key)).toEqual(['section', 'item']);
    expect(saved.format?.levels.every(l => l.sample === '')).toBe(true);
    expect(saved.format?.boxes.every(b => b.sample === '')).toBe(true);
    expect(JSON.stringify(saved)).not.toContain('비공개 사업명');
    expect(saved.format?.levels[0]!.glyph).toBe('\u{F03DA}'); // 실제 본문용 원래 기호는 남긴다
    expect(onRefresh).toHaveBeenCalled();
  });

  it('등록 창에서 고친 값이 그대로 저장된다', async () => {
    analyze.fn.mockResolvedValue(FORMAT);
    await act(() => root.render(createElement(TemplateManager, { templates: [], onSelectTemplateForDraft: vi.fn(), onRefreshTemplates: vi.fn() })));
    await act(async () => { chooseFile('보고.odt'); });
    await flush(800);

    const size = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="number"]'))[0]!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(size, '18');
      size.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { buttonByText('서식 등록 완료').click(); });
    await flush();

    const list = stored['saide.draft_templates'] as { format?: TemplateFormat }[];
    expect(list.find(t => t.format)?.format?.levels[0]!.char.sizePt).toBe(18);
  });

  it('분석에 실패하면 이유를 알리고 등록 창을 열지 않는다', async () => {
    analyze.fn.mockRejectedValue(new FileExtractError("구형 한글(.hwp) 파일은 서식을 읽을 수 없습니다. 'HWPX' 형식으로 저장해 올려 주세요."));
    await act(() => root.render(createElement(TemplateManager, { templates: [], onSelectTemplateForDraft: vi.fn(), onRefreshTemplates: vi.fn() })));
    await act(async () => { chooseFile('옛 서식.hwp'); });
    await flush();

    expect(document.querySelector('[role="alert"]')?.textContent).toContain('구형 한글(.hwp)');
    expect(document.body.textContent).not.toContain('새 공문서 서식 등록');
  });

  it('본문 서식이 있는 서식 카드에 요약을 보여 준다', async () => {
    const template = {
      id: 't1', title: '감리 보고 서식', documentType: '업무보고', description: '', sections: ['감리 개요'],
      format: { ...FORMAT, levels: FORMAT.levels.map(l => ({ ...l, sample: '' })) }, createdAt: 1, updatedAt: 1,
    };
    await act(() => root.render(createElement(TemplateManager, { templates: [template], onSelectTemplateForDraft: vi.fn(), onRefreshTemplates: vi.fn() })));
    expect(document.body.textContent).toContain('본문 서식 포함 · 보고서형');
    expect(document.body.textContent).toContain('휴먼명조 16pt · 줄간격 170%');
    expect(document.body.textContent).toContain('단계 기호 □ → ❍');
  });
});
