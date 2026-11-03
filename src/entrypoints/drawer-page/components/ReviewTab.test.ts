// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReviewTab } from './ReviewTab';
import { DEFAULT_SETTINGS } from '@/lib/storage/settings';

let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test-saide-id',
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      sendMessage: vi.fn(async (msg: any) => {
        if (msg.type === 'BUBBLE_TRANSFORM_AI') {
          return { result: `[교정됨] ${msg.body?.messages?.[1]?.content || ''}` };
        }
        return {};
      }),
    },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(),
      },
    },
  });

  document.body.innerHTML = '<div id="fixture"></div>';
  root = createRoot(document.getElementById('fixture')!);
});

afterEach(async () => {
  await act(() => root.unmount());
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 15; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

describe('ReviewTab (퇴고 탭) 컴포넌트 검증', () => {
  it('기본 렌더링 시 본 화면 맞춤법 검사가 기본 서브탭으로 활성화된다', async () => {
    await act(() =>
      root.render(
        createElement(ReviewTab, {
          settings: DEFAULT_SETTINGS,
          docTitle: '테스트 공문',
          needsOpenBody: false,
          hasWriteBodyBtn: true,
        })
      )
    );
    await settle();

    expect(document.body.textContent).toContain('공문서 퇴고 및 교정');
    expect(document.body.textContent).toContain('본 화면 맞춤법 검사');
    expect(document.body.textContent).toContain('블럭 메뉴 (문장 지원)');
    expect(document.body.textContent).toContain('기안기 본문 내용');
    expect(document.body.textContent).toContain('맞춤법 검사 실행');
  });

  it('기안기 본문작성 화면이 닫혀 있을 때 안내 배너 및 열기 버튼이 노출된다', async () => {
    const handleOpenBody = vi.fn();
    await act(() =>
      root.render(
        createElement(ReviewTab, {
          settings: DEFAULT_SETTINGS,
          docTitle: '테스트 공문',
          needsOpenBody: true,
          hasWriteBodyBtn: true,
          onOpenBodyClick: handleOpenBody,
        })
      )
    );
    await settle();

    expect(document.body.textContent).toContain('기안기 본문작성 화면이 닫혀 있습니다');
    const openBtn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('[본문작성] 창 열기')
    );
    expect(openBtn).toBeDefined();

    await act(async () => openBtn?.click());
    expect(handleOpenBody).toHaveBeenCalled();
  });

  it('DRAFT_BODY_TEXT_RESPONSE 메시지를 수신하면 본문 내용이 textarea에 자동 입력된다', async () => {
    await act(() =>
      root.render(
        createElement(ReviewTab, {
          settings: DEFAULT_SETTINGS,
          docTitle: '테스트 공문',
        })
      )
    );
    await settle();

    const sampleBody = '이것은 온나라 기안기에서 읽어온 본문 텍스트입니다.';
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'DRAFT_BODY_TEXT_RESPONSE',
            text: sampleBody,
            source: 'webhwp',
          },
          origin: window.location.origin,
          source: window.parent,
        })
      );
    });
    await settle();

    const textarea = document.querySelector<HTMLTextAreaElement>('textarea');
    expect(textarea?.value).toBe(sampleBody);
    expect(document.body.textContent).toContain('한글 기안기');
  });

  it('본문 맞춤법 검사를 실행하면 AI 변환 결과를 수신하여 Diff 및 교정본이 표시된다', async () => {
    const handlePrepareInsert = vi.fn();
    await act(() =>
      root.render(
        createElement(ReviewTab, {
          settings: DEFAULT_SETTINGS,
          docTitle: '테스트 공문',
          onPrepareInsert: handlePrepareInsert,
        })
      )
    );
    await settle();

    // 메시지를 통해 본문 입력
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'DRAFT_BODY_TEXT_RESPONSE',
            text: '이것은 맞춤법이 틀린 문장 입니다.',
          },
          origin: window.location.origin,
          source: window.parent,
        })
      );
    });
    await settle();

    const runBtn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('맞춤법 검사 실행')
    );
    expect(runBtn).toBeDefined();

    await act(async () => runBtn?.click());
    await settle();

    expect(document.body.textContent).toContain('교정 결과');
    expect(document.body.textContent).toContain('기안기 본문에 반영');

    // 기안기 본문에 반영 클릭
    const applyBtn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('기안기 본문에 반영')
    );
    await act(async () => applyBtn?.click());
    expect(handlePrepareInsert).toHaveBeenCalledWith(expect.stringContaining('교정'), 'cursor');
  });

  it('블럭 메뉴 서브탭으로 전환하면 6대 문장 다듬기, 개인정보 마스킹, 번호 매기기 도구가 제공된다', async () => {
    await act(() =>
      root.render(
        createElement(ReviewTab, {
          settings: DEFAULT_SETTINGS,
          docTitle: '테스트 공문',
        })
      )
    );
    await settle();

    const blockSubTab = [...document.querySelectorAll('button[role="tab"]')].find((b) =>
      b.textContent?.includes('블럭 메뉴')
    );
    expect(blockSubTab).toBeDefined();

    await act(async () => blockSubTab?.click());
    await settle();

    // 블럭 메뉴 도구 확인
    expect(document.body.textContent).toContain('선택된 문장 (블럭)');
    expect(document.body.textContent).toContain('선택 문장 맞춤법 & 띄어쓰기 교정');
    expect(document.body.textContent).toContain('간결하게');
    expect(document.body.textContent).toContain('풍부하게');
    expect(document.body.textContent).toContain('공문서 표준 어투');
    expect(document.body.textContent).toContain('개조식 변환');
    expect(document.body.textContent).toContain('쉬운 행정용어');
    expect(document.body.textContent).toContain('정중한 협조체');
    expect(document.body.textContent).toContain('개인정보 마스킹');
    expect(document.body.textContent).toContain('번호 매기기');
  });

  it('블럭 메뉴에서 개인정보 마스킹 및 번호 매기기를 실행하면 로컬 규칙으로 즉시 변환된다', async () => {
    await act(() =>
      root.render(
        createElement(ReviewTab, {
          settings: DEFAULT_SETTINGS,
          docTitle: '테스트 공문',
        })
      )
    );
    await settle();

    // 블럭 탭 이동
    const blockSubTab = [...document.querySelectorAll('button[role="tab"]')].find((b) =>
      b.textContent?.includes('블럭 메뉴')
    );
    await act(async () => blockSubTab?.click());
    await settle();

    // 선택 문장 주입 (메시지 수신)
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'DRAFT_SELECTION_TEXT_RESPONSE',
            text: '담당자 홍길동 900101-1234567 연락처 010-1234-5678',
          },
          origin: window.location.origin,
          source: window.parent,
        })
      );
    });
    await settle();

    // 개인정보 마스킹 클릭
    const maskBtn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('개인정보 마스킹')
    );
    await act(async () => maskBtn?.click());
    await settle();

    expect(document.body.textContent).toContain('선택 영역에 즉시 반영');
    expect(document.body.textContent).toContain('******');
  });
});
