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
          // 실제 AI처럼 [변환 대상 문장]만 고쳐 돌려준다. 소제목("1. ...")은 일부러 지워
          // 보호 로직이 되살리는지 확인한다.
          const content: string = msg.body?.messages?.[1]?.content || '';
          const target = content.split('[변환 대상 문장]\n').pop() || '';
          const result = target
            .split('\n')
            .filter((line) => !/^\d+\.\s/.test(line))
            .join('\n')
            .replace(/ 입니다/g, '입니다')
            .replace(/틀린/g, '교정된');
          return { result };
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

describe('ReviewTab (문장 다듬기 탭) 컴포넌트 검증', () => {
  it('기본 렌더링 시 맞춤법 검사가 기본 서브탭으로 활성화된다', async () => {
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

    expect(document.body.textContent).toContain('맞춤법 검사');
    expect(document.body.textContent).toContain('블럭 메뉴 (문장 지원)');
    expect(document.body.textContent).toContain('기안기 제목·본문');
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

  it('제목이 함께 오면 제목 입력란에, 본문은 textarea에 따로 담긴다 (서식·버튼 글자는 없다)', async () => {
    await act(() => root.render(createElement(ReviewTab, { settings: DEFAULT_SETTINGS })));
    await settle();

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'DRAFT_BODY_TEXT_RESPONSE', title: '2026년 업무계획 알림', text: '본문 내용입니다.', source: 'webhwp' },
          origin: window.location.origin,
          source: window.parent,
        })
      );
    });
    await settle();

    expect(document.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe('2026년 업무계획 알림');
    expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('본문 내용입니다.');
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

    // 기안기 본문에 반영: 버튼은 확인 팝업만 띄우고, 팝업에서 승인해야 필드 교체 요청을 보낸다.
    // (커서 삽입 확인창을 쓰지 않는다 — 퇴고 탭에서는 그 확인창이 보이지 않았다)
    const posted = vi.spyOn(window, 'postMessage');
    const findApply = () =>
      [...document.querySelectorAll('button')].find((b) => /기안기 본문에 반영/.test(b.textContent ?? ''));
    const findDialogBtn = (label: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.includes(label));
    const replaceCalls = () => posted.mock.calls.filter(([m]) => (m as any)?.type === 'DRAFT_REPLACE_FIELDS');
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => findApply()?.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain('기안기 본문 교체 확인');
    expect(replaceCalls()).toHaveLength(0);

    // 취소하면 팝업이 닫히고 아무것도 보내지 않는다.
    await act(async () => findDialogBtn('취소')?.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(replaceCalls()).toHaveLength(0);

    // 다시 열어 승인하면 교체 요청을 보낸다.
    await act(async () => findApply()?.click());
    await act(async () => findDialogBtn('교체하여 반영')?.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const sent = replaceCalls().map(([m]) => m as any)[0];
    expect(sent?.body).toContain('교정');
    expect(handlePrepareInsert).not.toHaveBeenCalled();
    posted.mockRestore();
  });

  it('소제목은 교정 대상에서 지워지지 않고, ×로 제외한 교정은 원문대로 반영된다', async () => {
    await act(() => root.render(createElement(ReviewTab, { settings: DEFAULT_SETTINGS })));
    await settle();
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'DRAFT_BODY_TEXT_RESPONSE', text: '1. 보고 배경 및 목적\n가. 틀린 문장 입니다.' },
          origin: window.location.origin,
          source: window.parent,
        })
      );
    });
    await settle();
    const runBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('맞춤법 검사 실행'));
    await act(async () => runBtn?.click());
    await settle();

    // 소제목은 삭제(취소선)로 표시되지 않는다.
    const removed = [...document.querySelectorAll('.line-through')].map((e) => e.textContent).join('|');
    expect(removed).not.toContain('보고 배경');

    // 교정 항목은 2건(틀린→교정된, 띄어쓰기). 첫 항목을 ×로 제외한다.
    const excludeBtns = () => [...document.querySelectorAll('button[aria-label="이 교정 제외"]')] as HTMLButtonElement[];
    expect(excludeBtns()).toHaveLength(2);
    await act(async () => excludeBtns()[0]!.click());
    expect(excludeBtns()).toHaveLength(1);
    expect(document.querySelectorAll('button[aria-label="이 교정 다시 적용"]')).toHaveLength(1);
    expect(document.body.textContent).toContain('제외 1건');

    const posted = vi.spyOn(window, 'postMessage');
    await act(async () =>
      [...document.querySelectorAll('button')].find((b) => /기안기 본문에 반영/.test(b.textContent ?? ''))?.click()
    );
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.includes('교체하여 반영'))?.click()
    );
    const sent = posted.mock.calls.map(([m]) => m as any).find((m) => m?.type === 'DRAFT_REPLACE_FIELDS');
    expect(sent?.body).toBe('1. 보고 배경 및 목적\n가. 틀린 문장입니다.');
    posted.mockRestore();
  });

  it('반영 요청에 기안기가 응답하지 않으면 버튼을 풀고 반영하지 못했다고 알린다', async () => {
    const toast = vi.fn();
    await act(() => root.render(createElement(ReviewTab, { settings: DEFAULT_SETTINGS, onShowToast: toast })));
    await settle();
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'DRAFT_BODY_TEXT_RESPONSE', text: '틀린 문장 입니다.' },
          origin: window.location.origin,
          source: window.parent,
        })
      );
    });
    await settle();
    const runBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('맞춤법 검사 실행'));
    await act(async () => runBtn?.click());
    await settle();

    vi.useFakeTimers();
    try {
      const findApply = () =>
        [...document.querySelectorAll('button')].find((b) => /기안기 본문에 반영|반영 중/.test(b.textContent ?? ''));
      await act(async () => findApply()?.click());
      await act(async () =>
        [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.includes('교체하여 반영'))?.click()
      );
      expect(findApply()?.textContent).toContain('반영 중');

      await act(async () => vi.advanceTimersByTime(15000));
      expect(findApply()?.textContent).toContain('기안기 본문에 반영');
      expect(toast).toHaveBeenLastCalledWith(expect.stringContaining('응답이 없어 반영하지 못했습니다'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('반영 결과 응답이 오면 그 안내를 알리고 무응답 안내는 띄우지 않는다', async () => {
    const toast = vi.fn();
    await act(() => root.render(createElement(ReviewTab, { settings: DEFAULT_SETTINGS, onShowToast: toast })));
    await settle();
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'DRAFT_BODY_TEXT_RESPONSE', text: '틀린 문장 입니다.' },
          origin: window.location.origin,
          source: window.parent,
        })
      );
    });
    await settle();
    const runBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('맞춤법 검사 실행'));
    await act(async () => runBtn?.click());
    await settle();

    vi.useFakeTimers();
    try {
      const findApply = () =>
        [...document.querySelectorAll('button')].find((b) => /기안기 본문에 반영|반영 중/.test(b.textContent ?? ''));
      await act(async () => findApply()?.click());
      await act(async () =>
        [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.includes('교체하여 반영'))?.click()
      );
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'DRAFT_REPLACE_FIELDS_RESULT', success: true, message: '기안기 본문에 교정본이 반영되었습니다.' },
            origin: window.location.origin,
            source: window.parent,
          })
        );
      });
      expect(toast).toHaveBeenLastCalledWith('기안기 본문에 교정본이 반영되었습니다.');

      await act(async () => vi.advanceTimersByTime(15000));
      expect(toast).toHaveBeenLastCalledWith('기안기 본문에 교정본이 반영되었습니다.');
    } finally {
      vi.useRealTimers();
    }
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

    const blockSubTab = [...document.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find((b) =>
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
    const blockSubTab = [...document.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find((b) =>
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
