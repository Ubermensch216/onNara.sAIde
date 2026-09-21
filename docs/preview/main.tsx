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

/** 브리핑 설정 화면의 "보관 현황" 수치를 만들기 위한 표본. */
const briefingSettingsDocs = Array.from({ length: 38 }, (_, i) => ({
  key: `doc-${i}`,
  briefedAt: i < 26 ? now - i * 3600000 : undefined,
  firstSeenAt: now - i * 86400000,
}));

const data: Record<string, unknown> = {
  'saide.settings': {
    ...DEFAULT_SETTINGS,
    theme: 'light',
    locale: 'ko',
    warmupOnOpen: false,
    briefingEnabled: true,
    model: 'gemma4:e2b',
    endpoint: 'http://localhost:11434',
    numCtx: 4096,
  },
  'saide.presets': samplePresets,
  'saide.onboardingSeen': 1,
  'saide.inboxLocation': {
    location: {
      url: 'https://onnara.saas.gcloud.go.kr/bms/dctshr/act_rcv.do',
      framePath: [0],
      listName: '공유/공람 > 받은문서',
      form: { searchPeriod: '1M', searchGubun: 'all' },
    },
    listName: '공유/공람 > 받은문서',
    origin: 'https://onnara.saas.gcloud.go.kr',
    savedAt: now - 86400000 * 3,
  },
  'saide.lastBackupAt': now - 86400000 * 5,
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

const OPTION_VIEWS = ['memory', 'presets', 'briefing'];
if (!mode.startsWith('options') && !OPTION_VIEWS.includes(mode)) {
  document.getElementById('root')!.style.height = 'calc(100% - 30px)';
}

if (mode.startsWith('options') || OPTION_VIEWS.includes(mode)) {
  await import('@/entrypoints/options/style.css');
  if (mode === 'memory') {
    const { db } = await import('@/lib/storage/db');
    Object.defineProperty(db.table('pageVectors'), 'toArray', {
      value: async () => sampleMemoryRows,
    });
    const { MemoryPanel } = await import('@/entrypoints/options/MemoryPanel');
    createRoot(document.getElementById('root')!).render(<div className="wrap"><MemoryPanel /></div>);
  } else if (mode === 'briefing') {
    const { db } = await import('@/lib/storage/db');
    Object.defineProperty(db.inboxDocs, 'toArray', { value: async () => briefingSettingsDocs });
    const { InboxSettings } = await import('@/entrypoints/options/InboxSettings');
    const { DEFAULT_SETTINGS: base } = await import('@/lib/storage/settings');
    type SettingsShape = typeof base;
    function BriefingSettingsDemo() {
      const [s, setS] = React.useState<SettingsShape>({
        ...base,
        briefingEnabled: true,
        briefingScope: 'keywords',
        briefingKeywords: ['정보화', '예산', '인공지능', '수요조사'],
        briefingExcludeKeywords: ['동호회', '경조사'],
      });
      return <InboxSettings s={s} patch={next => setS(prev => ({ ...prev, ...next }))} />;
    }
    createRoot(document.getElementById('root')!).render(<div className="wrap"><BriefingSettingsDemo /></div>);
  } else if (mode === 'presets') {
    const { PresetEditor } = await import('@/entrypoints/options/PresetEditor');
    createRoot(document.getElementById('root')!).render(<div className="wrap"><PresetEditor /></div>);
  } else {
    const { default: OptionsApp } = await import('@/entrypoints/options/OptionsApp');
    createRoot(document.getElementById('root')!).render(<OptionsApp />);
  }

} else {
  await import('@/entrypoints/sidepanel/style.css');

  const sampleScheduleTasks = [
    {
      id: 1,
      title: '시범사업 수요조사서 및 보안서약서 제출',
      status: 'todo' as const,
      dueDate: '2026-09-22',
      due: { date: '2026-09-22', time: '18:00', text: '2026-09-22(화) 18:00까지', yearInferred: false },
      evidence: '제출 서식: 붙임 2. 시범사업 수요조사서 및 보안서약서 각 1부 (2026-09-22까지)',
      evidenceVerified: true,
      deliverables: ['시범사업 수요조사서 1부', '보안서약서 1부'],
      contact: '행정안전부 디지털정부혁신과 (044-205-0000)',
      source: {
        docTitle: '2026년도 인공지능 행정업무 시범사업 추진계획 알림',
        docUrl: sampleTab.url,
        conversationId: 1,
      },
      dedupeKey: '2026년도 인공지능 행정업무 시범사업 추진계획 알림::시범사업 수요조사서 및 보안서약서 제출',
      createdAt: now - 86400000,
      updatedAt: now - 86400000,
    },
    {
      id: 2,
      title: '온나라 AI 연계 지침 개정안 부서 검토의견 제출',
      status: 'todo' as const,
      dueDate: '2026-09-18',
      due: { date: '2026-09-18', time: '18:00', text: '2026-09-18 18:00한', yearInferred: false },
      evidence: '온나라 AI 연계 지침 검토의견 제출 (2026-09-18한)',
      evidenceVerified: true,
      contact: '행정안전부 정보화기반과',
      source: {
        docTitle: '온나라 연계 AI 어시스턴트 보안관리지침(안) 알림',
        conversationId: 2,
      },
      dedupeKey: '온나라 연계 AI 어시스턴트 보안관리지침(안) 알림::온나라 AI 연계 지침 개정안 부서 검토의견 제출',
      createdAt: now - 86400000 * 2,
      updatedAt: now - 86400000,
    },
    {
      id: 3,
      title: '지자체 정보화예산 집행현황 3분기 제출',
      status: 'todo' as const,
      dueDate: '2026-09-25',
      due: { date: '2026-09-25', time: '17:00', text: '2026-09-25 17:00한', yearInferred: false },
      evidence: '각 지자체는 3분기 정보화예산 집행내역을 2026년 9월 25일까지 온나라 시스템으로 회신 바랍니다.',
      evidenceVerified: true,
      deliverables: ['3분기 정보화예산 집행현황 서식'],
      contact: '행정안전부 지역정보화지원과 (044-205-1111)',
      source: {
        docTitle: '2026년도 지자체 정보화예산 편성 및 집행지침 알림',
        conversationId: 3,
      },
      dedupeKey: '2026년도 지자체 정보화예산 편성 및 집행지침 알림::지자체 정보화예산 집행현황 3분기 제출',
      createdAt: now - 43200000,
      updatedAt: now - 43200000,
    },
    {
      id: 4,
      title: '공공부문 클라우드 네이티브 전환 2차 수요 피드백 회신',
      status: 'todo' as const,
      dueDate: '2026-09-15',
      due: { date: '2026-09-15', text: '2026-09-15까지', yearInferred: false },
      evidence: '수요조사 2차 피드백 9월 15일까지 제출 요망',
      evidenceVerified: true,
      source: {
        docTitle: '공공부문 클라우드 네이티브 전환 2차 안내',
        conversationId: 4,
      },
      dedupeKey: '공공부문 클라우드 네이티브 전환 2차 안내::공공부문 클라우드 네이티브 전환 2차 수요 피드백 회신',
      createdAt: now - 86400000 * 6,
      updatedAt: now - 86400000 * 3,
    },
    {
      id: 5,
      title: '인공지능 윤리 가이드라인 부서 의견 수렴',
      status: 'todo' as const,
      dueDate: '',
      evidence: '가이드라인 개정안에 대해 의견이 있는 부서는 수시 제출',
      evidenceVerified: false,
      source: {
        docTitle: '공공분야 AI 윤리 가이드라인 제정 의견수렴',
        conversationId: 5,
      },
      dedupeKey: '공공분야 AI 윤리 가이드라인 제정 의견수렴::인공지능 윤리 가이드라인 부서 의견 수렴',
      createdAt: now - 86400000,
      updatedAt: now - 86400000,
    },
  ];

  /** 공유/공람 브리핑(N1) 표본. 전부 목록 표에서 읽은 값이다 — 본문은 열지 않는다. */
  const day = (n: number) => new Date(now - n * 86400000).toISOString().slice(0, 10);
  const sampleInboxDocs = [
    {
      key: 'inbox-1', group: 'g1',
      title: '2026년도 인공지능 행정업무 시범사업 수요조사 제출(9. 22.까지)',
      reportDate: day(1), sender: '행정안전부 디지털정부혁신과', department: '기획예산담당관',
      hasAttachment: true, readState: 'unread' as const,
      category: 'deadline' as const, reason: '제목에서 기한 “9. 22.”을 찾았습니다',
      due: { date: '2026-09-22', text: '9. 22.까지', yearInferred: true },
      dueDate: '2026-09-22', classifier: 'rule' as const,
      firstSeenAt: now - 3600000, lastSeenAt: now - 3600000, briefedAt: now - 3600000,
    },
    {
      key: 'inbox-2', group: 'g2',
      title: '지자체 정보화예산 3분기 집행현황 회신 요청',
      reportDate: day(1), sender: '행정안전부 지역정보화지원과', department: '정보통신과',
      hasAttachment: true, readState: 'unread' as const,
      category: 'deadline' as const, reason: '제목에서 기한 “9. 25.”을 찾았습니다',
      due: { date: '2026-09-25', text: '9. 25.한', yearInferred: true },
      dueDate: '2026-09-25', classifier: 'rule' as const,
      firstSeenAt: now - 7200000, lastSeenAt: now - 7200000, briefedAt: now - 7200000,
    },
    {
      key: 'inbox-3', group: 'g3',
      title: '온나라 연계 AI 어시스턴트 보안관리지침(안) 부서 의견조회',
      reportDate: day(2), sender: '행정안전부 정보화기반과', department: '정보통신과',
      hasAttachment: true, readState: 'unread' as const,
      category: 'mine' as const, reason: '관심 키워드 “정보화”와 조치를 요구하는 말(“의견조회”)이 있습니다',
      dueDate: '', classifier: 'rule' as const,
      firstSeenAt: now - 86400000, lastSeenAt: now - 86400000, briefedAt: now - 86400000,
    },
    {
      key: 'inbox-4', group: 'g4',
      title: '공공데이터 개방 품질진단 지원사업 설명회 개최 알림',
      reportDate: day(2), sender: '디지털플랫폼정부위원회', department: '기획예산담당관',
      hasAttachment: false, readState: 'unread' as const,
      category: 'notice' as const, reason: '기한도 조치 요구도 없어 공람으로 보았습니다',
      dueDate: '', classifier: 'model' as const,
      firstSeenAt: now - 86400000 * 2, lastSeenAt: now - 86400000 * 2, briefedAt: now - 86400000 * 2,
    },
    {
      key: 'inbox-5', group: 'g5',
      title: '직장 동호회 가을 체육행사 참가 신청 안내',
      reportDate: day(3), sender: '운영지원과', department: '운영지원과',
      hasAttachment: false, readState: 'read' as const,
      category: 'filtered' as const, reason: '제외 키워드 “동호회”에 걸려 범위 밖으로 두었습니다',
      dueDate: '', classifier: 'rule' as const,
      firstSeenAt: now - 86400000 * 3, lastSeenAt: now - 86400000 * 3,
    },
  ];

  const sampleInboxRun = {
    id: 1, at: now - 3600000, trigger: 'alarm' as const,
    scanned: 12, added: 4, briefed: 4, filtered: 1, readStateChanged: 0,
  };

  if (mode === 'automation') {
    localStorage.setItem('saide.view', 'automation');
  } else if (mode === 'schedule') {
    localStorage.setItem('saide.view', 'schedule');
    localStorage.setItem('saide.scheduleMode', 'month');
  } else if (mode === 'inbox') {
    localStorage.setItem('saide.view', 'inbox');
  } else {
    localStorage.setItem('saide.view', 'ai');
  }

  const { db } = await import('@/lib/storage/db');
  Object.defineProperty(db.table('tasks'), 'toArray', {
    value: async () => sampleScheduleTasks,
  });

  /** Dexie 질의 사슬(orderBy().reverse().limit().toArray())을 그대로 흉내 낸다. */
  const rowsOf = <T,>(rows: T[]) => {
    const chain = { reverse: () => chain, limit: () => chain, toArray: async () => rows };
    return () => chain;
  };
  Object.defineProperty(db.inboxDocs, 'orderBy', { value: rowsOf(sampleInboxDocs) });
  Object.defineProperty(db.inboxRuns, 'orderBy', { value: rowsOf([sampleInboxRun]) });

  const { useInbox } = await import('@/lib/inbox/panel');
  useInbox.setState({
    briefing: {
      at: sampleInboxRun.at,
      listName: '공유/공람 > 받은문서',
      trigger: 'alarm',
      scanned: 12,
      added: 4,
      filtered: 1,
      groups: (['deadline', 'mine', 'notice'] as const)
        .map(category => ({ category, docs: sampleInboxDocs.filter(doc => doc.category === category) }))
        .filter(group => group.docs.length > 0),
      readState: { unread: 11, read: 1, unknown: 0, changed: 0 },
    },
  });
  const { useSchedule } = await import('@/lib/schedule/store');
  useSchedule.setState({ tasks: sampleScheduleTasks, loaded: true });

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
* **제출 기한**: \`2026-09-22(화) 18:00까지\` *(원문 확인)*
* **제출 서식**: 붙임 2. 시범사업 수요조사서 및 보안서약서 각 1부
* **제출 방법**: 온나라 전자문서 회신 (수신: 디지털정부혁신과)

**3. 문의 및 담당 부서**
* 행정안전부 디지털정부혁신과 (044-205-0000)`,
      taskCandidates: [
        {
          title: '시범사업 수요조사서 및 보안서약서 제출',
          due: { date: '2026-09-22', time: '18:00', text: '2026-09-22(화) 18:00까지', yearInferred: false },
          evidence: '제출 서식: 붙임 2. 시범사업 수요조사서 및 보안서약서 각 1부 (2026-09-22까지)',
          evidenceVerified: true,
          deliverables: ['시범사업 수요조사서 1부', '보안서약서 1부'],
          contact: '행정안전부 디지털정부혁신과 (044-205-0000)',
        },
      ],
      sourceDoc: {
        title: '2026년도 인공지능 행정업무 시범사업 추진계획 알림',
        url: sampleTab.url,
      },
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
