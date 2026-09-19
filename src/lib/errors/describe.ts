/**
 * 오류 코드 → 사용자 화면 문구. 계획서 §5 Phase 7-2 (완료 기준: ErrorCode 전 종류 UI 확인)
 *
 * ★ 왜 한곳에 모으는가.
 *   오류 문구가 발생 지점마다 흩어져 있으면 어떤 코드가 화면에 어떻게 보이는지
 *   아무도 전수 확인할 수 없다. 실제로 `ACTION_DENIED`와 `OOM`은 Phase 5까지
 *   화면 문구가 아예 없었다 — 배너에 원문 메시지가 그대로 떨어졌다.
 *
 * ★ 세 가지를 반드시 채운다.
 *   ① 무슨 일이 일어났는지 (title)
 *   ② 왜 그런지 (body) — 사용자가 자기 잘못인지 판단할 수 있어야 한다
 *   ③ 무엇을 하면 되는지 (fix / command / retry) — 없으면 넣지 않는다.
 *      "다시 시도하세요"만 적는 것은 도움이 아니라 소음이다.
 *
 * ★ 이 파일의 switch는 **빠짐없이** 다뤄야 한다. 새 ErrorCode를 추가하면
 *   never 검사에서 컴파일이 깨진다 — 문구를 잊고 배포하는 경로를 막는다.
 */

import type { AppError, ErrorCode } from '@/lib/messaging/protocol';
import { CORS_COMMAND, pullCommand } from '@/lib/ollama/errors';
import { t } from '@/lib/i18n';

export type Severity =
  /** 사용자가 뭔가 해야 풀린다 */
  | 'blocked'
  /** 이번 요청만 실패했다. 다시 하면 될 수도 있다 */
  | 'failed'
  /** 오류가 아니라 정상 흐름 */
  | 'info';

export interface ErrorPresentation {
  code: ErrorCode;
  severity: Severity;
  title: string;
  body: string;
  /** 복사 버튼과 함께 보여줄 명령. */
  command?: string;
  /** 버튼으로 걸 동작의 종류. UI가 실제 핸들러를 붙인다. */
  action?: 'retry' | 'grant-host' | 'grant-all' | 'open-settings';
  actionLabel?: string;
  /** 배너를 아예 띄우지 않는다(중단 등). */
  silent?: boolean;
}

export function presentError(e: AppError, model = ''): ErrorPresentation {
  const base = { code: e.code };

  switch (e.code) {
    case 'OLLAMA_DOWN':
      return {
        ...base,
        severity: 'blocked',
        title: t('err.down.title'),
        body: t('err.down.body'),
        action: 'retry',
        actionLabel: t('ui.retry'),
      };

    case 'CORS_BLOCKED':
      return {
        ...base,
        severity: 'blocked',
        title: t('err.cors.title'),
        body: t('err.cors.body'),
        command: CORS_COMMAND,
        action: 'retry',
        actionLabel: t('ui.retry'),
      };

    case 'MODEL_MISSING':
      return {
        ...base,
        severity: 'blocked',
        title: model ? t('err.model.title', { model }) : t('err.model.titleGeneric'),
        body: t('err.model.body'),
        command: pullCommand(model || 'gemma4:e2b'),
        action: 'retry',
        actionLabel: t('ui.retry'),
      };

    case 'OOM':
      return {
        ...base,
        severity: 'blocked',
        title: t('err.oom.title'),
        // 16GB에 6.9GB 상주가 전제다. 무엇을 줄여야 하는지까지 알려준다.
        body: t('err.oom.body'),
        action: 'open-settings',
        actionLabel: t('ui.openSettings'),
      };

    case 'TIMEOUT':
      return {
        ...base,
        severity: 'failed',
        title: t('err.timeout.title'),
        body: t('err.timeout.body'),
        action: 'open-settings',
        actionLabel: t('ui.openSettings'),
      };

    case 'ABORTED':
      // 사용자가 스스로 멈춘 것이다. 오류로 보여주면 자기가 뭘 잘못한 줄 안다.
      return {
        ...base,
        severity: 'info',
        title: t('err.aborted.title'),
        body: '',
        silent: true,
      };

    case 'TAB_RESTRICTED':
      return {
        ...base,
        severity: 'failed',
        title: t('err.restricted.title'),
        body: t('err.restricted.body'),
      };

    case 'HOST_PERMISSION_REQUIRED':
      return {
        ...base,
        severity: 'blocked',
        title: t('err.hostPerm.title'),
        // 다른 주소의 권한이 필요하면 어떤 주소인지 보여 준다. 기본 문구만으로는 이미 허용한 사이트와 구분되지 않는다.
        body: e.origins?.length ? `${e.message} ${e.hint ?? ''}`.trim() : t('err.hostPerm.body'),
        action: 'grant-host',
        actionLabel: t('ui.grantPermission'),
      };

    case 'ACTION_DENIED':
      return {
        ...base,
        severity: 'info',
        title: t('err.denied.title'),
        body: e.message || t('err.denied.body'),
      };

    case 'MEMORY_OFF':
      return {
        ...base,
        severity: 'blocked',
        title: t('err.memoryOff.title'),
        body: t('err.memoryOff.body'),
        action: 'open-settings',
        actionLabel: t('ui.openSettings'),
      };

    case 'MEMORY_QUERY_REQUIRED':
      // 오류가 아니라 명령이 덜 완성된 것이다. 무엇을 덧붙이면 되는지만 알린다.
      return {
        ...base,
        severity: 'info',
        title: t('err.memoryQuery.title'),
        body: t('err.memoryQuery.body'),
      };

    case 'SCHEDULE_INPUT_REQUIRED':
      // 명령 이름만 쳤다. 문법이 아니라 예문을 보여 준다 — 외울 문법이 없는 명령이다.
      return {
        ...base,
        severity: 'info',
        title: t('err.scheduleInput.title'),
        body: t('err.scheduleInput.body'),
      };

    case 'UNKNOWN':
      return {
        ...base,
        severity: 'failed',
        title: t('err.unknown.title'),
        // 원문을 감추지 않는다. 우리가 분류하지 못한 오류라 이게 유일한 단서다.
        body: e.hint ? `${e.message} ${e.hint}` : e.message || t('err.unknown.body'),
      };
  }

  // 새 ErrorCode를 추가하고 문구를 빠뜨리면 여기서 컴파일이 깨진다.
  return assertNever(e.code);
}

function assertNever(code: never): never {
  throw new Error(`문구가 정의되지 않은 오류 코드: ${String(code)}`);
}

/** 화면 문구가 정해져 있는 전체 코드 목록. 테스트와 설정 화면 점검에 쓴다. */
export const ALL_ERROR_CODES: ErrorCode[] = [
  'OLLAMA_DOWN',
  'MODEL_MISSING',
  'CORS_BLOCKED',
  'OOM',
  'TIMEOUT',
  'ABORTED',
  'TAB_RESTRICTED',
  'HOST_PERMISSION_REQUIRED',
  'ACTION_DENIED',
  'MEMORY_OFF',
  'MEMORY_QUERY_REQUIRED',
  'SCHEDULE_INPUT_REQUIRED',
  'UNKNOWN',
];
