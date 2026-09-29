// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DrawerApp } from './DrawerApp';
import { db } from '@/lib/storage/db';

let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    runtime: {
      id: 'test-saide-id',
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      sendMessage: vi.fn(),
    },
  });

  document.body.innerHTML = '<div id="fixture"></div>';
  root = createRoot(document.getElementById('fixture')!);
});

afterEach(async () => {
  await act(() => root.unmount());
  vi.unstubAllGlobals();
  await db.userRefs.clear();
});

async function settle() {
  for (let i = 0; i < 15; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

describe('DrawerApp UI/UX 개선 검증', () => {
  it('기본 상태: 작성 설정, 작성 요청 2개 섹션이 보이고, 생성 결과는 결과가 없을 때 숨겨진다', async () => {
    await act(() => root.render(createElement(DrawerApp)));
    await settle();

    // 1. 브랜드 헤더 및 탭
    expect(document.body.textContent).toContain('온나라 sAIde');
    expect(document.body.textContent).toContain('기안');
    expect(document.body.textContent).toContain('코파일럿');
    expect(document.body.textContent).toContain('초안 작성');
    expect(document.body.textContent).toContain('서식관리');

    // 2. 정보 구조: 세 섹션 중 1, 2 영역만 기본 노출
    expect(document.body.textContent).toContain('작성 설정');
    expect(document.body.textContent).toContain('작성 요청');
    // 생성 결과는 결과가 없을 때 노출되지 않는다
    expect(document.body.textContent).not.toContain('생성 결과');

    // 3. 작성 설정 내 서식 선택과 참고문서 선택의 동일 위계 배치
    expect(document.body.textContent).toContain('서식 선택');
    expect(document.body.textContent).toContain('참고문서 선택');
  });

  it('초안 작성을 시작하면 작성 설정이 접히고 버튼으로 다시 펼칠 수 있다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    await act(() => root.render(createElement(DrawerApp)));
    await settle();

    const settingsToggle = document.querySelector<HTMLButtonElement>('[aria-controls="section-settings-content"]');
    expect(settingsToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('section-settings-content')?.hidden).toBe(false);

    window.postMessage({ type: 'SAIDE_SET_DRAFT_PREVIEW', prompt: '초안 작성 요청' }, '*');
    await settle();
    const generateButton = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('공문서 초안 생성')
    );
    await act(async () => generateButton?.click());
    await settle();

    expect(settingsToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('section-settings-content')?.hidden).toBe(true);
    expect(document.getElementById('draft-prompt-textarea')).not.toBeNull();

    await act(async () => settingsToggle?.click());
    expect(settingsToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('section-settings-content')?.hidden).toBe(false);

    await act(async () => settingsToggle?.click());
    expect(settingsToggle?.getAttribute('aria-expanded')).toBe('false');
  });

  it('AI 응답이 완료되면 작성 요청이 접히고 다시 펼쳐 수정할 수 있다', async () => {
    let completeGeneration: () => void = () => {};
    vi.stubGlobal('fetch', vi.fn(async () => {
      await new Promise<void>((resolve) => { completeGeneration = resolve; });
      return { ok: true, json: async () => ({ message: { content: '1. 추진 배경\n  가. 업무 효율화' } }) };
    }));
    await act(() => root.render(createElement(DrawerApp)));
    await settle();

    const requestToggle = document.querySelector<HTMLButtonElement>('[aria-controls="section-request-content"]');
    const requestContent = document.getElementById('section-request-content');
    expect(requestToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(requestContent?.hidden).toBe(false);

    window.postMessage({ type: 'SAIDE_SET_DRAFT_PREVIEW', prompt: '업무 효율화 계획' }, '*');
    await settle();
    const generateButton = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('공문서 초안 생성')
    );
    await act(async () => generateButton?.click());
    await settle();
    expect(requestContent?.hidden).toBe(false);
    expect(requestToggle?.getAttribute('aria-expanded')).toBe('true');

    await act(async () => completeGeneration());
    await settle();
    expect(document.body.textContent).toContain('생성 결과');
    expect(requestContent?.hidden).toBe(true);
    expect(requestToggle?.getAttribute('aria-expanded')).toBe('false');

    await act(async () => requestToggle?.click());
    expect(requestContent?.hidden).toBe(false);
    expect((document.getElementById('draft-prompt-textarea') as HTMLTextAreaElement).value).toBe('업무 효율화 계획');
    await act(async () => requestToggle?.click());
    expect(requestContent?.hidden).toBe(true);
  });

  it('서식 선택 시 선택 상태가 간결하게 표시되며 불필요한 골격 추가 버튼은 노출되지 않는다', async () => {
    await act(() => root.render(createElement(DrawerApp)));
    await settle();

    // 서식 선택 시뮬레이션
    window.postMessage({
      type: 'SAIDE_SET_DRAFT_PREVIEW',
      templateId: 'builtin-work-report',
      prompt: '',
    }, '*');
    await settle();

    // 1. 선택 상태가 간결하게 표시됨 ("선택됨" 배지)
    expect(document.body.textContent).toContain('선택됨');

    // 2. 불필요한 "항목 골격을 요청에 추가" 버튼이 노출되지 않음
    expect(document.body.textContent).not.toContain('항목 골격을 요청에 추가');

    // 3. 서식 해제 버튼 클릭 시 해제
    const clearTemplateBtn = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.includes('서식 해제')
    );
    expect(clearTemplateBtn).toBeDefined();

    await act(async () => {
      clearTemplateBtn?.click();
    });
    await settle();

    expect(document.body.textContent).not.toContain('선택됨');
  });

  it('참고문서 목록: 선택 상태가 체크 아이콘으로 간결하게 인지되며, 본문 새로고침이나 중복 해제 버튼 없이 단일 참고 해제가 제공된다', async () => {
    await act(() => root.render(createElement(DrawerApp)));
    await settle();

    // 관련정보 문서 응답 주입
    window.postMessage({
      type: 'DRAFT_CONTEXT_RESPONSE',
      title: '2026년 공공 AI 사업 기안',
      relatedDocs: [
        {
          title: '2026년도 인공지능 행정업무 시범사업 추진계획 알림 (행정안전부 디지털정부혁신과)',
          type: '수신문서',
          rawText: '',
          content: '행정안전부 디지털정부혁신과 공문 본문 내용입니다.',
          status: 'loaded',
        },
        {
          title: '2026년도 지자체 정보화예산 편성 지침',
          type: '참고문서',
          rawText: '',
          status: 'idle',
        },
      ],
    }, '*');
    await settle();

    // 1. 첫 번째 문서가 기본 선택되어 체크 아이콘 및 [내용] 버튼 표시 확인
    const checkIcon = document.querySelector('[title="참고문서 선택됨"]');
    expect(checkIcon).toBeDefined();

    // 2. '본문 새로고침' 버튼이 삭제되었는지 확인
    expect(document.body.textContent).not.toContain('본문 새로고침');

    // 3. 중복 버튼 없이 상단 헤더에 단 1개의 '참고 해제' 버튼만 제공되는지 확인
    const releaseButtons = [...document.querySelectorAll('button')].filter(
      (b) => b.textContent?.trim() === '참고 해제'
    );
    expect(releaseButtons.length).toBe(1);

    // 4. '참고 해제' 클릭 시 선택 해제되어 체크 아이콘 및 헤더 해제 버튼이 사라짐
    await act(async () => {
      releaseButtons[0]?.click();
    });
    await settle();

    const checkIconAfter = document.querySelector('[title="참고문서 선택됨"]');
    expect(checkIconAfter).toBeNull();
    const releaseButtonsAfter = [...document.querySelectorAll('button')].filter(
      (b) => b.textContent?.trim() === '참고 해제'
    );
    expect(releaseButtonsAfter.length).toBe(0);
  });

  it('참고문서 내용 펼침: 핵심 요약, 원문 전환, 추가 메모 입력창이 제공된다', async () => {
    await act(() => root.render(createElement(DrawerApp)));
    await settle();

    window.postMessage({
      type: 'DRAFT_CONTEXT_RESPONSE',
      title: '테스트 공문',
      relatedDocs: [
        {
          title: '참고문서1',
          type: '수신문서',
          rawText: '',
          content: '참고문서 본문 텍스트입니다. 제출 기한: 2026-10-15.',
          status: 'loaded',
        },
      ],
    }, '*');
    await settle();

    // '내용' 버튼 클릭하여 펼침
    const toggleBtn = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '내용'
    );
    expect(toggleBtn).toBeDefined();

    await act(async () => {
      toggleBtn?.click();
    });
    await settle();

    // 펼침 영역 확인: 요약, 추가 메모
    expect(document.body.textContent).toContain('참고문서 핵심 요약');
    expect(document.body.textContent).toContain('참고문서 관련 추가 요구사항 또는 핵심 메모');

    // 원문 전체 보기 토글 확인
    const rawBtn = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.includes('원문 전체 보기')
    );
    expect(rawBtn).toBeDefined();
    await act(async () => {
      rawBtn?.click();
    });
    await settle();

    expect(document.body.textContent).toContain('참고문서 본문 텍스트입니다. 제출 기한: 2026-10-15.');
  });

  it('선택한 참고문서 본문을 읽기 전에는 초안을 생성하지 않는다', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await act(() => root.render(createElement(DrawerApp)));
    await settle();
    window.postMessage({ type: 'DRAFT_CONTEXT_RESPONSE', relatedDocs: [{ title: '행사 개최계획 알림', rawText: '', status: 'idle' }] }, '*');
    await settle();
    window.postMessage({ type: 'SAIDE_SET_DRAFT_PREVIEW', prompt: '행사 협조 공문 작성' }, '*');
    await settle();
    const generate = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('공문서 초안 생성'));
    await act(async () => generate?.click());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('본문을 읽은 뒤 초안을 작성할 수 있습니다');
  });

  it('작성 요청 영역: 서식 상태 배지가 중복 표시되지 않으며, 도움말과 생성 버튼이 올바르게 렌더링된다', async () => {
    await act(() => root.render(createElement(DrawerApp)));
    await settle();

    // 서식 선택
    window.postMessage({
      type: 'SAIDE_SET_DRAFT_PREVIEW',
      templateId: 'builtin-work-report',
      prompt: '테스트 요청 내용',
    }, '*');
    await settle();

    // 섹션 2 헤더 확인
    const section2Title = document.getElementById('section-request-title');
    expect(section2Title?.textContent).toContain('작성 요청');
    // 섹션 2 제목 옆에 '서식 적용' 배지가 중복되지 않음
    expect(section2Title?.textContent).not.toContain('서식 적용');

    // 입력 도움말
    expect(document.body.textContent).toContain('Enter: 초안 생성 · Shift + Enter: 줄바꿈');

    // 초안 생성 버튼
    const generateBtn = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.includes('초안 생성')
    );
    expect(generateBtn).toBeDefined();
    expect(generateBtn?.hasAttribute('disabled')).toBe(false);
  });

  it('생성 오류 발생 시: 오류 문구를 생성된 초안으로 취급하지 않아 복사/삽입 버튼이 노출되지 않는다', async () => {
    // Ollama 호출 실패 시뮬레이션
    vi.stubGlobal('fetch', vi.fn(async () => {
      return { ok: false, status: 500 };
    }));

    await act(() => root.render(createElement(DrawerApp)));
    await settle();

    window.postMessage({
      type: 'SAIDE_SET_DRAFT_PREVIEW',
      prompt: '초안 작성 요청',
    }, '*');
    await settle();

    const generateBtn = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.includes('초안 생성')
    );

    await act(async () => {
      generateBtn?.click();
    });
    await settle();

    // 오류 안내 카드 표시 확인
    expect(document.body.textContent).toContain('초안 생성 실패');
    expect(document.body.textContent).toContain('Ollama 응답 오류 (500)');

    // 오류 문구가 생성된 초안으로 취급되지 않아 하단 '초안 복사'나 '본문에 삽입' 버튼이 나타나지 않음
    expect(document.body.textContent).not.toContain('초안 복사');
    expect(document.body.textContent).not.toContain('본문에 삽입');
  });

  it('생성 결과는 기본으로 펼쳐지고 사용자가 접었다 다시 펼칠 수 있다', async () => {
    await act(() => root.render(createElement(DrawerApp)));
    await settle();

    window.postMessage({
      type: 'SAIDE_SET_DRAFT_PREVIEW',
      recommendedTitle: '업무 혁신 계획',
      draft: '1. 추진 배경\n  가. 업무 효율화',
    }, '*');
    await settle();

    const resultToggle = document.querySelector<HTMLButtonElement>('[aria-controls="section-result-content"]');
    const resultContent = document.getElementById('section-result-content');
    expect(resultToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(resultContent?.hidden).toBe(false);

    await act(async () => resultToggle?.click());
    expect(resultToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(resultContent?.hidden).toBe(true);

    await act(async () => resultToggle?.click());
    expect(resultToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(resultContent?.hidden).toBe(false);
    expect((document.getElementById('recommended-title-input') as HTMLInputElement).value).toBe('업무 혁신 계획');
  });

  it('결과 생성 상태: 추천 제목 그룹(입력창+반영버튼), 14px 초안 본문, 하단 고정 액션 바가 노출된다', async () => {
    await act(() => root.render(createElement(DrawerApp)));
    await settle();

    // 완성된 초안 미리보기 주입
    window.postMessage({
      type: 'SAIDE_SET_DRAFT_PREVIEW',
      recommendedTitle: '2026년 공공 AI 업무혁신 추진계획(안)',
      draft: '1. 추진 목적\n  가. 지자체 행정업무 효율화...',
    }, '*');
    await settle();

    // 1. 생성 결과 섹션 노출 확인
    expect(document.body.textContent).toContain('생성 결과');

    // 2. 추천 제목 입력창 및 제목 반영 버튼 확인
    const titleInput = document.getElementById('recommended-title-input') as HTMLInputElement;
    expect(titleInput).toBeDefined();
    expect(titleInput.value).toBe('2026년 공공 AI 업무혁신 추진계획(안)');

    const applyTitleBtn = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '제목 반영'
    );
    expect(applyTitleBtn).toBeDefined();

    // 3. 본문 결과 상단에 중복된 '서식 복사' 버튼이 없는지 확인
    expect(document.body.textContent).not.toContain('서식 복사');

    // 4. 하단 고정 동작 영역에 '초안 복사'와 '본문에 삽입' 버튼 제공 확인
    expect(document.body.textContent).toContain('초안 복사');
    expect(document.body.textContent).toContain('본문에 삽입');

    // 5. '본문에 삽입' 클릭 시 삽입 위치 선택 모드 및 '선택 취소' 버튼 전환 확인
    const insertBtn = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.includes('본문에 삽입')
    );
    await act(async () => {
      insertBtn?.click();
    });
    await settle();

    expect(document.body.textContent).toContain('기안기 화면에서 초안을 넣을 위치를 클릭하세요');
    expect(document.body.textContent).toContain('선택 취소');

    // '선택 취소' 클릭 시 원상 복구
    const cancelBtn = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.includes('선택 취소')
    );
    await act(async () => {
      cancelBtn?.click();
    });
    await settle();

    expect(document.body.textContent).toContain('본문에 삽입');
  });

  it('2단계 명시적 승인 모달: 타깃 라벨 및 확인/취소 동작이 유지된다', async () => {
    await act(() => root.render(createElement(DrawerApp)));
    await settle();

    window.postMessage({
      type: 'SAIDE_SET_DRAFT_PREVIEW',
      draft: '테스트 초안 본문',
    }, '*');
    await settle();

    // 부모 프레임에서 타깃이 지정된 승인 준비 이벤트 수신
    window.postMessage({
      type: 'DRAFT_PREPARED_RESPONSE',
      approvalToken: 'token_123',
      preview: '미리보기 텍스트',
      targetLabel: '본문 1번째 문단',
    }, '*');
    await settle();

    // 승인 모달 확인
    expect(document.body.textContent).toContain('본문 삽입 사전 확인');
    expect(document.body.textContent).toContain('본문 1번째 문단');
    expect(document.body.textContent).toContain('이 문서에 삽입');
    expect(document.body.textContent).toContain('취소');

    const cancelModalBtn = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '취소'
    );
    await act(async () => {
      cancelModalBtn?.click();
    });
    await settle();

    expect(document.body.textContent).not.toContain('본문 삽입 사전 확인');
  });
});

