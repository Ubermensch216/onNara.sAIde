/**
 * 입력창. 계획서 Phase 2-3 / 3-6 / 4-3
 *
 * 생성 중에는 전송 버튼이 중단 버튼으로 바뀐다. 별도 버튼을 두면
 * 좁은 사이드패널에서 자리를 낭비하고, 무엇을 눌러야 할지도 모호해진다.
 *
 * 값을 부모가 들고 있는 제어 컴포넌트다 — 컨텍스트 메뉴의 '사이드패널로
 * 보내기'가 선택 텍스트를 입력창에 넣어야 하기 때문이다.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { matchSlash, namesOf, resolveTyped, type SlashCommand } from '@/lib/prompts/presets';
import { SlashMenu } from './SlashMenu';

interface Props {
  streaming: boolean;
  disabled: boolean;
  value: string;
  commands: SlashCommand[];
  /** 에이전트 모드인가. 입력창 안내 문구만 바뀐다. */
  agentMode?: boolean;
  onChange: (v: string) => void;
  onSend: (text: string) => void;
  onSlash: (cmd: SlashCommand, rest: string) => void;
  onStop: () => void;
}

export function Composer({
  streaming,
  disabled,
  value,
  commands,
  agentMode,
  onChange,
  onSend,
  onSlash,
  onStop,
}: Props) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => matchSlash(value, commands), [value, commands]);
  const menuOpen = matches.length > 0 && !streaming;

  // 후보가 바뀌면 선택을 처음으로 되돌린다.
  useEffect(() => setActive(0), [value]);

  // 입력 길이에 따라 높이를 늘린다(최대 6줄).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [value]);

  const pick = (cmd: SlashCommand) => {
    // 커맨드 뒤에 이미 쓴 내용이 있으면 인자로 넘긴다.
    // ★ 별칭으로 입력했을 수 있으므로 실제로 친 이름의 길이만큼 잘라야 한다.
    //   cmd.slash 길이로 자르면 인자가 잘리거나 이름 조각이 섞여 들어간다.
    const typed = namesOf(cmd).find((n) => value.toLowerCase().startsWith(n.toLowerCase()));
    const rest = value.slice((typed ?? cmd.slash).length).trim();
    onSlash(cmd, rest);
  };

  const submit = () => {
    const t = value.trim();
    if (!t || streaming || disabled) return;

    // 커맨드를 정확히 입력하고 Enter를 친 경우도 실행으로 본다. 별칭과 옛 접두 문자도 포함.
    const found = resolveTyped(t, commands);
    if (found) {
      onSlash(found.cmd, found.rest);
      return;
    }
    onSend(t);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (menuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onChange('');
        return;
      }
      if ((e.key === 'Tab' || e.key === 'Enter') && !e.nativeEvent.isComposing) {
        e.preventDefault();
        const cmd = matches[active];
        if (cmd) pick(cmd);
        return;
      }
    }

    // Enter 전송, Shift+Enter 줄바꿈. 한글 조합 중에는 전송하지 않는다.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="composer-wrap">
      {menuOpen && (
        <SlashMenu commands={matches} active={active} onPick={pick} onHover={setActive} />
      )}

      <div className="composer">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          placeholder={
            disabled
              ? t('composer.blocked')
              : agentMode
                ? t('composer.agent')
                : t('composer.normal')
          }
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label={t('composer.label')}
        />
        {streaming ? (
          <button
            className="send stop"
            onClick={onStop}
            aria-label={t('composer.stop')}
            title={t('composer.stopShort')}
          >
            <StopIcon />
          </button>
        ) : (
          <button
            className="send"
            onClick={submit}
            disabled={!value.trim() || disabled}
            aria-label={t('composer.send')}
            title={t('composer.sendHint')}
          >
            <SendIcon />
          </button>
        )}
      </div>
    </div>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2.5" />
    </svg>
  );
}
