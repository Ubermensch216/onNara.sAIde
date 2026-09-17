/**
 * 슬래시 커맨드 자동완성. 계획서 §5 Phase 4-3
 *
 * 입력창 바로 위에 뜬다. 첫 글자가 `/`이고 공백이 없을 때만 나타난다 —
 * 본문 중간의 `/`(URL, 날짜)를 건드리면 방해만 된다.
 */

import { useEffect, useRef } from 'react';
import { useT } from '@/lib/i18n';
import type { SlashCommand } from '@/lib/prompts/presets';

interface Props {
  commands: SlashCommand[];
  active: number;
  onPick: (cmd: SlashCommand) => void;
  onHover: (index: number) => void;
}

export function SlashMenu({ commands, active, onPick, onHover }: Props) {
  const t = useT();
  const listRef = useRef<HTMLUListElement>(null);

  // 키보드로 옮길 때 선택 항목이 보이도록 스크롤을 맞춘다.
  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (commands.length === 0) return null;

  return (
    <ul className="slashmenu" ref={listRef} role="listbox" aria-label={t('composer.commands')}>
      {commands.map((c, i) => (
        <li
          key={c.slash + c.presetId}
          role="option"
          aria-selected={i === active}
          className={i === active ? 'active' : ''}
          onMouseEnter={() => onHover(i)}
          // onClick보다 먼저 발생시켜 textarea의 blur를 막는다
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(c);
          }}
        >
          <span className="slash-cmd">{c.slash}</span>
          <span className="slash-label">{c.label}</span>
          {c.hint && <span className="slash-hint">{c.hint}</span>}
          {c.needs === 'page' && <span className="slash-badge">{t('composer.needsPage')}</span>}
          {c.needs === 'screen' && <span className="slash-badge">{t('composer.needsScreen')}</span>}
        </li>
      ))}
    </ul>
  );
}
