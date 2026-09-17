/**
 * 대화 목록. 계획서 Phase 2-4
 */

import { useT, useLocaleStore } from '@/lib/i18n';
import { useEffect, useState, useRef } from 'react';
import { useDialogFocus } from '@/lib/useDialogFocus';
import {
  deleteConversation,
  listConversations,
  type Conversation,
} from '@/lib/storage/db';

interface Props {
  currentId: number | null;
  onPick: (c: Conversation) => void;
  onClose: () => void;
  onDeleted: (id: number) => void;
}

export function ConversationMenu({ currentId, onPick, onClose, onDeleted }: Props) {
  const t = useT();
  const [items, setItems] = useState<Conversation[]>([]);
  const [error, setError] = useState('');
  const locale = useLocaleStore(s => s.locale);
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(dialog, onClose);

  const reload = () => listConversations().then(setItems).catch(e => setError(String(e)));
  useEffect(() => {
    void reload();
  }, []);

  const remove = async (e: React.MouseEvent, c: Conversation) => {
    e.stopPropagation();
    if (!window.confirm(t('conv.confirmDelete', { title: c.title }))) return;
    try {
      await deleteConversation(c.id);
      onDeleted(c.id);
      await reload();
    } catch (error) { setError(String(error)); }
  };

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} />
      <div ref={dialog} className="sheet" role="dialog" aria-modal="true" aria-label={t('panel.conversations')}>
        <div className="sheet-head">
          <span>{t('conv.title')}</span>
          <button className="btn-sm" onClick={onClose}>
            {t('ui.close')}
          </button>
        </div>

        {items.length === 0 && <div className="sheet-empty">{t('conv.empty')}</div>}
        {error && <p role="alert">{error}</p>}

        <ul className="conv-list">
          {items.map((c) => (
            <li
              key={c.id}
              className={c.id === currentId ? 'current' : ''}
            >
              <button className="conv-main" onClick={() => onPick(c)} aria-current={c.id === currentId ? 'true' : undefined}>
                <span className="conv-title">{c.title}</span>
                <span className="conv-meta">
                  {hostOf(c.originUrl)} · {relTime(c.updatedAt, locale)}
                </span>
              </button>
              <button
                className="conv-del"
                onClick={(e) => remove(e, c)}
                aria-label={t('conv.deleteOne', { title: c.title })}
                title={t('ui.delete')}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || '로컬';
  } catch {
    return '알 수 없음';
  }
}

function relTime(ts: number, locale: string): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (min < 1) return format.format(0, 'second');
  if (min < 60) return format.format(-min, 'minute');
  const hr = Math.floor(min / 60);
  if (hr < 24) return format.format(-hr, 'hour');
  return format.format(-Math.floor(hr / 24), 'day');
}
