/**
 * 화면에서 쓰는 TONGDAL.ai 연결 상태.
 *
 * ★ 페어링 전에는 요청을 보내지 않는다. TONGDAL을 쓰지 않는 사용자의 PC에서 매번
 *   127.0.0.1로 연결 실패를 만들 이유가 없다.
 * ★ 상태는 30초마다, 그리고 창이 다시 보일 때 확인한다. TONGDAL을 켜고 끄는 일은 사용자가
 *   이 패널 밖에서 하므로, 버튼을 누르기 전에 화면이 이미 맞는 상태여야 한다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getStatus } from './client';
import { EMPTY_CONNECTION, forgetToken, isPaired, loadConnection, onConnectionChanged, type TongdalConnection } from './connection';
import { judgeStatus, type TongdalHealth } from './status';

const POLL_MS = 30_000;

export interface UseTongdal {
  connection: TongdalConnection;
  health: TongdalHealth;
  /** 연결 정보를 처음 읽기 전이다. 이때는 아무것도 보이지 않게 한다. */
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useTongdal(): UseTongdal {
  const [connection, setConnection] = useState<TongdalConnection>(EMPTY_CONNECTION);
  const [health, setHealth] = useState<TongdalHealth>(() => judgeStatus(null, null, false));
  const [loading, setLoading] = useState(true);
  const latest = useRef<TongdalConnection>(EMPTY_CONNECTION);
  const version = useRef(0);

  const check = useCallback(async (current: TongdalConnection) => {
    const mine = ++version.current;
    if (!isPaired(current)) {
      setHealth(judgeStatus(null, null, false));
      return;
    }
    try {
      const status = await getStatus(current);
      if (mine !== version.current) return;
      // 토큰을 보냈는데 모른다면 TONGDAL에서 연결을 해제한 것이다. 남겨 두면 모든 요청이 거절된다.
      if (!status.paired) {
        await forgetToken();
        return;
      }
      setHealth(judgeStatus(status, null, true));
    } catch (error) {
      if (mine !== version.current) return;
      setHealth(judgeStatus(null, error, true));
    }
  }, []);

  const refresh = useCallback(() => check(latest.current), [check]);

  useEffect(() => {
    let alive = true;
    void loadConnection().then(current => {
      if (!alive) return;
      latest.current = current;
      setConnection(current);
      setLoading(false);
      void check(current);
    });
    const off = onConnectionChanged(next => {
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
