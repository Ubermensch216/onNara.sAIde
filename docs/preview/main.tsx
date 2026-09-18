/** Actual application components, isolated browser API fixtures and sample data.
 * Documentation-only UI capture harness for onNara.sAIde.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_SETTINGS } from '@/lib/storage/settings';

const mode = new URLSearchParams(location.search).get('view') || 'panel';
window.addEventListener('unhandledrejection', event => {
  document.getElementById('root')!.textContent = String(event.reason?.stack || event.reason);
});
window.addEventListener('error', event => {
  document.getElementById('root')!.textContent = event.message;
});

const sampleTab = {
  tabId: 1,
  url: 'https://onnara.saas.gcloud.go.kr/bms/dctlist/act_wil.do',
  title: '온나라 전자문서시스템 - 접수대기함',
  active: true,
};

const listeners = new Set<Function>();
const now = Date.now();

const samplePresets = [
  {
    id: 'preset-1',
    label: '공문 핵심요약 (보고서형)',
    slash: '공문요약',
    template: '수신된 공문의 추진 목적, 핵심 내용, 우리 과 조치사항을 1장 보고서 형태로 요약해줘.',
    needs: 'page',
  },
  {
    id: 'preset-2',
    label: '조치사항 도출 (기한·할일)',
    slash: '조치사항',
    template: '공문에서 우리 과가 이행해야 할 세부 업무, 제출물, 마감 기한 및 제출처를 표로 정리해줘.',
    needs: 'page',
  },
  {
    id: 'preset-3',
    label: '회신문 초안 작성',
    slash: '회신초안',
    template: '본 수신 공문에 대한 회신 기안문 초안을 표준 공문서 서식(관련 근거, 검토 의견, 붙임)에 맞게 작성해줘.',
    needs: 'page',
  },
  {
    id: 'preset-4',
    label: '기안문 교정 및 린터',
    slash: '공문교정',
    template: '기안문의 맞춤법, 띄어쓰기, 행정용어 순화 및 어색한 표현을 교정하고 전후 대비표를 작성해줘: {{selection}}',
    needs: 'selection',
  },
];

const sampleMemoryRows = [
  {
    id: 1,
    url: 'https://onnara.saas.gcloud.go.kr/bms/dctenf/view.do?docId=2026-00123',
    title: '2026년도 인공지능 행정업무 시범사업 추진계획 알림 (행정안전부)',
    text: '행정안전부 디지털정부혁신과 주관 온나라 연계 AI 어시스턴트 시범 사업 추진 계획. 제출기한 2026년 10월 15일 18시까지.',
    chunk: 0,
    vector: new Float32Array(1024).fill(0.1),
    model: 'bge-m3:latest',
    visitedAt: now - 3600 * 1000 * 2,
  },
  {
    id: 2,
    url: 'https://onnara.saas.gcloud.go.kr/bms/dctenf/view.do?docId=2026-00124',
    title: '2026년도 지자체 정보화예산 편성 및 집행지침 알림 (행정안전부)',
    text: '디지털 플랫폼 정부 구현을 위한 정보화 예산 효율적 집행 및 클라우드 전환 가이드라인.',
    chunk: 0,
    vector: new Float32Array(1024).fill(0.1),
    model: 'bge-m3:latest',
    visitedAt: now - 3600 * 1000 * 24,
  },
  {
    id: 3,
    url: 'https://onnara.saas.gcloud.go.kr/bms/dctenf/view.do?docId=2026-00125',
    title: '공공데이터 개방 및 품질진단 지원사업 수요조사 안내 (디지털플랫폼정부위원회)',
    text: '공공기관 보유 데이터 개방 및 연계 표준화 지원 수요조사 제출 안내.',
    chunk: 0,
    vector: new Float32Array(1024).fill(0.1),
    model: 'bge-m3:latest',
    visitedAt: now - 3600 * 1000 * 48,
  },
  {
    id: 4,
    url: 'https://onnara.saas.gcloud.go.kr/bms/dctenf/view.do?docId=2026-00126',
    title: '행정전자서명(GPKI) 보안 강화 및 정기 점검 안내 (국가정보자원관리원)',
    text: 'GPKI 인증서 알고리즘 전환 및 온나라 연계 보안 필터 점검 가이드.',
    chunk: 0,
    vector: new Float32Array(1024).fill(0.1),
    model: 'bge-m3:latest',
    visitedAt: now - 3600 * 1000 * 72,
  },
];

const data: Record<string, unknown> = {
  'saide.settings': {
    ...DEFAULT_SETTINGS,
    theme: 'light',
    locale: 'ko',
    warmupOnOpen: false,
    model: 'gemma4:e2b',
    endpoint: 'http://localhost:11434',
    numCtx: 4096,
  },
  'saide.presets': samplePresets,
  'saide.automation.history': [
    {
      id: 'job-1',
      title: '2026년도 인공지능 행정업무 시범사업 추진계획 알림',
      status: 'completed',
      downloadId: 101,
      filename: '붙임1_2026_AI행정업무_추진계획.hwp',
      fileSize: 1420000,
      createdAt: now - 60000,
      completedAt: now - 45000,
    },
    {
      id: 'job-2',
      title: '2026년도 인공지능 행정업무 시범사업 추진계획 알림',
      status: 'completed',
      downloadId: 102,
      filename: '붙임2_시범사업_수요조사서_양식.hwpx',
      fileSize: 345000,
      createdAt: now - 45000,
      completedAt: now - 30000,
    },
    {
      id: 'job-3',
      title: '2026년도 인공지능 행정업무 시범사업 추진계획 알림',
      status: 'completed',
      downloadId: 103,
      filename: '붙임3_보안서약서.pdf',
      fileSize: 480000,
      createdAt: now - 30000,
      completedAt: now - 15000,
    },
  ],
};

const event = { addListener() {}, removeListener() {} };
Object.assign(window, { chrome: {
  storage: {
    local: {
      async get(key: string) { return { [key]: data[key] }; },
      async set(patch: Record<string, unknown>) {
        const changes = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, { newValue: v }]));
        Object.assign(data, patch);
        listeners.forEach(fn => fn(changes, 'local'));
      },
    },
    onChanged: { addListener(fn: Function) { listeners.add(fn); }, removeListener(fn: Function) { listeners.delete(fn); } },
  },
  runtime: {
    onMessage: event,
    async sendMessage(msg: unknown) {
      const type = (msg as { type?: string })?.type;
      if (type === 'EXTRACT_PAGE') {
        return {
          type: 'PAGE_EXTRACTED',
          payload: {
            title: '온나라 2.0 접수대기함',
            url: sampleTab.url,
            text: '온나라 2.0 접수대기함 목록 15건 중 3건 선택됨.',
            charCount: 2400,
            truncated: false,
            keptRatio: 1,
            estimatedTokens: 1200,
            method: 'onnara-document-list',
            extractedAt: now,
            structuredData: {
              listName: '온나라 2.0 접수대기함 (받은문서)',
              rows: Array(15).fill(null).map((_, i) => ({ title: `문서 ${i + 1}`, selected: i < 3 })),
              selectedTitles: [
                '2026년도 인공지능 행정업무 시범사업 추진계획 알림',
                '2026년도 지자체 정보화예산 편성 및 집행지침 알림',
                '공공데이터 개방 및 품질진단 지원사업 수요조사 안내',
              ],
            },
          },
        };
      }
      return { type: 'ACTIVE_TAB', tab: sampleTab };
    },
    openOptionsPage() { location.href = '/?view=options'; },
  },
  permissions: {
    async getAll() { return { origins: ['http://localhost:11434/*'] }; },
    async contains() { return false; },
    async request() { return false; },
    async remove() { return false; },
  },
} });

// Explicitly simulated health.
window.fetch = async (input) => {
  const url = String(input);
  const models = [
    { name: 'gemma4:e2b', model: 'gemma4:e2b', capabilities: ['completion', 'tools', 'thinking'] },
    { name: 'bge-m3:latest', model: 'bge-m3:latest', capabilities: ['embedding'] },
  ];
  if (url.endsWith('/api/version')) return Response.json({ version: '0.34.1' });
  if (url.endsWith('/api/tags')) return Response.json({ models });
  if (url.endsWith('/api/ps')) return Response.json({ models: [{ name: 'gemma4:e2b', size_vram: 2800000000 }] });
  throw new Error('문서 미리보기에서는 모델 호출과 외부 요청을 지원하지 않습니다.');
};

const badge = document.createElement('div');
badge.textContent = '사용 설명용 예시 · 온나라 sAIde 실제 UI / 샘플 데이터';
badge.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#0d2f81;color:#fff;text-align:center;font:12px sans-serif;padding:7px;z-index:9999;box-shadow:0 -1px 3px rgba(0,0,0,0.3)';
document.body.append(badge);

if (!mode.startsWith('options') && mode !== 'memory' && mode !== 'presets') {
  document.getElementById('root')!.style.height = 'calc(100% - 30px)';
}

if (mode.startsWith('options') || mode === 'memory' || mode === 'presets') {
  await import('@/entrypoints/options/style.css');
  if (mode === 'memory') {
    const { db } = await import('@/lib/storage/db');
    Object.defineProperty(db.table('pageVectors'), 'toArray', {
      value: async () => sampleMemoryRows,
    });
    const { MemoryPanel } = await import('@/entrypoints/options/MemoryPanel');
    createRoot(document.getElementById('root')!).render(<div className="wrap"><MemoryPanel /></div>);
  } else if (mode === 'presets') {
    const { PresetEditor } = await import('@/entrypoints/options/PresetEditor');
    createRoot(document.getElementById('root')!).render(<div className="wrap"><PresetEditor /></div>);
  } else {
    const { default: OptionsApp } = await import('@/entrypoints/options/OptionsApp');
    createRoot(document.getElementById('root')!).render(<OptionsApp />);
  }

} else {
  await import('@/entrypoints/sidepanel/style.css');

  if (mode === 'automation') {
    localStorage.setItem('saide.view', 'automation');
  } else {
    localStorage.setItem('saide.view', 'ai');
  }

  const { useChat } = await import('@/lib/chat/store');
  const { useAutomation } = await import('@/lib/automation/jobs');

  useAutomation.setState({
    jobs: [
      {
        id: 'job-1',
        kind: 'download-attachments',
        label: '2026년도 인공지능 행정업무 시범사업 추진계획 알림',
        origin: 'automation',
        status: 'done',
        createdAt: now - 60000,
        finishedAt: now - 15000,
        summary: '첨부파일 3건 다운로드 완료',
        files: [
          {
            name: '붙임1_2026_AI행정업무_추진계획.hwp',
            path: 'C:\\Downloads\\붙임1_2026_AI행정업무_추진계획.hwp',
            status: 'complete',
            downloadId: 101,
          },
          {
            name: '붙임2_시범사업_수요조사서_양식.hwpx',
            path: 'C:\\Downloads\\붙임2_시범사업_수요조사서_양식.hwpx',
            status: 'complete',
            downloadId: 102,
          },
          {
            name: '붙임3_보안서약서.pdf',
            path: 'C:\\Downloads\\붙임3_보안서약서.pdf',
            status: 'complete',
            downloadId: 103,
          },
        ],
      },
    ],
  });

  const messages = [
    {
      id: 1,
      conversationId: 1,
      role: 'user' as const,
      content: '/요약 2026년도 인공지능 행정업무 시범사업 추진계획 알림 공문의 핵심 내용과 우리 과 조치사항을 요약해줘.',
      createdAt: now,
    },
    {
      id: 2,
      conversationId: 1,
      role: 'assistant' as const,
      content: `### 📋 [공문 요약] 2026년도 인공지능 행정업무 시범사업 추진계획 알림

**1. 추진 목적 및 배경**
* 행정안전부 디지털정부혁신과 주관 온나라 연계 AI 어시스턴트 도입
* 실무 부서의 공문서 신속 검토, 조치사항 도출 및 대용량 첨부 순차 다운로드 지원

**2. 핵심 조치사항 (우리 과 할 일)**
* **제출 기한**: \`2026-10-15(목) 18:00까지\` *(원문 확인)*
* **제출 서식**: 붙임 2. 시범사업 수요조사서 및 보안서약서 각 1부
* **제출 방법**: 온나라 전자문서 회신 (수신: 디지털정부혁신과)

**3. 문의 및 담당 부서**
* 행정안전부 디지털정부혁신과 (044-205-0000)`,
      createdAt: now + 1,
    },
  ];

  useChat.setState({ openForTab: async () => { useChat.setState({ messages }); } });
  const { default: App } = await import('@/entrypoints/sidepanel/App');
  createRoot(document.getElementById('root')!).render(<App />);

  setTimeout(() => {
    useChat.setState({
      page: {
        ...sampleTab,
        title: '2026년도 인공지능 행정업무 시범사업 추진계획 알림',
        text: '행정안전부 디지털정부혁신과 공문 본문 텍스트 예시입니다.',
        charCount: 3450,
        truncated: false,
        keptRatio: 1,
        estimatedTokens: 1720,
        method: 'onnara-document-list',
        extractedAt: now,
      },
    });

    if (mode === 'approval') {
      useChat.setState({
        pendingApproval: {
          request: {
            action: { kind: 'click', selector: 'table.doc-list tr:first-child a.doc-title' },
            humanDescription: '온나라 접수대기함에서 "2026년도 인공지능 행정업무 시범사업 추진계획 알림" 문서를 임시 백그라운드 탭으로 열어 상세 본문을 확인합니다.',
            targetLabel: '<a> "2026년도 인공지능 행정업무 시범사업 추진계획 알림"',
            pageUrl: sampleTab.url,
            pageTitle: sampleTab.title,
          },
          resolve() {},
        },
      });
    }
  }, 1600);
}
