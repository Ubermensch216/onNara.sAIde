/**
 * 임베딩 큐 — 유휴 시간에만 돈다. 계획서 §5 Phase 6-1 주의사항
 *
 * ★ 왜 큐가 필요한가.
 *   16GB 컴퓨터에 `gemma4:e2b`가 6.9GB 상주해 있다. 여기에 `bge-m3`(1.2GB)를
 *   올리면 Ollama가 대화용 모델을 밀어낼 수 있고, 그러면 다음 질문이 콜드
 *   스타트 21초를 다시 문다. 사용자는 "갑자기 느려졌다"고만 느낀다.
 *
 *   그래서 두 가지를 지킨다.
 *     ① 대화 중에는 절대 돌지 않는다 (isBusy)
 *     ② 임베딩은 `keep_alive: '0'` 으로 부른다 — 끝나는 즉시 내려간다
 *
 *   ②가 특히 중요하다. 기본값으로 두면 bge-m3가 몇 분간 상주하며 계속
 *   경합한다. 백그라운드 작업이므로 매번 로드 비용을 무는 편이 낫다.
 *
 * ★ 큐는 메모리에만 둔다.
 *   패널이 닫히면 사라진다. 영속화할 수도 있지만, 못 만든 임베딩은 다음에
 *   그 페이지를 다시 읽을 때 만들면 된다 — 잃어도 되는 종류의 일이다.
 *   저장소에 큐 테이블을 하나 더 두는 값이 이득보다 크다.
 */

import { embed } from '@/lib/ollama/client';
import type { Settings } from '@/lib/storage/settings';
import { chunkText, memoryEpoch, prune, savePage, shouldRemember } from './store';

/** 유휴로 판정하기까지 기다리는 시간. 사용자가 연달아 묻는 흐름을 끊지 않는다. */
export const IDLE_DELAY_MS = 8_000;
/** 큐 상한. 넘치면 오래된 것부터 버린다 — 최신 페이지가 더 쓸모 있다. */
export const MAX_QUEUE = 20;

export interface PendingPage {
  url: string;
  title: string;
  text: string;
}

export interface QueueDeps {
  /** 지금 모델을 쓰고 있는가. true면 한 건도 처리하지 않는다. */
  isBusy: () => boolean;
  getSettings: () => Settings;
  /** 실패를 삼키지 않고 알리고 싶을 때. 화면에 띄우지는 않는다. */
  onError?: (e: unknown) => void;
  /** 한 건 처리 후. 화면 갱신용. */
  onSaved?: (url: string, chunks: number) => void;
}

export function createEmbedQueue(deps: QueueDeps) {
  const pending: Array<PendingPage & { epoch: Promise<number> }> = [];
  let active: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let stopped = false;

  const schedule = (delay = IDLE_DELAY_MS) => {
    if (stopped || timer || !pending.length) return;
    timer = setTimeout(() => {
      timer = null;
      void drain();
    }, delay);
  };

  async function drain(): Promise<void> {
    if (running || stopped) return;
    const s = deps.getSettings();
    if (!s.memoryEnabled) {
      pending.length = 0;
      return;
    }
    // 대화 중이면 손대지 않는다. 조금 뒤에 다시 본다.
    if (deps.isBusy()) return schedule();

    running = true;
    try {
      const item = pending.shift();
      if (!item) return;
      const epoch = await item.epoch;
      if (stopped || epoch !== await memoryEpoch() || !shouldRemember(item.url, deps.getSettings().memoryExcludedDomains)) return;
      active = new AbortController();

      const chunks = chunkText(item.text);
      if (!chunks.length) return;

      // ★ keep_alive 0 — 끝나는 즉시 내려간다. 머리말 ② 참조.
      const vectors = await embed(s.endpoint, s.embedModel, chunks, '0', active.signal);
      if (vectors.length !== chunks.length) {
        throw new Error(`임베딩 개수가 맞지 않는다: ${vectors.length}/${chunks.length}`);
      }

      const saved = await savePage({
        url: item.url,
        title: item.title,
        chunks,
        vectors,
        model: s.embedModel,
      }, epoch, () => !stopped && deps.getSettings().memoryEnabled && shouldRemember(item.url, deps.getSettings().memoryExcludedDomains));
      if (saved) deps.onSaved?.(item.url, saved);
    } catch (e) {
      deps.onError?.(e);
    } finally {
      running = false;
      active = null;
      // 남은 것이 있으면 이어서. 연달아 돌리되 사이를 벌린다.
      schedule();
    }
  }

  return {
    /**
     * 페이지 하나를 큐에 넣는다. 저장 대상이 아니면 조용히 버린다.
     * 판정은 여기서 한 번, 저장 직전에 한 번 더 하지 않는다 — 큐에 들어간
     * 시점의 설정을 따르는 편이 사용자 기대에 가깝다.
     */
    enqueue(page: PendingPage): boolean {
      const s = deps.getSettings();
      if (!s.memoryEnabled) return false;
      if (!shouldRemember(page.url, s.memoryExcludedDomains)) return false;
      if (!page.text.trim()) return false;

      // 같은 URL이 이미 대기 중이면 최신 것으로 바꾼다.
      const i = pending.findIndex((p) => p.url === page.url);
      if (i >= 0) pending.splice(i, 1);

      const epoch = memoryEpoch();
      void epoch.catch(() => undefined);
      pending.push({ ...page, epoch });
      while (pending.length > MAX_QUEUE) pending.shift();
      schedule();
      return true;
    },

    /** 보관 기간 청소. 패널이 열릴 때 한 번 부른다. */
    async sweep(): Promise<number> {
      const s = deps.getSettings();
      if (!s.memoryEnabled) return 0;
      return prune(s.memoryRetentionDays);
    },

    /** 테스트와 종료용. */
    size: () => pending.length,
    stop() {
      stopped = true;
      active?.abort();
      if (timer) clearTimeout(timer);
      timer = null;
      pending.length = 0;
    },
    /** 테스트에서 기다리지 않고 돌리기 위한 문. */
    drainNow: drain,
  };
}

export type EmbedQueue = ReturnType<typeof createEmbedQueue>;