describe('내 참고자료 업로드', () => {
  type Call = { url: string; body: any };
  function ollama(options: { holdAnalysis?: boolean } = {}) {
    const calls: Call[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, body });
      if (body.format) {
        if (options.holdAnalysis) await new Promise(() => {});
        const example = Boolean(body.format.properties?.docType);
        const content = example
          ? { docType: '자료 제출 요청', structure: [], numbering: '1.→가.', toneFeatures: ['~바랍니다'], sampleSentences: [] }
          : { summary: '공공데이터 목록 제출 요청', purpose: '', requirements: [{ item: '목록 제출', evidence: '가. 개방 대상 목록을 2026. 10. 15.(목)까지 제출' }], schedule: [], legalBasis: [], targets: [], submissions: [], contacts: [], keyTerms: [] };
        return { ok: true, json: async () => ({ message: { content: JSON.stringify(content) } }) };
      }
      if (String(url).endsWith('/api/generate')) return { ok: true, json: async () => ({ response: '- 요약' }) };
      return { ok: true, json: async () => ({ message: { content: '1. 관련\n가. 목록을 2026. 10. 15.까지 제출하여 주시기 바랍니다.' } }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    return calls;
  }

  async function upload(name: string, text: string) {
    const input = document.querySelector<HTMLInputElement>('[data-testid="user-ref-file-input"]')!;
    const file = new File([text], name, { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await settle();
  }

  const GUIDE = '공공데이터 개방 지침\n1. 제출 요청\n가. 개방 대상 목록을 2026. 10. 15.(목)까지 제출\n나. 사업비 12,500천원';

  it('업로드 박스: 안내 문구 없이 구글 아이콘과 첨부 가능 확장자 배지만 깔끔하게 노출된다', async () => {
    ollama();
    await act(() => root.render(createElement(DrawerApp)));
    await settle();

    // 불필요한 안내문구 및 중복 '파일 올리기' 버튼이 제거되었는지 검증
    expect(document.body.textContent).not.toContain('지침·계획서·예전 공문 파일을 여기에 끌어다 놓거나');
    expect(document.body.textContent).not.toContain('구형 HWP는 한글에서 HWPX나 PDF로 저장해 올려 주세요');
    expect(document.body.textContent).not.toContain('파일 올리기');

    // 확장자 배지 노출 확인
    expect(document.body.textContent).toContain('HWPX');
    expect(document.body.textContent).toContain('PDF');
    expect(document.body.textContent).toContain('DOCX');
    expect(document.body.textContent).toContain('XLSX');
    expect(document.body.textContent).toContain('TXT');

    // 업로드 박스 및 파일 선택 연동 확인
    const dropzone = document.querySelector<HTMLElement>('div[role="button"][title*="올리기"]');
    expect(dropzone).not.toBeNull();
  });

  it('파일을 올리면 보관·선택되고, 원문과 대조한 분석 결과를 펼쳐 볼 수 있다', async () => {
    ollama();
    await act(() => root.render(createElement(DrawerApp)));
    await settle();
    expect(document.body.textContent).toContain('내 참고자료');
    await upload('지침.txt', GUIDE);
    await settle();

    expect(document.body.textContent).toContain('지침.txt');
    expect(document.body.textContent).toContain('(1/3건 선택)');
    expect(document.body.textContent).toContain('분석 완료');
    expect(await db.userRefs.count()).toBe(1);

    const analysisBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '분석');
    await act(async () => analysisBtn?.click());
    expect(document.body.textContent).toContain('목록 제출');
    expect(document.body.textContent).toContain('원문 확인');
    // 모델이 비운 기한을 코드가 채운다
    expect(document.body.textContent).toContain('코드 보완');
    expect(document.body.textContent).toContain('12,500천원');
  });

  it('구형 HWP는 올리지 않고 변환 방법을 안내한다', async () => {
    ollama();
    await act(() => root.render(createElement(DrawerApp)));
    await settle();
    await upload('옛문서.hwp', 'x');
    expect(document.body.textContent).toMatch(/HWPX.*PDF/);
    expect(await db.userRefs.count()).toBe(0);
  });

  it('최대 3건까지만 고를 수 있다', async () => {
    ollama();
    await act(() => root.render(createElement(DrawerApp)));
    await settle();
    for (const n of [1, 2, 3, 4]) await upload(`자료${n}.txt`, `${GUIDE}\n${n}번 자료`);
    expect(document.body.textContent).toContain('(3/3건 선택)');
    const boxes = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"][id^="userref-"]')];
    expect(boxes).toHaveLength(4);
    expect(boxes.filter((box) => box.checked)).toHaveLength(3);
    expect(boxes.find((box) => !box.checked)?.disabled).toBe(true);
  });

  it('용도를 작성 예시로 바꾸면 다시 분석하고, 초안 프롬프트에 근거·예시 블록이 나뉘어 들어간다', async () => {
    const calls = ollama();
    await act(() => root.render(createElement(DrawerApp)));
    await settle();
    await upload('지침.txt', GUIDE);
    await upload('예전공문.txt', '1. 관련\n2. 추진 개요\n가. 협조하여 주시기 바랍니다.\n2025. 3. 2.까지 제출');
    const item = document.querySelector('span[title="예전공문.txt"]')!.closest('div.p-2.rounded-lg')!;
    const exampleToggle = [...item.querySelectorAll('button')].find((b) => b.textContent === '작성 예시');
    await act(async () => exampleToggle?.click());
    await settle();
    expect(exampleToggle?.getAttribute('aria-pressed')).toBe('true');
    expect(calls.some((call) => call.body.format?.properties?.docType)).toBe(true);

    window.postMessage({ type: 'SAIDE_SET_DRAFT_PREVIEW', prompt: '공공데이터 목록 제출 요청 공문' }, '*');
    await settle();
    const generate = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('참고문서 2건 반영하여 공문서 초안 생성'));
    expect(generate).toBeDefined();
    await act(async () => generate?.click());
    await settle();

    const draftCall = calls.find((call) => !call.body.format && String(call.url).endsWith('/api/chat'));
    const user = draftCall?.body.messages[1].content as string;
    expect(user).toContain('[참고 문서 1] 지침.txt');
    expect(user).toContain('· 목록 제출');
    expect(user).toMatch(/\[작성 예시 1 — .*인용하지 말 것\] 예전공문\.txt/);
    expect(draftCall?.body.messages[0].content).toContain('작성 예시로 제공된 문서는 구성·번호 체계·문체만');
    expect(document.body.textContent).toContain('생성 결과');
  });

  it('분석이 끝나지 않은 자료를 고르고 생성하면 기다릴지 묻고, [지금 생성]은 코드 추출 사실로 작성한다', async () => {
    const calls = ollama({ holdAnalysis: true });
    await act(() => root.render(createElement(DrawerApp)));
    await settle();
    await upload('지침.txt', GUIDE);
    expect(document.body.textContent).toMatch(/분석 (준비 )?중/);

    window.postMessage({ type: 'SAIDE_SET_DRAFT_PREVIEW', prompt: '목록 제출 공문' }, '*');
    await settle();
    const generate = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('공문서 초안 생성'));
    await act(async () => generate?.click());
    expect(document.body.textContent).toContain('정밀 분석이 아직 끝나지 않았습니다');
    expect(calls.some((call) => !call.body.format)).toBe(false);

    const now = [...document.querySelectorAll('button')].find((b) => b.textContent === '지금 생성');
    await act(async () => now?.click());
    await settle();
    const draftCall = calls.find((call) => !call.body.format && String(call.url).endsWith('/api/chat'));
    const user = draftCall?.body.messages[1].content as string;
    expect(user).toContain('기한이 적힌 원문 문장');
    expect(user).toContain('2026. 10. 15.(목)까지 제출');
  });
});

