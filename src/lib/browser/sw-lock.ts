/**
 * 서비스 워커 쪽 작업 탭 잠금.
 *
 * ★ 왜 또 만드는가. 이미 [automation/jobs.ts]에 `workTabLock`이 있지만, 그것은
 *   **사이드패널 문서 안의 잠금**이다(zustand 스토어와 함께 산다). 패널이 닫혀 있을 때
 *   알람이 깨운 브리핑(N1)은 그 잠금을 볼 수 없다. 한쪽은 문서를 읽으려 탭을 복제하고
 *   다른 쪽은 목록을 복원하면, 둘 다 엉뚱한 화면을 읽고 실패한다.
 *
 * ★ 브리핑은 **줄을 서지 않고 물러난다**. 사용자가 지금 첨부를 받는 중이라면 아침
 *   브리핑은 다음 알람에 다시 오면 그만이다. 반대로 사용자의 요청이 브리핑 뒤에서
 *   기다리는 일은 있을 수 있으나, 브리핑에는 짧은 마감을 주어 그 시간을 묶어 둔다.
 */

let tail: Promise<unknown> = Promise.resolve();
let waiting = 0;

/** 지금 작업 탭을 쓰는 일이 있는가. 브리핑은 이때 실행을 미룬다. */
export function isWorkTabBusy(): boolean {
  return waiting > 0;
}

/**
 * 작업 탭·다운로드를 쓰는 동작을 한 번에 하나씩 실행한다.
 *
 * ★ `holdLimitMs`를 주면 그 시간이 지나면 잠금을 놓는다. 페이지에 뜬 확인창이 프레임을 멈추면
 *   `executeScript`가 끝나지 않는데, 그 한 건이 잠금을 쥔 채 남으면 뒤의 `지금 확인`·`넘기기`가
 *   모두 줄에 묶여 "확인 중"에서 풀리지 않는다. 요청 쪽이 이미 포기한 일을 기다릴 이유는 없다.
 */
export function runExclusive<T>(work: () => Promise<T>, holdLimitMs?: number): Promise<T> {
  waiting++;
  const expiresAt = holdLimitMs === undefined ? undefined : Date.now() + Math.max(0, holdLimitMs);
  const result = tail.then(work, work);
  const settled = result.then(() => undefined, () => undefined);
  const held = expiresAt === undefined
    ? settled
    : tail.then(() => Promise.race([settled, new Promise<void>(resolve => setTimeout(resolve, Math.max(0, expiresAt - Date.now())))]));
  tail = held.then(() => { waiting--; });
  return result;
}

/** 시험용. 잠금 상태를 초기로 되돌린다. */
export function resetWorkTabLock(): void {
  tail = Promise.resolve();
  waiting = 0;
}
