import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  cancelAutomation,
  clearAutomationHistory,
  enqueueAutomation,
  loadAutomationHistory,
  recordAutomation,
  useAutomation,
  workTabLock,
} from './jobs';

let stored: Record<string, unknown>;

beforeEach(() => {
  stored = {};
  useAutomation.setState({ jobs: [], loaded: false });
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn(async (key: string) => (key in stored ? { [key]: stored[key] } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(stored, items); }),
  } } });
});
afterEach(() => vi.unstubAllGlobals());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

it('작업은 들어온 순서대로 하나씩 실행하고 결과를 기록에 남긴다', async () => {
  const order: string[] = [];
  const first = deferred<void>();
  const a = enqueueAutomation({ kind: 'download-attachments', label: '문서 A', run: async () => { order.push('A 시작'); await first.promise; order.push('A 끝'); return { files: [{ name: 'a.hwpx', status: 'complete', downloadId: 1, path: 'C:\\a.hwpx' }] }; } });
  const b = enqueueAutomation({ kind: 'download-attachments', label: '문서 B', run: async () => { order.push('B 시작'); return { error: { code: 'UNKNOWN', message: '첨부 없음' } }; } });
  await Promise.resolve();
  expect(order).toEqual(['A 시작']);
  expect(useAutomation.getState().jobs.map(job => [job.label, job.status])).toEqual([['문서 B', 'queued'], ['문서 A', 'running']]);
  first.resolve();
  expect((await a.finished).status).toBe('done');
  expect((await b.finished).status).toBe('failed');
  expect(order).toEqual(['A 시작', 'A 끝', 'B 시작']);
  // 패널을 다시 열어도 기록이 남는다.
  useAutomation.setState({ jobs: [], loaded: false });
  await loadAutomationHistory();
  expect(useAutomation.getState().jobs.map(job => job.label)).toEqual(['문서 B', '문서 A']);
  expect(useAutomation.getState().jobs[1]!.files![0]!.path).toBe('C:\\a.hwpx');
});

it('대기 중인 작업은 실행하지 않고 취소하며, 실행 중인 작업에는 중단 신호를 보낸다', async () => {
  const release = deferred<void>();
  let aborted = false;
  const running = enqueueAutomation({ kind: 'download-attachments', label: '실행 중', run: async signal => {
    signal.addEventListener('abort', () => { aborted = true; });
    await release.promise;
    signal.throwIfAborted();
    return {};
  } });
  const queuedRun = vi.fn(async () => ({}));
  const queued = enqueueAutomation({ kind: 'download-attachments', label: '대기', run: queuedRun });
  await Promise.resolve();
  cancelAutomation(queued.id);
  expect((await queued.finished).status).toBe('cancelled');
  cancelAutomation(running.id);
  release.resolve();
  expect((await running.finished).status).toBe('cancelled');
  expect(aborted).toBe(true);
  expect(queuedRun).not.toHaveBeenCalled();
});

it('AI 대화의 문서 읽기와 자동화 작업은 같은 잠금으로 겹치지 않게 실행한다', async () => {
  const events: string[] = [];
  const chatRead = deferred<void>();
  const chat = workTabLock(async () => { events.push('대화 읽기 시작'); await chatRead.promise; events.push('대화 읽기 끝'); });
  const job = enqueueAutomation({ kind: 'download-attachments', label: '문서', run: async () => { events.push('자동화 시작'); return {}; } });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(events).toEqual(['대화 읽기 시작']);
  chatRead.resolve();
  await chat;
  await job.finished;
  expect(events).toEqual(['대화 읽기 시작', '대화 읽기 끝', '자동화 시작']);
});

it('대화에서 실행한 자동화도 기록하고, 기록 지우기는 실행 중인 작업을 남긴다', async () => {
  recordAutomation({ kind: 'download-attachments', label: '대화 문서', files: [{ name: 'x.pdf', status: 'failed', message: '중단' }] });
  const release = deferred<void>();
  const running = enqueueAutomation({ kind: 'download-attachments', label: '진행', run: async () => { await release.promise; return {}; } });
  await Promise.resolve();
  expect(useAutomation.getState().jobs.find(job => job.label === '대화 문서')).toMatchObject({ origin: 'chat', status: 'failed' });
  await clearAutomationHistory();
  expect(useAutomation.getState().jobs.map(job => job.label)).toEqual(['진행']);
  release.resolve();
  await running.finished;
});

/**
 * AI 명령의 큐 이관 (B2).
 *
 * ★ 문서별 분석은 본문 한 건을 읽을 때마다 **안쪽에서** workTabLock을 잡는다. 바깥에서 또 감싸면
 *   바깥 잠금이 풀리기를 안쪽이 기다려 영원히 끝나지 않는다. 이 시험이 그 교착을 막는다.
 */
it('★ lock:false 작업은 안쪽에서 작업 탭 잠금을 써도 끝난다', async () => {
  const steps: string[] = [];
  const job = enqueueAutomation({
    kind: 'summarize', label: '문서 3건', origin: 'chat', lock: false,
    run: async () => {
      for (const title of ['A', 'B', 'C']) {
        await workTabLock(async () => { steps.push(title); });
      }
      return { summary: '문서 3건 분석 완료' };
    },
  });

  const finished = await Promise.race([
    job.finished,
    new Promise(resolve => setTimeout(() => resolve('시간 초과'), 200)),
  ]);

  expect(finished).not.toBe('시간 초과');
  expect(steps).toEqual(['A', 'B', 'C']);
  expect((finished as { summary?: string }).summary).toBe('문서 3건 분석 완료');
});

it('AI 작업도 첨부 다운로드와 같은 줄에 서서 하나씩 실행된다', async () => {
  const order: string[] = [];
  const hold = deferred<void>();
  const download = enqueueAutomation({ kind: 'download-attachments', label: '첨부', run: async () => { order.push('첨부 시작'); await hold.promise; return {}; } });
  const analyze = enqueueAutomation({ kind: 'actions', label: '문서 1건', origin: 'chat', lock: false, run: async () => { order.push('분석 시작'); return { summary: '완료' }; } });

  await Promise.resolve();
  expect(order).toEqual(['첨부 시작']);

  hold.resolve();
  await download.finished;
  await analyze.finished;
  expect(order).toEqual(['첨부 시작', '분석 시작']);
});
