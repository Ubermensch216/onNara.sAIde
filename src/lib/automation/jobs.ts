/**
 * 자동화(RPA) 작업 대기열과 실행 기록.
 *
 * ★ AI 기능과 달리 결과가 "실제로 일어난 일"이다. 그래서 대화 말풍선이 아니라
 *   작업 단위로 상태·파일·실패 사유를 남기고, 패널을 다시 열어도 기록을 보여 준다.
 *
 * ★ 온나라 작업 탭과 브라우저 다운로드는 동시에 두 작업이 만지면 서로 꼬인다.
 *   자동화 탭의 작업과 AI 대화 안의 문서 읽기가 모두 workTabLock을 거쳐 한 번에 하나씩 실행된다.
 */

import { create } from 'zustand';
import type { AppError, AttachmentDownloadResult } from '@/lib/messaging/protocol';

/**
 * 작업 종류.
 *
 * ★ `summarize`·`actions`는 AI 명령이다(B2). 대화 말풍선으로만 흐르던 것을 여기에 올린 이유는
 *   셋이다 — ① 첨부 다운로드와 같은 대기열에서 순서가 정해지고 ② 도구 탭에서 진행·취소가
 *   보이며 ③ 패널을 다시 열어도 "언제 무엇을 분석했는지"가 남는다.
 */
export type AutomationKind = 'download-attachments' | 'download-body' | 'download-all' | 'summarize' | 'actions';
const KINDS: readonly string[] = ['download-attachments', 'download-body', 'download-all', 'summarize', 'actions'] satisfies AutomationKind[];
export type AutomationStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface AutomationJob {
  id: string;
  kind: AutomationKind;
  /** 대상 문서 제목이나 화면 이름 */
  label: string;
  /** 자동화 탭에서 실행했는가, AI 대화 요청에 포함돼 실행됐는가 */
  origin: 'automation' | 'chat';
  status: AutomationStatus;
  createdAt: number;
  finishedAt?: number;
  files?: AttachmentDownloadResult[];
  error?: AppError;
  /** 파일 목록으로 표현되지 않는 결과 한 줄 */
  summary?: string;
}

export interface JobOutcome {
  files?: AttachmentDownloadResult[];
  error?: AppError;
  summary?: string;
}

type Runner = (signal: AbortSignal) => Promise<JobOutcome>;

/**
 * 도구 탭이 열릴 때 짚을 작업.
 *
 * ★ 답변 안의 링크를 눌렀을 때에만 채워진다. 첨부 받기를 실행했다고 화면을 옮기지 않는다 —
 *   사용자는 AI 창에서 다음 지시를 잇는 중이다(lib/panel/links.ts).
 */
export interface AutomationFocus {
  jobId: string;
  /** 같은 작업을 두 번 눌러도 화면이 반응하게 하는 일련번호. */
  at: number;
}

interface AutomationState {
  jobs: AutomationJob[];
  loaded: boolean;
  focus: AutomationFocus | null;
}

const HISTORY_KEY = 'saide.automationHistory';
const HISTORY_LIMIT = 50;

export const useAutomation = create<AutomationState>(() => ({ jobs: [], loaded: false, focus: null }));

/** 도구 탭에서 이 작업을 짚어 달라고 남긴다. 탭 전환 자체는 화면(App)이 한다. */
export function focusJob(jobId: string): void {
  useAutomation.setState({ focus: { jobId, at: Date.now() } });
}

/** 반영했다. 다음 지시가 올 때까지 비워 둔다. */
export function clearJobFocus(): void {
  if (useAutomation.getState().focus) useAutomation.setState({ focus: null });
}

const runners = new Map<string, { run: Runner; controller: AbortController; done: (job: AutomationJob) => void; lock: boolean }>();
let draining = false;

/* ── 작업 탭 잠금 ─────────────────────────────────────── */

let lockTail: Promise<unknown> = Promise.resolve();

/** 온나라 작업 탭·다운로드를 쓰는 동작을 한 번에 하나씩 실행한다. */
export function workTabLock<T>(work: () => Promise<T>): Promise<T> {
  const result = lockTail.then(work, work);
  lockTail = result.then(() => undefined, () => undefined);
  return result;
}

/* ── 기록 ─────────────────────────────────────────────── */

export async function loadAutomationHistory(): Promise<void> {
  try {
    const stored = (await chrome.storage.local.get(HISTORY_KEY))[HISTORY_KEY] as AutomationJob[] | undefined;
    const live = useAutomation.getState().jobs;
    const ids = new Set(live.map(job => job.id));
    // 없앤 작업 종류(예: 목록 내보내기)의 옛 기록은 표시할 이름이 없으므로 버린다.
    const known = (stored ?? []).filter(job => KINDS.includes(job.kind) && !ids.has(job.id));
    useAutomation.setState({ jobs: [...live, ...known], loaded: true });
  } catch {
    useAutomation.setState({ loaded: true });
  }
}

