/**
 * 문서등록대장 목록 명령 버튼.
 *
 * ★ 온나라 업무는 목록(제목)을 보며 지시한다. 그래서 빠른 작업도 "이 페이지 요약" 같은
 *   본문 작업이 아니라, 체크한 문서에 대한 정형화된 명령만 둔다. 같은 명령을 입력창에서
 *   슬래시(/요약 …)로도 칠 수 있다 — 버튼과 슬래시는 같은 동작을 부른다.
 *
 * ★ 문서를 읽는 일은 비싸다(본문 2,000토큰 프리필 약 15초). 사용자가 명령을 누른
 *   순간에만 읽는다. 한 번 붙인 뒤의 후속 질문은 접두사 캐시 덕에 거의 공짜다.
 */

import { useT } from '@/lib/i18n';
import { DOCUMENT_COMMANDS, type DocumentCommandId } from '@/lib/onnara/commands';

interface Props {
  disabled: boolean;
  extracting: boolean;
  onRun: (command: DocumentCommandId) => void;
}

export function PageActions({ disabled, extracting, onRun }: Props) {
  const t = useT();

  return (
    <div className="pageactions">
      <div className="pageactions-row">
        {DOCUMENT_COMMANDS.map(command => (
          <button
            key={command.id}
            className="chipbtn"
            disabled={disabled || extracting}
            onClick={() => onRun(command.id)}
            title={`${command.slash} · ${command.hint}`}
          >
            {command.label}
          </button>
        ))}
      </div>

      <div className="pageactions-hint">
        {extracting ? t('page.reading') : t('page.commandHint')}
      </div>
    </div>
  );
}
