/**
 * 대화 목록. 계획서 Phase 2-4
 */

import { useT, useLocaleStore } from '@/lib/i18n';
import { useEffect, useState, useRef } from 'react';
import { useDialogFocus } from '@/lib/useDialogFocus';
import {
  deleteConversation,
  listConversations,
  renameConversation,
  type Conversation,
} from '@/lib/storage/db';

interface Props {
  currentId: number | null;
  onPick: (c: Conversation) => void;
  onClose: () => void;
  onDeleted: (id: number) => void;
  /** 열려 있는 대화의 제목도 함께 바뀌어야 한다(머리말 칩). */
  onRenamed: (id: number, title: string) => void;
}

export function ConversationMenu({ currentId, onPick, onClose, onDeleted, onRenamed }: Props) {
  const t = useT();
  const [items, setItems] = useState<Conversation[]>([]);
  const [error, setError] = useState('');
  // 제목을 고치는 중인 대화. 목록에서 바로 고친다 — 별도 화면으로 보내면 어느 대화인지 놓친다.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const editRef = useRef<HTMLInputElement>(null);
  const locale = useLocaleStore(s => s.locale);
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(dialog, onClose);

  const reload = () => listConversations().then(setItems).catch(e => setError(String(e)));
  useEffect(() => {
    void reload();
  }, []);

  // 편집을 시작하면 바로 칠 수 있게 하고, 기존 제목은 전체 선택해 둔다.
  useEffect(() => {
    if (editingId === null) return;
    editRef.current?.focus();
    editRef.current?.select();
  }, [editingId]);

  const startRename = (event: React.MouseEvent, conversation: Conversation) => {
    event.stopPropagation();
    setError('');
    setEditingId(conversation.id);
    setDraft(conversation.title);
  };

  const cancelRename = () => {
    setEditingId(null);
    setDraft('');
  };

  const saveRename = async (conversation: Conversation) => {
    const title = draft.trim();
    // 빈 제목은 목록에서 대화를 구분할 수 없게 만든다. 바뀐 것이 없을 때도 저장하지 않는다.
    if (!title || title === conversation.title) { cancelRename(); return; }
    try {
      await renameConversation(conversation.id, title);
      onRenamed(conversation.id, title);
      cancelRename();
      await reload();
    } catch (error) { setError(String(error)); }
  };

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
              {c.id === editingId ? (
                <>
                  <input
                    ref={editRef}
                    className="conv-edit"
                    value={draft}
                    aria-label={t('conv.renameOne', { title: c.title })}
                    maxLength={100}
                    onChange={(e) => setDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      // Esc는 대화 목록을 닫는 키이기도 하다. 편집 중에는 편집만 취소한다.
                      e.stopPropagation();
                      if (e.key === 'Enter') void saveRename(c);
                      if (e.key === 'Escape') cancelRename();
                    }}
                  />
                  <button className="conv-act ok" onClick={() => void saveRename(c)} title={t('conv.renameSave')} aria-label={t('conv.renameSave')}>
                    ✓
                  </button>
                  <button className="conv-act" onClick={cancelRename} title={t('conv.renameCancel')} aria-label={t('conv.renameCancel')}>
                    ×
                  </button>
                </>
              ) : (
                <>
                  {/* 제목 줄은 대화를 여는 버튼이다. 두 번 누르기로 편집에 들어가면 첫 클릭에서 이미 대화가 열려 닫힌다. */}
                  <button className="conv-main" onClick={() => onPick(c)} aria-current={c.id === currentId ? 'true' : undefined}>
                    <span className="conv-title">{c.title}</span>
                    <span className="conv-meta">
                      {hostOf(c.originUrl)} · {relTime(c.updatedAt, locale)}
                    </span>
                  </button>
                  <button
                    className="conv-act"
                    onClick={(e) => startRename(e, c)}
                    aria-label={t('conv.renameOne', { title: c.title })}
                    title={t('conv.rename')}
                  >
                    <PencilIcon />
                  </button>
                  <button
                    className="conv-act del"
                    onClick={(e) => remove(e, c)}
                    aria-label={t('conv.deleteOne', { title: c.title })}
                    title={t('ui.delete')}
                  >
                    ×
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
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