async function persist(): Promise<void> {
  const finished = useAutomation.getState().jobs.filter(job => job.status !== 'queued' && job.status !== 'running').slice(0, HISTORY_LIMIT);
  try { await chrome.storage.local.set({ [HISTORY_KEY]: finished }); } catch { /* 저장소 없음: 기록은 이번 세션에만 남는다 */ }
}

function update(id: string, patch: Partial<AutomationJob>): AutomationJob | undefined {
  let next: AutomationJob | undefined;
  useAutomation.setState(state => ({
    jobs: state.jobs.map(job => job.id === id ? (next = { ...job, ...patch }) : job),
  }));
  return next;
}

export async function clearAutomationHistory(): Promise<void> {
  useAutomation.setState(state => ({ jobs: state.jobs.filter(job => job.status === 'queued' || job.status === 'running') }));
  await persist();
}

/** AI 대화 안에서 이미 실행한 자동화 결과를 기록에 남긴다. */
export function recordAutomation(entry: { kind: AutomationKind; label: string } & JobOutcome): AutomationJob {
  const job: AutomationJob = {
    id: crypto.randomUUID(), kind: entry.kind, label: entry.label, origin: 'chat', createdAt: Date.now(), finishedAt: Date.now(),
    status: statusOf(entry), ...pick(entry),
  };
  useAutomation.setState(state => ({ jobs: [job, ...state.jobs] }));
  void persist();
  return job;
}

function statusOf(outcome: JobOutcome): AutomationStatus {
  if (outcome.error) return outcome.error.code === 'ABORTED' ? 'cancelled' : 'failed';
  const files = outcome.files ?? [];
  return files.length && files.every(file => file.status === 'failed' || file.status === 'not_started') ? 'failed' : 'done';
}

function pick(outcome: JobOutcome): JobOutcome {
  return {
    ...(outcome.files ? { files: outcome.files } : {}),
    ...(outcome.error ? { error: outcome.error } : {}),
    ...(outcome.summary ? { summary: outcome.summary } : {}),
  };
}

/* ── 대기열 ───────────────────────────────────────────── */

/**
 * 작업을 대기열에 넣고, 끝나면(성공·실패·취소 모두) 최종 상태로 resolve한다.
 * 실행 함수가 던진 예외도 실패 기록으로 바꾼다.
 */
export function enqueueAutomation(spec: {
  kind: AutomationKind; label: string; origin?: 'automation' | 'chat'; run: Runner;
  /**
   * 실행 전체를 작업 탭 잠금으로 감쌀지. 기본은 감싼다.
   *
   * ★ false로 두는 경우: 실행 함수가 **안쪽에서 이미** workTabLock을 쓸 때다.
   *   문서별 AI 분석(B2)이 그렇다 — 문서 한 건을 읽을 때마다 잠그고 놓는다.
   *   여기서 또 감싸면 바깥 잠금이 풀리기를 안쪽이 기다려 교착에 빠진다.
   */
  lock?: boolean;
}): { id: string; finished: Promise<AutomationJob> } {
  const job: AutomationJob = {
    id: crypto.randomUUID(), kind: spec.kind, label: spec.label, origin: spec.origin ?? 'automation',
    status: 'queued', createdAt: Date.now(),
  };
  const finished = new Promise<AutomationJob>(resolve => {
    runners.set(job.id, { run: spec.run, controller: new AbortController(), done: resolve, lock: spec.lock ?? true });
  });
  useAutomation.setState(state => ({ jobs: [job, ...state.jobs] }));
  void drain();
  return { id: job.id, finished };
}

export function cancelAutomation(id: string): void {
  const entry = runners.get(id);
  const job = useAutomation.getState().jobs.find(item => item.id === id);
  if (!entry || !job) return;
  entry.controller.abort();
  if (job.status === 'queued') finish(id, { error: { code: 'ABORTED', message: '실행 전에 취소했습니다.' } });
}

function finish(id: string, outcome: JobOutcome): void {
  const entry = runners.get(id);
  runners.delete(id);
  const job = update(id, { status: statusOf(outcome), finishedAt: Date.now(), ...pick(outcome) });
  void persist();
  if (entry && job) entry.done(job);
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      // 먼저 들어온 작업부터 실행한다(목록은 최신순으로 쌓인다).
      const next = [...useAutomation.getState().jobs].reverse().find(job => job.status === 'queued' && runners.has(job.id));
      if (!next) return;
      const entry = runners.get(next.id)!;
      update(next.id, { status: 'running' });
      let outcome: JobOutcome;
      const start = () => entry.controller.signal.aborted
        ? Promise.resolve<JobOutcome>({ error: { code: 'ABORTED', message: '작업을 취소했습니다.' } })
        : entry.run(entry.controller.signal);
      try {
        outcome = entry.lock ? await workTabLock(start) : await start();
      } catch (error) {
        outcome = entry.controller.signal.aborted
          ? { error: { code: 'ABORTED', message: '작업을 취소했습니다.' } }
          : { error: { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) } };
      }
      finish(next.id, outcome);
    }
  } finally {
    draining = false;
  }
}
