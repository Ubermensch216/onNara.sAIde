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

export type AutomationKind = 'download-attachments';
const KINDS: readonly string[] = ['download-attachments'] satisfies AutomationKind[];
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

interface AutomationState {
  jobs: AutomationJob[];
  loaded: boolean;
}

const HISTORY_KEY = 'saide.automationHistory';
const HISTORY_LIMIT = 50;

export const useAutomation = create<AutomationState>(() => ({ jobs: [], loaded: false }));

const runners = new Map<string, { run: Runner; controller: AbortController; done: (job: AutomationJob) => void }>();
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
export function enqueueAutomation(spec: { kind: AutomationKind; label: string; origin?: 'automation' | 'chat'; run: Runner }): { id: string; finished: Promise<AutomationJob> } {
  const job: AutomationJob = {
    id: crypto.randomUUID(), kind: spec.kind, label: spec.label, origin: spec.origin ?? 'automation',
    status: 'queued', createdAt: Date.now(),
  };
  const finished = new Promise<AutomationJob>(resolve => {
    runners.set(job.id, { run: spec.run, controller: new AbortController(), done: resolve });
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
      try {
        outcome = await workTabLock(() => entry.controller.signal.aborted
          ? Promise.resolve<JobOutcome>({ error: { code: 'ABORTED', message: '작업을 취소했습니다.' } })
          : entry.run(entry.controller.signal));
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
