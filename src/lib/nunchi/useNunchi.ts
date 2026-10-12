/**
 * 화면에서 쓰는 눈치코치 연결 상태. lib/tongdal/useTongdal.ts와 같은 모양이다.
 *
 * ★ 페어링 전에는 요청을 보내지 않는다. 눈치코치를 쓰지 않는 사용자의 PC에서 매번
 *   127.0.0.1로 연결 실패를 만들 이유가 없다.
 * ★ 상태는 30초마다, 그리고 창이 다시 보일 때 확인한다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getNunchiStatus } from './client';
import { EMPTY_NUNCHI, forgetNunchiToken, isNunchiPaired, loadNunchi, onNunchiChanged, type NunchiConnection } from './connection';
import { judgeNunchi, type NunchiHealth } from './status';

const POLL_MS = 30_000;

export interface UseNunchi {
  connection: NunchiConnection;
  health: NunchiHealth;
  /** 연결 정보를 처음 읽기 전이다. 이때는 아무것도 보이지 않게 한다. */
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useNunchi(): UseNunchi {
  const [connection, setConnection] = useState<NunchiConnection>(EMPTY_NUNCHI);
  const [health, setHealth] = useState<NunchiHealth>(() => judgeNunchi(null, null, false));
  const [loading, setLoading] = useState(true);
  const latest = useRef<NunchiConnection>(EMPTY_NUNCHI);
  const version = useRef(0);

  const check = useCallback(async (current: NunchiConnection) => {
    const mine = ++version.current;
    if (!isNunchiPaired(current)) {
      setHealth(judgeNunchi(null, null, false));
      return;
    }
    try {
      const status = await getNunchiStatus(current);
      if (mine !== version.current) return;
      // 토큰을 보냈는데 모른다면 눈치코치에서 연결을 해제한 것이다. 남겨 두면 모든 요청이 거절된다.
      if (!status.paired) {
        await forgetNunchiToken();
        return;
      }
      setHealth(judgeNunchi(status, null, true));
    } catch (error) {
      if (mine !== version.current) return;
      setHealth(judgeNunchi(null, error, true));
    }
  }, []);

  const refresh = useCallback(() => check(latest.current), [check]);

  useEffect(() => {
    let alive = true;
    void loadNunchi().then(current => {
      if (!alive) return;
      latest.current = current;
      setConnection(current);
      setLoading(false);
      void check(current);
    });
    const off = onNunchiChanged(next => {
      latest.current = next;
      setConnection(next);
      void check(next);
    });
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void check(latest.current); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void check(latest.current); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      off();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check]);

  return { connection, health, loading, refresh };
}
