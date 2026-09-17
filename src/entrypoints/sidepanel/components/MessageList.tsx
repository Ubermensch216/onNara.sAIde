/**
 * 메시지 목록. 계획서 Phase 2-2 / 2-8
 */

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import type { UiMessage } from '@/lib/chat/store';
import type { PerfSample } from '@/types/ollama';
import { AgentSteps } from './AgentSteps';
import { Markdown } from './Markdown';
import { CopyIcon, DeleteIcon } from './ChatActionIcons';
import { parseDownloadLink, type DownloadLinkAction } from '@/lib/downloads/links';

interface Props {
  messages: UiMessage[];
  dark: boolean;
  showThinking: boolean;
  deleteDisabled: boolean;
  onDelete: (id: UiMessage['id']) => Promise<void>;
  /** 답변 안의 다운로드 파일 링크를 눌렀을 때. 사용자 제스처가 살아 있도록 클릭 중에 동기로 호출한다. */
  onDownloadLink?: (action: DownloadLinkAction, downloadId: number) => void;
}

export function MessageList({ messages, dark, showThinking, deleteDisabled, onDelete, onDownloadLink }: Props) {
  // 마크다운 HTML 안의 링크에는 React 핸들러를 달 수 없어 목록에서 한 번에 가로챈다.
  const onClick = (event: React.MouseEvent) => {
    const anchor = (event.target as Element).closest?.('a');
    const link = parseDownloadLink(anchor?.getAttribute('href'));
    if (!link) return;
    event.preventDefault();
    onDownloadLink?.(link.action, link.downloadId);
  };
  const endRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // 사용자가 위로 스크롤해 과거를 읽는 중이면 자동 스크롤로 끌어내리지 않는다.
  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  useEffect(() => {
    if (pinned.current) endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  return (
    <div className="msgs" ref={scrollerRef} onScroll={onScroll} onClick={onClick}>
      {messages.map((m) => (
        <Message key={String(m.id)} msg={m} dark={dark} showThinking={showThinking} deleteDisabled={deleteDisabled} onDelete={onDelete} />
      ))}
      <div ref={endRef} />
    </div>
  );
}

function Message({
  msg,
  dark,
  showThinking,
  deleteDisabled,
  onDelete,
}: {
  msg: UiMessage;
  dark: boolean;
  showThinking: boolean;
  deleteDisabled: boolean;
  onDelete: Props['onDelete'];
}) {
  const t = useT();
  if (msg.role === 'user') {
    return (
      <div className="msg msg-user">
        <div className="bubble">{msg.content}</div>
        <MessageActions msg={msg} deleteDisabled={deleteDisabled} onDelete={onDelete} />
      </div>
    );
  }

  const empty = !msg.content && !msg.thinking;

  return (
    <div className="msg msg-assistant">
      {msg.notice && <div className="notice">{msg.notice}</div>}

      {showThinking && msg.thinking && (
        <ThinkingBlock text={msg.thinking} live={Boolean(msg.streaming)} />
      )}

      {/* 에이전트 실행 기록 (Phase 5). 답변보다 먼저 — 시간 순서대로 읽힌다. */}
      {msg.steps && msg.steps.length > 0 && (
        <AgentSteps steps={msg.steps} live={Boolean(msg.streaming)} />
      )}

      {empty && msg.streaming ? (
        <Typing />
      ) : (
        <Markdown text={msg.content} streaming={msg.streaming} dark={dark} />
      )}

      {msg.aborted && <div className="aborted">{t('msg.aborted')}</div>}
      {msg.perf && !msg.streaming && <PerfLine perf={msg.perf} />}
      <MessageActions msg={msg} deleteDisabled={deleteDisabled} onDelete={onDelete} />
    </div>
  );
}

function MessageActions({ msg, deleteDisabled, onDelete }: {
  msg: UiMessage; deleteDisabled: boolean; onDelete: Props['onDelete'];
}) {
  const t = useT();
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (status === 'idle') return;
    const timer = setTimeout(() => setStatus('idle'), 2000);
    return () => clearTimeout(timer);
  }, [status]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setStatus('copied');
    } catch { setStatus('failed'); }
  };

  return (
    <div className="message-actions">
      <button type="button" className="message-action" onClick={copy} disabled={!msg.content}
        title={t('msg.copy')} aria-label={t('msg.copy')}>
        <CopyIcon />
      </button>
      <button type="button" className="message-action message-action-delete" onClick={() => void onDelete(msg.id)}
        disabled={deleteDisabled || Boolean(msg.streaming)}
        title={t(deleteDisabled ? 'msg.deleteAfterGeneration' : 'msg.delete')} aria-label={t('msg.delete')}>
        <DeleteIcon />
      </button>
      <span className={`message-action-status ${status === 'failed' ? 'failed' : ''}`} role="status">
        {status === 'copied' ? t('ui.copied') : status === 'failed' ? t('msg.copyFailed') : ''}
      </span>
    </div>
  );
}

/**
 * 추론 과정 — 기본으로 접어 둔다. 계획서 Phase 2-8
 * 펼침이 기본이면 답변보다 사고 과정이 먼저 눈에 들어와 방해가 된다.
 */
function ThinkingBlock({ text, live }: { text: string; live: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <div className={`thinking ${open ? 'open' : ''}`}>
      <button className="thinking-head" onClick={() => setOpen((o) => !o)}>
        <span className={`caret ${open ? 'open' : ''}`}>›</span>
        <span>{live ? t('msg.thinking') : t('msg.thoughts')}</span>
        <span className="thinking-len">{t('msg.charCount', { n: text.length })}</span>
      </button>
      {open && <div className="thinking-body">{text}</div>}
    </div>
  );
}

function Typing() {
  const t = useT();
  return (
    <div className="typing" aria-label={t('msg.generating')}>
      <span />
      <span />
      <span />
    </div>
  );
}

/**
 * 성능 한 줄. 계획서 §6 목표와 대조할 수 있게 실제 수치를 노출한다.
 * CPU 추론에서는 사용자가 "왜 느린지"를 알 수 있어야 납득한다.
 */
function PerfLine({ perf }: { perf: PerfSample }) {
  const t = useT();
  return (
    <div className="perf">
      {(perf.ttfbMs / 1000).toFixed(1)}초 · {perf.decodeTokPerSec} tok/s ·{' '}
      {perf.promptTokens.toLocaleString()}→{perf.outputTokens.toLocaleString()} 토큰
      {perf.wasCold && t('msg.coldStart')}
    </div>
  );
}