it('실패 후 다시 읽기 버튼을 누르면 참고문서 조회를 재요청한다', async () => {
  await act(() => root.render(createElement(DrawerApp)));
  await settle();
  window.postMessage({ type: 'DRAFT_CONTEXT_RESPONSE', relatedDocs: [{ title: '감사 유공 표창 알림', rawText: '', status: 'idle' }] }, '*');
  await settle();
  window.postMessage({ type: 'DRAFT_RELATED_DOC_CONTENT', title: '감사 유공 표창 알림', content: '', error: '문서 ID 없음' }, '*');
  await settle();
  await act(() => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '내용')?.click());
  await settle();
  window.postMessage({ type: 'DRAFT_RELATED_DOC_CONTENT', title: '감사 유공 표창 알림', content: '', error: '문서 ID 없음' }, '*');
  await settle();
  const post = vi.spyOn(window.parent, 'postMessage');
  const referenceWarning = document.querySelector('.bg-amber-50');
  expect(referenceWarning?.textContent).toContain("문서 내용을 확인하려면 '관련정보'에서 해당 문서를 연 후, '다시 읽기'를 눌러 주세요.");
  expect(referenceWarning?.textContent).not.toContain('문서 ID 없음');
  const retry = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '다시 읽기');
  expect(retry).toBeDefined();
  await act(() => retry?.click());
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'DRAFT_FETCH_RELATED_DOC', doc: expect.objectContaining({ title: '감사 유공 표창 알림' }) }), '*');
  expect(document.body.textContent).toContain('필요하면 임시 탭이 열리고 자동으로 닫힙니다.');
  post.mockRestore();
});

