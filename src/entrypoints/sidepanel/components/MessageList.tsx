/**
 * 메시지 목록. 계획서 Phase 2-2 / 2-8
 */

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import type { UiMessage } from '@/lib/chat/store';
import type { PerfSample } from '@/types/ollama';
import { AgentSteps } from './AgentSteps';
import { TaskRegisterCard } from './TaskRegisterCard';
import { Markdown } from './Markdown';
import { CopyIcon, DeleteIcon } from './ChatActionIcons';
import { FeedbackButtons } from './FeedbackButtons';
import { loadFeedbackMap } from '@/lib/feedback/store';
import type { FeedbackVerdict } from '@/lib/feedback/store';
import { parseDownloadLink, type DownloadLinkAction } from '@/lib/downloads/links';
import { parsePanelLink, type PanelLink } from '@/lib/panel/links';

interface Props {
  messages: UiMessage[];
  dark: boolean;
  showThinking: boolean;
  deleteDisabled: boolean;
  /** 어떤 모델이 만든 답변인가. 정확도 피드백(B4)에 함께 기록한다. */
  model: string;
  onDelete: (id: UiMessage['id']) => Promise<void>;
  /** 답변 안의 다운로드 파일 링크를 눌렀을 때. 사용자 제스처가 살아 있도록 클릭 중에 동기로 호출한다. */
  onDownloadLink?: (action: DownloadLinkAction, downloadId: number) => void;
  /** 답변 안의 `일정 탭에서 보기` · `도구 탭에서 보기` 링크를 눌렀을 때. */
  onPanelLink?: (link: PanelLink) => void;
  /** 일정을 등록한 뒤 일정 탭으로 넘어가는 길. */
  onOpenSchedule?: () => void;
}

export function MessageList({ messages, dark, showThinking, deleteDisabled, model, onDelete, onDownloadLink, onPanelLink, onOpenSchedule }: Props) {
  // 마크다운 HTML 안의 링크에는 React 핸들러를 달 수 없어 목록에서 한 번에 가로챈다.
  const onClick = (event: React.MouseEvent) => {
    const href = (event.target as Element).closest?.('a')?.getAttribute('href');

    const download = parseDownloadLink(href);
    if (download) {
      event.preventDefault();
      onDownloadLink?.(download.action, download.downloadId);
      return;
    }

    const panel = parsePanelLink(href);
    if (panel) {
      event.preventDefault();
      onPanelLink?.(panel);
    }
  };
  const endRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  /**
   * 이미 눌러 둔 평가. 목록에서 한 번만 읽어 메시지마다 나눠 준다(B4).
   *
   * ★ 메시지마다 저장소를 읽으면 대화 하나에 조회가 수십 번 걸린다. 평가는 자주 바뀌지 않으므로
   *   목록이 바뀔 때만 다시 읽는다.
   */
  const [verdicts, setVerdicts] = useState<Map<string, FeedbackVerdict>>(new Map());
  useEffect(() => {
    let alive = true;
    void Promise.all([loadFeedbackMap('action-card'), loadFeedbackMap('summary')]).then(([cards, summaries]) => {
      if (alive) setVerdicts(new Map([...cards, ...summaries]));
    });
    return () => { alive = false; };
  }, [messages.length]);

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
        <Message key={String(m.id)} msg={m} dark={dark} showThinking={showThinking} deleteDisabled={deleteDisabled}
          model={model} verdict={verdicts.get(feedbackKey(m))} onDelete={onDelete} onOpenSchedule={onOpenSchedule} />
      ))}
      <div ref={endRef} />
    </div>
  );
}

/** 평가가 붙는 자리. 대화와 메시지를 함께 써야 다른 대화의 같은 번호와 겹치지 않는다. */
function feedbackKey(msg: UiMessage): string {
  return `${msg.conversationId}:${msg.id}`;
}

/** 이 답변에 평가를 받을 만한가. 자동화 실행 기록은 AI가 쓴 글이 아니므로 묻지 않는다. */
function feedbackKindOf(msg: UiMessage): 'action-card' | 'summary' | null {
  if (msg.role !== 'assistant' || msg.origin === 'automation' || msg.streaming || !msg.content) return null;
  return msg.taskCandidates?.length ? 'action-card' : 'summary';
}

function Message({
  msg,
  dark,
  showThinking,
  deleteDisabled,
  model,
  verdict,
  onDelete,
  onOpenSchedule,
}: {
  msg: UiMessage;
  dark: boolean;
  showThinking: boolean;
  deleteDisabled: boolean;
  model: string;
  verdict?: FeedbackVerdict | undefined;
  onDelete: Props['onDelete'];
  onOpenSchedule?: Props['onOpenSchedule'];
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

      {/* AI가 쓴 글은 검토가 필요하고, 자동화 결과는 실제로 일어난 일이다. 읽는 사람이 바로 구분하게 한다. */}
      {!empty && (
        <div className={`origin-badge ${msg.origin === 'automation' ? 'automation' : 'ai'}`}>
          {msg.origin === 'automation' ? t('msg.originAutomation') : t('msg.originAi')}
          {/* 캐시에서 꺼낸 답변임을 숨기지 않는다(B1). 언제 분석한 것인지까지 밝힌다. */}
          {msg.cached !== undefined && (
            <span className="cached-badge" title={t('msg.cachedHint')}>
              {t('msg.cached', { when: new Date(msg.cached).toLocaleDateString() })}
            </span>
          )}
        </div>
      )}

      {empty && msg.streaming ? (
        <Typing />
      ) : (
        <Markdown text={msg.content} streaming={msg.streaming} dark={dark} />
      )}

      {/* 핵심·조치사항에서 나온 일정 후보(S07). 답변 바로 아래 둔다 — 근거를 읽은 자리에서 판단한다. */}
      {!msg.streaming && msg.taskCandidates?.length && msg.sourceDoc ? (
        <TaskRegisterCard
          candidates={msg.taskCandidates}
          source={msg.sourceDoc}
          conversationId={msg.conversationId}
          model={model}
          {...(onOpenSchedule ? { onOpenSchedule } : {})}
        />
      ) : null}

      {msg.aborted && <div className="aborted">{t('msg.aborted')}</div>}
      {msg.perf && !msg.streaming && <PerfLine perf={msg.perf} />}
      {/* 평가는 복사·삭제와 성격이 다르다. 같은 줄에 섞지 않고 답변 아래 제 줄을 준다(B4). */}
      {feedbackKindOf(msg) && (
        <FeedbackButtons kind={feedbackKindOf(msg)!} targetKey={feedbackKey(msg)} model={model} initial={verdict} />
      )}
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
