import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadDraftTemplates,
  addDraftTemplate,
  updateDraftTemplate,
  deleteDraftTemplate,
  resetToDefaultDraftTemplates,
} from './draft-templates';

let data: Record<string, unknown>;
const listeners = new Set<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>();

describe('storage/draft-templates', () => {
  beforeEach(() => {
    data = {};
    listeners.clear();
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: data[key] })),
          set: vi.fn(async (next: Record<string, unknown>) => {
            data = { ...data, ...structuredClone(next) };
            for (const cb of listeners) {
              cb({ 'saide.draft_templates': { newValue: data['saide.draft_templates'] } as any }, 'local');
            }
          }),
        },
        onChanged: {
          addListener: (cb: any) => listeners.add(cb),
          removeListener: (cb: any) => listeners.delete(cb),
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('초기 로드 시 기본 4대 표준 서식이 시드되고 로드된다', async () => {
    const list = await loadDraftTemplates();
    expect(list.length).toBe(4);
    expect(list.some((t) => t.documentType === '업무보고')).toBe(true);
    expect(list.some((t) => t.documentType === '기본 계획서')).toBe(true);
    expect(list.some((t) => t.documentType === '구축 계획서')).toBe(true);
    expect(list.some((t) => t.documentType === '언론 보도')).toBe(true);
  });

  it('새 서식을 추가하면 목록에 포함되고 영속화된다', async () => {
    await loadDraftTemplates(); // 초기 시드
    const updated = await addDraftTemplate({
      title: '주간 부서 업무보고',
      documentType: '업무보고',
      description: '매주 금요일 부서 주간 보고용',
      sections: ['1. 금주 추진 실적', '2. 차주 계획', '3. 특이사항'],
      guidance: '실적 위주 간결 작성',
    });

    expect(updated.length).toBe(5);
    const added = updated.find((t) => t.title === '주간 부서 업무보고');
    expect(added).toBeDefined();
    expect(added?.sections).toEqual(['1. 금주 추진 실적', '2. 차주 계획', '3. 특이사항']);
    expect(added?.isBuiltin).toBe(false);

    // 다시 로드해도 유지됨
    const reloaded = await loadDraftTemplates();
    expect(reloaded.length).toBe(5);
  });

  it('서식을 수정하면 변경된 내용이 반영된다', async () => {
    const initial = await loadDraftTemplates();
    const first = initial[0];
    expect(first).toBeDefined();
    if (!first) return;
    const targetId = first.id;

    const updated = await updateDraftTemplate(targetId, {
      title: '수정된 업무보고 명칭',
      sections: ['1. 수정된 개요', '2. 수정된 실적'],
    });

    const modified = updated.find((t) => t.id === targetId);
    expect(modified?.title).toBe('수정된 업무보고 명칭');
    expect(modified?.sections).toEqual(['1. 수정된 개요', '2. 수정된 실적']);
  });

  it('서식을 삭제할 수 있다', async () => {
    const initial = await loadDraftTemplates();
    const first = initial[0];
    expect(first).toBeDefined();
    if (!first) return;
    const targetId = first.id;

    const afterDelete = await deleteDraftTemplate(targetId);
    expect(afterDelete.length).toBe(initial.length - 1);
    expect(afterDelete.some((t) => t.id === targetId)).toBe(false);
  });

  it('기본 서식으로 초기화(resetToDefaultDraftTemplates)하면 표준 서식 4종으로 복원된다', async () => {
    await loadDraftTemplates();
    // 새 항목 추가
    await addDraftTemplate({
      title: '임시 서식',
      documentType: '기타',
      sections: ['1. 항목'],
    });

    const resetList = await resetToDefaultDraftTemplates();
    expect(resetList.length).toBe(4);
    expect(resetList.some((t) => t.title === '임시 서식')).toBe(false);
    expect(resetList.every((t) => t.isBuiltin)).toBe(true);
  });
});