it('본문 서식이 등록된 서식을 고르면 초안을 그 서식으로 미리 보여 주고, 본문 삽입 요청에 서식 묶음을 싣는다', async () => {
  const template = {
    id: 'tpl-format', title: '감리 보고 서식', documentType: '업무보고', description: '', sections: ['추진 배경'],
    createdAt: 1, updatedAt: 1,
    format: {
      version: 1, source: { fileName: '감리.odt', kind: 'odt', sha256: '', importedAt: 1 }, docKind: 'report', boxes: [], headings: [], notes: [],
      levels: [
        { key: 'section', label: '□ 소제목', glyph: '\u{F03DA}', glyphs: ['\u{F03DA}'], sample: '', leadSpaces: 0, count: 2,
          char: { font: 'HY견고딕', sizePt: 17, bold: false, spacingPct: 0, ratioPct: 100 },
          para: { lineSpacingPct: 180, beforePt: 0, afterPt: 0, leftPt: 0, indentPt: 0, align: 'justify' } },
        { key: 'item', label: '○ 항목', glyph: '❍', glyphs: ['❍'], sample: '', leadSpaces: 1, count: 5,
          char: { font: '휴먼명조', sizePt: 16, bold: false, spacingPct: 0, ratioPct: 100 },
          para: { lineSpacingPct: 170, beforePt: 0, afterPt: 0, leftPt: 0, indentPt: -28.3, align: 'left' } },
      ],
    },
  };
  vi.mocked(chrome.storage.local.get).mockImplementation((async (key: string) => (key === 'saide.draft_templates' ? { [key]: [template] } : {})) as never);
  await act(() => root.render(createElement(DrawerApp)));
  await settle();

  window.postMessage({ type: 'SAIDE_SET_DRAFT_PREVIEW', templateId: 'tpl-format', draft: '1. 추진 배경\n가. 품질 확보' }, '*');
  await settle();

  const preview = document.querySelector('[aria-label="생성된 공문서 초안 본문"]')!;
  expect(preview.textContent).toContain('[감리 보고 서식] 서식 적용 미리보기');
  expect(preview.textContent).toContain('□ 추진 배경'); // 한컴 전용 □는 보이는 □로
  expect(preview.textContent).toContain('❍ 품질 확보');

  const post = vi.spyOn(window.parent, 'postMessage');
  const insert = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('본문에 삽입'));
  await act(async () => { insert?.click(); });
  await settle();
  const call = post.mock.calls.find(c => (c[0] as { type?: string }).type === 'SAIDE_START_CLICK_TARGET');
  expect(call?.[0]).toMatchObject({
    type: 'SAIDE_START_CLICK_TARGET',
    text: '\u{F03DA} 추진 배경\n ❍ 품질 확보',
    styled: { paras: [expect.objectContaining({ font: 'HY견고딕', height: 1700 }), expect.objectContaining({ font: '휴먼명조', indent: -2830 })] },
  });
  post.mockRestore();
});
