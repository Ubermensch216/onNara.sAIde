import { useEffect, useRef, useState } from 'react';
import type { Settings } from '@/lib/storage/settings';
import { MaterialIcon } from './MaterialIcon';
import { copyDraftToClipboard } from '@/lib/onnara/draft-format';
import {
  transformTextWithAI,
  maskPrivacyInfo,
  autoNumberAdminDraft,
  type PolishMode,
  type TransformAction,
} from '@/lib/onnara/bubble-transform';
import { computeTextDiff, type DiffPart } from '@/lib/onnara/text-diff';
import { cleanAdminDraft } from '@/lib/onnara/draft-cleaner';
import { messageOrigin, validatePostMessageEvent } from '@/lib/messaging/draft-protocol';

export interface ReviewTabProps {
  settings: Settings;
  docTitle?: string;
  needsOpenBody?: boolean;
  hasWriteBodyBtn?: boolean;
  onOpenBodyClick?: () => void;
  onPrepareInsert?: (text: string, mode?: 'cursor' | 'append') => void;
  onShowToast?: (message: string) => void;
}

function parentOrigin(): string {
  if (window.parent === window) return messageOrigin(location.href) || location.origin;
  const p = new URLSearchParams(location.search).get('parentOrigin') || document.referrer;
  return messageOrigin(p) || location.origin;
}

export function ReviewTab({
  settings,
  docTitle,
  needsOpenBody,
  hasWriteBodyBtn,
  onOpenBodyClick,
  onPrepareInsert,
  onShowToast,
}: ReviewTabProps) {
  // ── 서브 탭 (본 화면 맞춤법 검사 vs 블럭 메뉴) ──
  const [subTab, setSubTab] = useState<'spellcheck' | 'block'>('spellcheck');

  // ── 1. 본 화면 맞춤법 검사 상태 ──
  // 검사 대상은 기안기의 '제목'과 '본문'뿐이다. 서식(프레임)·버튼 글자는 포함하지 않는다.
  const [titleText, setTitleText] = useState<string>('');
  const [bodyText, setBodyText] = useState<string>('');
  const [isFetchingBody, setIsFetchingBody] = useState<boolean>(false);
  const [bodySource, setBodySource] = useState<string>('');
  const [spellCheckedTitle, setSpellCheckedTitle] = useState<string>('');
  const [spellCheckedText, setSpellCheckedText] = useState<string>('');
  const [isCheckingSpell, setIsCheckingSpell] = useState<boolean>(false);
  const [spellCheckError, setSpellCheckError] = useState<string | null>(null);
  const [spellViewMode, setSpellViewMode] = useState<'diff' | 'text'>('diff');
  const spellAbortRef = useRef<AbortController | null>(null);
  const [isApplyingSpell, setIsApplyingSpell] = useState<boolean>(false);
  const [confirmApply, setConfirmApply] = useState<boolean>(false);
  // 응답을 기다리는 반영 요청. 응답이 끝내 오지 않으면 그 사실을 알린다.
  const pendingApplyRef = useRef<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 2. 블럭 메뉴 (AI 문장 작성 지원) 상태 ──
  const [selectedBlockText, setSelectedBlockText] = useState<string>('');
  const [isFetchingSelection, setIsFetchingSelection] = useState<boolean>(false);
  const [blockResult, setBlockResult] = useState<string>('');
  const [blockActionTitle, setBlockActionTitle] = useState<string>('');
  const [isTransformingBlock, setIsTransformingBlock] = useState<boolean>(false);
  const [blockError, setBlockError] = useState<string | null>(null);
  const [blockViewMode, setBlockViewMode] = useState<'diff' | 'text'>('diff');
  const [isReplacingSelection, setIsReplacingSelection] = useState<boolean>(false);
  const blockAbortRef = useRef<AbortController | null>(null);

  const showToast = (msg: string) => {
    if (onShowToast) onShowToast(msg);
  };

  // 부모 창 메시지 수신 (본문 텍스트, 선택 텍스트, 치환 결과 등)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = parentOrigin();
      if (!validatePostMessageEvent(event, origin, window.parent)) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'DRAFT_BODY_TEXT_RESPONSE') {
        setIsFetchingBody(false);
        const title = typeof data.title === 'string' ? data.title : '';
        const body = typeof data.text === 'string' ? data.text : '';
        setTitleText(title);
        if (body || title) {
          setBodyText(body);
          setBodySource(data.source || '');
          showToast(`기안기 제목·본문을 불러왔습니다. (제목 ${title.length}자, 본문 ${body.length}자)`);
        } else {
          const detail = typeof data.debug === 'string' && data.debug ? ` (${data.debug})` : '';
          showToast(`기안기에서 제목·본문 텍스트를 찾지 못했습니다. 본문작성 창이 열려 있는지 확인해 주세요.${detail}`);
        }
      } else if (data.type === 'DRAFT_REPLACE_FIELDS_RESULT') {
        pendingApplyRef.current = null;
        setIsApplyingSpell(false);
        setConfirmApply(false);
        showToast(typeof data.message === 'string' && data.message ? data.message : data.success ? '기안기에 반영되었습니다.' : '반영하지 못했습니다.');
      } else if (data.type === 'DRAFT_SELECTION_TEXT_RESPONSE') {
        setIsFetchingSelection(false);
        if (data.text && typeof data.text === 'string' && data.text.trim()) {
          setSelectedBlockText(data.text.trim());
          showToast(`선택한 문장을 불러왔습니다. (${data.text.trim().length}자)`);
        } else {
          showToast('기안기에서 현재 선택(블럭 지정)된 문장이 없습니다.');
        }
      } else if (data.type === 'SAIDE_ACTIVE_SELECTION_CHANGED') {
        if (data.text && typeof data.text === 'string' && data.text.trim()) {
          setSelectedBlockText(data.text.trim());
        }
      } else if (data.type === 'DRAFT_REPLACE_SELECTION_RESULT') {
        setIsReplacingSelection(false);
        if (data.success) {
          showToast(data.message || '선택한 블럭이 교체되었습니다.');
        } else {
          showToast(`반영 실패: ${data.message || '선택 영역을 확인해 주세요.'}`);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // 탭 마운트 시 기안기 본문 자동 1회 조회 시도
  useEffect(() => {
    requestFetchBodyText();
    requestFetchSelectionText();
  }, []);

  // 기안기 본문 가져오기 요청
  const requestFetchBodyText = () => {
    setIsFetchingBody(true);
    setSpellCheckError(null);
    window.parent.postMessage(
      { type: 'DRAFT_GET_BODY_TEXT', requestId: `body_${Date.now()}` },
      parentOrigin()
    );
    // 3초 타임아웃
    setTimeout(() => {
      setIsFetchingBody((prev) => (prev ? false : prev));
    }, 3000);
  };

  // 기안기 선택 텍스트 가져오기 요청
  const requestFetchSelectionText = () => {
    setIsFetchingSelection(true);
    setBlockError(null);
    window.parent.postMessage(
      { type: 'DRAFT_GET_SELECTION_TEXT', requestId: `sel_${Date.now()}` },
      parentOrigin()
    );
    setTimeout(() => {
      setIsFetchingSelection((prev) => (prev ? false : prev));
    }, 2500);
  };

  // ── [본 화면 맞춤법 검사 실행] ──
  const handleRunSpellCheck = async () => {
    const textToProcess = bodyText.trim();
    const titleToProcess = titleText.trim();
    if (!textToProcess && !titleToProcess) {
      showToast('검사할 기안기 제목·본문 텍스트가 없습니다. 먼저 불러오거나 입력해 주세요.');
      return;
    }

    if (spellAbortRef.current) {
      spellAbortRef.current.abort();
    }
    const abort = new AbortController();
    spellAbortRef.current = abort;

    setIsCheckingSpell(true);
    setSpellCheckError(null);

    try {
      // 제목과 본문을 따로 교정한다. 본문이 긴 경우에도 안정적이도록 문서 맥락과 함께 전달
      const context = {
        title: titleToProcess || docTitle,
        bodyContext: textToProcess.slice(0, 1500),
      };

      if (titleToProcess) {
        const titleResult = await transformTextWithAI('spellcheck', titleToProcess, abort.signal, context);
        // 제목은 한 줄이다. 줄바꿈이 섞여 나오면 한 줄로 합친다.
        setSpellCheckedTitle(cleanAdminDraft(titleResult).replace(/\s*\n+\s*/g, ' ').trim());
      } else {
        setSpellCheckedTitle('');
      }

      if (textToProcess) {
        const result = await transformTextWithAI('spellcheck', textToProcess, abort.signal, context);
        setSpellCheckedText(cleanAdminDraft(result));
      } else {
        setSpellCheckedText('');
      }

      setSpellViewMode('diff');
      showToast('제목·본문 맞춤법 및 띄어쓰기 교정이 완료되었습니다.');
    } catch (err: any) {
      if (abort.signal.aborted) return;
      const msg = err?.message || '맞춤법 검사 중 오류가 발생했습니다.';
      setSpellCheckError(msg);
      showToast(`검사 오류: ${msg}`);
    } finally {
      setIsCheckingSpell(false);
      spellAbortRef.current = null;
    }
  };

  const handleCancelSpellCheck = () => {
    if (spellAbortRef.current) {
      spellAbortRef.current.abort();
      spellAbortRef.current = null;
      setIsCheckingSpell(false);
      showToast('맞춤법 검사가 취소되었습니다.');
    }
  };

  // 교정된 제목·본문을 기안기의 제목·본문 필드에 교체 반영한다.
  // ★ 본문 전체를 바꾸는 동작이라 첫 클릭은 확인 단계로 두고, 한 번 더 누르면 반영한다.
  const handleApplySpellCheckToBody = () => {
    const newBody = spellCheckedText.trim();
    const newTitle = spellCheckedTitle.trim();
    const bodyChanged = Boolean(newBody) && newBody !== bodyText.trim();
    const titleChanged = Boolean(newTitle) && newTitle !== titleText.trim();
    if (!bodyChanged && !titleChanged) {
      showToast('교정으로 바뀐 내용이 없어 반영할 것이 없습니다.');
      return;
    }
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    if (!confirmApply) {
      setConfirmApply(true);
      showToast('기안기의 본문(제목)이 교정본으로 교체됩니다. 한 번 더 누르면 반영합니다.');
      confirmTimerRef.current = setTimeout(() => setConfirmApply(false), 6000);
      return;
    }
    setConfirmApply(false);
    setIsApplyingSpell(true);
    const requestId = `fields_${Date.now()}`;
    pendingApplyRef.current = requestId;
    window.parent.postMessage(
      {
        type: 'DRAFT_REPLACE_FIELDS',
        requestId,
        ...(bodyChanged ? { body: newBody } : {}),
        ...(titleChanged ? { title: newTitle } : {}),
      },
      parentOrigin()
    );
    // 응답이 없으면 버튼이 잠기지 않도록 풀어 주고, 반영되지 않았음을 알린다.
    setTimeout(() => {
      if (pendingApplyRef.current !== requestId) return;
      pendingApplyRef.current = null;
      setIsApplyingSpell(false);
      showToast('기안기에서 응답이 없어 반영하지 못했습니다. 본문작성 창이 열려 있는지 확인한 뒤 다시 시도해 주세요.');
    }, 15000);
  };

  // ── [블럭 메뉴 액션 실행] ──
  const handleRunBlockAction = async (action: TransformAction, title: string) => {
    const textToProcess = selectedBlockText.trim();
    if (!textToProcess) {
      showToast('작업할 문장이 없습니다. 기안기 본문에서 문장을 블럭 지정하거나 텍스트를 입력해 주세요.');
      return;
    }

    if (blockAbortRef.current) {
      blockAbortRef.current.abort();
    }
    const abort = new AbortController();
    blockAbortRef.current = abort;

    setIsTransformingBlock(true);
    setBlockError(null);
    setBlockActionTitle(title);

    try {
      const result = await transformTextWithAI(
        action,
        textToProcess,
        abort.signal,
        {
          title: docTitle,
          bodyContext: bodyText ? bodyText.slice(0, 1500) : undefined,
        }
      );

      const cleaned = cleanAdminDraft(result);
      setBlockResult(cleaned);
      setBlockViewMode('diff');
      showToast(`'${title}' 처리가 완료되었습니다.`);
    } catch (err: any) {
      if (abort.signal.aborted) return;
      const msg = err?.message || '문장 변환 중 오류가 발생했습니다.';
      setBlockError(msg);
      showToast(`오류: ${msg}`);
    } finally {
      setIsTransformingBlock(false);
      blockAbortRef.current = null;
    }
  };

  // 개인정보 마스킹 (로컬 규칙)
  const handleRunPrivacyMask = () => {
    const textToProcess = selectedBlockText.trim();
    if (!textToProcess) {
      showToast('마스킹할 문장이 없습니다. 문장을 선택하거나 입력해 주세요.');
      return;
    }
    const maskRes = maskPrivacyInfo(textToProcess);
    setBlockActionTitle('개인정보 마스킹');
    setBlockResult(maskRes.text);
    setBlockViewMode('diff');
    if (maskRes.count > 0) {
      showToast(`총 ${maskRes.count}건의 개인정보(${maskRes.types.join(', ')})를 마스킹했습니다.`);
    } else {
      showToast('탐지된 개인정보(주민번호/휴대전화/이메일/계좌 등)가 없습니다.');
    }
  };

  // 번호 매기기 (로컬 규칙)
  const handleRunAutoNumber = () => {
    const textToProcess = selectedBlockText.trim();
    if (!textToProcess) {
      showToast('번호를 부여할 문장이 없습니다. 문장을 선택하거나 입력해 주세요.');
      return;
    }
    const numbered = autoNumberAdminDraft(textToProcess);
    setBlockActionTitle('공문서 번호 매기기');
    setBlockResult(numbered);
    setBlockViewMode('diff');
    showToast('행정 공문서 표준 항목 번호(1. 가. (1))가 부여되었습니다.');
  };

  const handleCancelBlockTransform = () => {
    if (blockAbortRef.current) {
      blockAbortRef.current.abort();
      blockAbortRef.current = null;
      setIsTransformingBlock(false);
      showToast('작업이 취소되었습니다.');
    }
  };

  // 블럭 결과 기안기 선택 영역에 치환
  const handleReplaceSelection = () => {
    if (!blockResult.trim()) return;
    setIsReplacingSelection(true);
    window.parent.postMessage(
      {
        type: 'DRAFT_REPLACE_SELECTION_TEXT',
        requestId: `rep_${Date.now()}`,
        text: blockResult,
        expectedSelectionText: selectedBlockText,
      },
      parentOrigin()
    );
    setTimeout(() => setIsReplacingSelection(false), 3000);
  };

  // Diff 렌더링 헬퍼
  const renderDiff = (original: string, modified: string) => {
    const parts = computeTextDiff(original, modified);
    return (
      <div className="font-mono text-xs leading-relaxed p-3 bg-slate-900 text-slate-100 rounded-lg max-h-64 overflow-y-auto whitespace-pre-wrap select-text border border-slate-800">
        {parts.map((part, idx) => {
          if (part.type === 'added') {
            return (
              <span
                key={idx}
                className="bg-emerald-800/80 text-emerald-200 px-0.5 rounded font-semibold underline decoration-emerald-400"
                title="추가/교정됨"
              >
                {part.value}
              </span>
            );
          }
          if (part.type === 'removed') {
            return (
              <span
                key={idx}
                className="bg-rose-900/80 text-rose-300 line-through opacity-80 px-0.5 rounded"
                title="삭제/교정 전"
              >
                {part.value}
              </span>
            );
          }
          return <span key={idx}>{part.value}</span>;
        })}
      </div>
    );
  };

  return (
    // ★ 드로어 헤더·탭 아래 남은 높이만 차지해야 한다. h-full이면 헤더·탭 높이만큼 아래가 잘려
    //   하단 버튼이 화면 밖으로 밀리고 스크롤로도 닿지 않는다(flex-1 + min-h-0).
    <div className="flex flex-col flex-1 min-h-0 bg-slate-50 text-slate-800">
      {/* ── 1. 퇴고 탭 내부 서브 네비게이션 ── */}
      <div className="px-4 pt-3 pb-2 bg-white border-b border-slate-200 shadow-sm shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-blue-600 text-white shadow-sm">
              <MaterialIcon name="spellcheck" size={17} />
            </span>
            <div>
              <h2 className="text-sm font-bold text-slate-800 leading-tight">공문서 퇴고 및 교정</h2>
              <p className="text-[11px] text-slate-500">본문 맞춤법 검사 · 블럭 지정 문장 작성 지원</p>
            </div>
          </div>
        </div>

        {/* 서브 탭 버튼 그룹 */}
        <div className="flex gap-1.5 p-1 bg-slate-100 rounded-lg border border-slate-200/80">
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'spellcheck'}
            onClick={() => setSubTab('spellcheck')}
            className={`flex-1 py-1.5 px-2 text-xs font-semibold rounded-md transition flex items-center justify-center gap-1.5 cursor-pointer ${
              subTab === 'spellcheck'
                ? 'bg-white text-blue-700 shadow-xs border border-slate-200/60 font-bold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <MaterialIcon name="spellcheck" size={15} />
            <span>본 화면 맞춤법 검사</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'block'}
            onClick={() => setSubTab('block')}
            className={`flex-1 py-1.5 px-2 text-xs font-semibold rounded-md transition flex items-center justify-center gap-1.5 cursor-pointer ${
              subTab === 'block'
                ? 'bg-white text-blue-700 shadow-xs border border-slate-200/60 font-bold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <MaterialIcon name="autoFixHigh" size={15} />
            <span>블럭 메뉴 (문장 지원)</span>
          </button>
        </div>
      </div>

      {/* ── 2. 서브 탭 컨텐츠 영역 (스크롤 가능) ── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* ============================================================== */}
        {/* [서브탭 1: 본 화면 맞춤법 검사] */}
        {/* ============================================================== */}
        {subTab === 'spellcheck' && (
          <div className="space-y-4">
            {/* 본문작성 창 필요 알림 배너 */}
            {needsOpenBody && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2.5 text-xs text-amber-900">
                <span className="text-amber-600 shrink-0 mt-0.5">
                  <MaterialIcon name="info" size={16} />
                </span>
                <div className="flex-1">
                  <p className="font-semibold">기안기 본문작성 화면이 닫혀 있습니다.</p>
                  <p className="text-[11px] text-amber-700 mt-0.5">
                    공문 본문 텍스트를 직접 읽고 교정본을 반영하려면 [본문작성] 버튼을 눌러주세요.
                  </p>
                  {hasWriteBodyBtn && onOpenBodyClick && (
                    <button
                      type="button"
                      onClick={onOpenBodyClick}
                      className="mt-2 px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded font-medium text-xs transition inline-flex items-center gap-1 shadow-xs cursor-pointer"
                    >
                      <MaterialIcon name="openInNew" size={13} />
                      <span>[본문작성] 창 열기</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 본문 텍스트 카드 */}
            <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-xs text-slate-700">기안기 제목·본문</span>
                  {bodyText && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-mono">
                      {bodyText.length.toLocaleString()}자
                    </span>
                  )}
                  {bodySource && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-medium">
                      {bodySource === 'webhwp' ? '한글 기안기' : bodySource}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={requestFetchBodyText}
                  disabled={isFetchingBody}
                  className="px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 rounded-md font-medium transition inline-flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                  title="기안기 본문 다시 읽어오기"
                >
                  <MaterialIcon name="refresh" size={14} className={isFetchingBody ? 'animate-spin' : ''} />
                  <span>{isFetchingBody ? '불러오는 중...' : '본문 새로고침'}</span>
                </button>
              </div>

              <label className="block text-[11px] font-semibold text-slate-500">제목</label>
              <input
                type="text"
                value={titleText}
                onChange={(e) => setTitleText(e.target.value)}
                placeholder="기안기 제목"
                className="w-full text-xs font-sans px-2.5 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-slate-50/50"
              />
              <label className="block text-[11px] font-semibold text-slate-500">본문</label>
              <textarea
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                placeholder="온나라 기안기 본문을 불러오거나 교정할 문장을 직접 입력하세요..."
                rows={7}
                className="w-full text-xs font-sans p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y leading-relaxed bg-slate-50/50"
              />

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-slate-400">
                  {docTitle ? `문서: ${docTitle}` : '공문서 표준 맞춤법 및 문장부호 검사'}
                </span>

                <div className="flex items-center gap-2">
                  {isCheckingSpell ? (
                    <button
                      type="button"
                      onClick={handleCancelSpellCheck}
                      className="px-3 py-1.5 bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 rounded-lg text-xs font-semibold transition cursor-pointer"
                    >
                      검사 중지
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleRunSpellCheck}
                      disabled={(!bodyText.trim() && !titleText.trim()) || isCheckingSpell}
                      className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      <MaterialIcon name="spellcheck" size={15} />
                      <span>맞춤법 검사 실행</span>
                    </button>
                  )}
                </div>
              </div>

              {/* 검사 진행 인디케이터 */}
              {isCheckingSpell && (
                <div className="p-3 bg-blue-50/70 border border-blue-200/80 rounded-lg flex items-center gap-2.5 text-xs text-blue-800 animate-pulse">
                  <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin shrink-0" />
                  <div className="flex-1">
                    <p className="font-semibold">AI 맞춤법 및 띄어쓰기 교정 중...</p>
                    <p className="text-[11px] text-blue-600 mt-0.5">
                      공문서 표준 규정 및 문장부호를 검토하고 있습니다. 잠시만 기다려 주세요.
                    </p>
                  </div>
                </div>
              )}

              {spellCheckError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
                  {spellCheckError}
                </div>
              )}
            </div>

            {/* 맞춤법 검사 결과 카드 */}
            {(spellCheckedText || spellCheckedTitle) && (
              <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold text-xs">
                      교정 결과
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {spellCheckedText.length.toLocaleString()}자
                    </span>
                  </div>

                  {/* Diff / 결과 텍스트 보기 토글 */}
                  <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-md border border-slate-200">
                    <button
                      type="button"
                      onClick={() => setSpellViewMode('diff')}
                      className={`px-2 py-0.5 text-[11px] font-semibold rounded ${
                        spellViewMode === 'diff'
                          ? 'bg-white text-blue-700 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      변경 비교 (Diff)
                    </button>
                    <button
                      type="button"
                      onClick={() => setSpellViewMode('text')}
                      className={`px-2 py-0.5 text-[11px] font-semibold rounded ${
                        spellViewMode === 'text'
                          ? 'bg-white text-blue-700 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      교정본 텍스트
                    </button>
                  </div>
                </div>

                {/* 내용 뷰어 */}
                {spellViewMode === 'diff' ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-[10px] text-slate-500">
                      <span className="inline-block w-2.5 h-2.5 bg-rose-900/80 rounded" />
                      <span>교정 전 삭제 내용</span>
                      <span className="inline-block w-2.5 h-2.5 bg-emerald-800/80 rounded ml-2" />
                      <span>교정 후 추가·수정 내용</span>
                    </div>
                    {spellCheckedTitle && (
                      <div>
                        <div className="text-[11px] font-semibold text-slate-500 mb-1">제목</div>
                        {renderDiff(titleText, spellCheckedTitle)}
                      </div>
                    )}
                    {spellCheckedText && (
                      <div>
                        <div className="text-[11px] font-semibold text-slate-500 mb-1">본문</div>
                        {renderDiff(bodyText, spellCheckedText)}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {spellCheckedTitle && (
                      <input
                        type="text"
                        value={spellCheckedTitle}
                        onChange={(e) => setSpellCheckedTitle(e.target.value)}
                        className="w-full text-xs font-sans px-2.5 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      />
                    )}
                    {spellCheckedText && (
                      <textarea
                        value={spellCheckedText}
                        onChange={(e) => setSpellCheckedText(e.target.value)}
                        rows={8}
                        className="w-full text-xs font-sans p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y leading-relaxed bg-white"
                      />
                    )}
                  </div>
                )}

                {/* 결과 액션 바 */}
                <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        copyDraftToClipboard(
                          [spellCheckedTitle && `제목: ${spellCheckedTitle}`, spellCheckedText]
                            .filter(Boolean)
                            .join('\n\n')
                        );
                        showToast('교정된 제목·본문이 클립보드에 복사되었습니다.');
                      }}
                      className="px-2.5 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition inline-flex items-center gap-1 cursor-pointer"
                    >
                      <MaterialIcon name="contentCopy" size={14} />
                      <span>복사</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSpellCheckedTitle('');
                        setSpellCheckedText('');
                        setSpellCheckError(null);
                      }}
                      className="px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                    >
                      초기화
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleApplySpellCheckToBody}
                    disabled={(!spellCheckedText.trim() && !spellCheckedTitle.trim()) || isApplyingSpell}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    title="기안기의 본문(과 제목) 필드를 교정본으로 교체합니다"
                  >
                    <MaterialIcon name="check" size={15} />
                    <span>{isApplyingSpell ? '반영 중...' : confirmApply ? '교체 확인 (한 번 더 클릭)' : '기안기 본문에 반영'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* [서브탭 2: 블럭 메뉴 (문장 작성 지원)] */}
        {/* ============================================================== */}
        {subTab === 'block' && (
          <div className="space-y-4">
            {/* 안내 배너 */}
            <div className="p-3 bg-indigo-50/70 border border-indigo-200/80 rounded-lg flex items-start gap-2.5 text-xs text-indigo-900">
              <span className="text-indigo-600 shrink-0 mt-0.5">
                <MaterialIcon name="autoFixHigh" size={16} />
              </span>
              <div className="flex-1 leading-relaxed">
                <p className="font-bold">기안기 본문 블럭 메뉴 연동</p>
                <p className="text-[11px] text-indigo-700 mt-0.5">
                  기안기 본문에서 문장을 마우스로 드래그(블럭 지정)하면 나타나는 플로팅 툴바 기능입니다.
                  아래에서 선택된 문장을 가져와 맞춤법 검사 및 6대 문장 다듬기 지원을 즉시 실행할 수 있습니다.
                </p>
              </div>
            </div>

            {/* 선택된 블럭 문장 카드 */}
            <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-xs text-slate-700">선택된 문장 (블럭)</span>
                  {selectedBlockText && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-mono">
                      {selectedBlockText.length.toLocaleString()}자
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={requestFetchSelectionText}
                  disabled={isFetchingSelection}
                  className="px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-50 rounded-md font-medium transition inline-flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                  title="기안기 화면에서 현재 선택된 문장 가져오기"
                >
                  <MaterialIcon name="contentCut" size={14} className={isFetchingSelection ? 'animate-pulse' : ''} />
                  <span>{isFetchingSelection ? '확인 중...' : '선택 영역 가져오기'}</span>
                </button>
              </div>

              <textarea
                value={selectedBlockText}
                onChange={(e) => setSelectedBlockText(e.target.value)}
                placeholder="기안기 본문에서 문장을 블럭 지정하거나 변환할 문장을 여기에 입력하세요..."
                rows={4}
                className="w-full text-xs font-sans p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-y leading-relaxed bg-slate-50/50"
              />

              {/* AI 작성 지원 도구 버튼 그리드 */}
              <div className="space-y-2 pt-1">
                <span className="text-[11px] font-bold text-slate-600 block">AI 문장 작성 지원 도구</span>

                {/* 1. 맞춤법 검사 버튼 (강조) */}
                <button
                  type="button"
                  onClick={() => handleRunBlockAction('spellcheck', '맞춤법 검사')}
                  disabled={!selectedBlockText.trim() || isTransformingBlock}
                  className="w-full py-2 px-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  <MaterialIcon name="spellcheck" size={16} />
                  <span>선택 문장 맞춤법 & 띄어쓰기 교정</span>
                </button>

                {/* 2. 문장 다듬기 6대 모드 버튼 그리드 */}
                <div className="grid grid-cols-2 gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => handleRunBlockAction('shorten', '간결하게')}
                    disabled={!selectedBlockText.trim() || isTransformingBlock}
                    className="p-2 bg-slate-50 hover:bg-blue-50/60 hover:border-blue-300 border border-slate-200 rounded-lg text-left transition disabled:opacity-50 cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                      <MaterialIcon name="contentCut" size={14} className="text-blue-600" />
                      <span>간결하게</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">군더더기 삭제 · 핵심 압축</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRunBlockAction('expand', '풍부하게')}
                    disabled={!selectedBlockText.trim() || isTransformingBlock}
                    className="p-2 bg-slate-50 hover:bg-blue-50/60 hover:border-blue-300 border border-slate-200 rounded-lg text-left transition disabled:opacity-50 cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                      <MaterialIcon name="article" size={14} className="text-indigo-600" />
                      <span>풍부하게</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">추진 배경 · 타당성 보강</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRunBlockAction('official', '공문서 표준 어투')}
                    disabled={!selectedBlockText.trim() || isTransformingBlock}
                    className="p-2 bg-slate-50 hover:bg-blue-50/60 hover:border-blue-300 border border-slate-200 rounded-lg text-left transition disabled:opacity-50 cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                      <MaterialIcon name="accountBalance" size={14} className="text-purple-600" />
                      <span>공문서 표준 어투</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">~코자 함, ~바람</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRunBlockAction('bullet', '개조식 변환')}
                    disabled={!selectedBlockText.trim() || isTransformingBlock}
                    className="p-2 bg-slate-50 hover:bg-blue-50/60 hover:border-blue-300 border border-slate-200 rounded-lg text-left transition disabled:opacity-50 cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                      <MaterialIcon name="checklist" size={14} className="text-teal-600" />
                      <span>개조식 변환</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">- · 항목화 분절</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRunBlockAction('refine', '쉬운 행정용어')}
                    disabled={!selectedBlockText.trim() || isTransformingBlock}
                    className="p-2 bg-slate-50 hover:bg-blue-50/60 hover:border-blue-300 border border-slate-200 rounded-lg text-left transition disabled:opacity-50 cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                      <MaterialIcon name="translate" size={14} className="text-emerald-600" />
                      <span>쉬운 행정용어</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">순화어 치환</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRunBlockAction('courtesy', '정중한 협조체')}
                    disabled={!selectedBlockText.trim() || isTransformingBlock}
                    className="p-2 bg-slate-50 hover:bg-blue-50/60 hover:border-blue-300 border border-slate-200 rounded-lg text-left transition disabled:opacity-50 cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                      <MaterialIcon name="chat" size={14} className="text-amber-600" />
                      <span>정중한 협조체</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">대외 협조 공문</p>
                  </button>
                </div>

                {/* 3. 로컬 즉시 도구: 개인정보 마스킹 & 번호 매기기 */}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleRunPrivacyMask}
                    disabled={!selectedBlockText.trim()}
                    className="flex-1 py-1.5 px-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer border border-slate-200"
                    title="주민번호, 휴대전화, 이메일, 계좌번호 자동 마스킹"
                  >
                    <MaterialIcon name="lock" size={14} className="text-slate-600" />
                    <span>개인정보 마스킹</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleRunAutoNumber}
                    disabled={!selectedBlockText.trim()}
                    className="flex-1 py-1.5 px-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer border border-slate-200"
                    title="1. 가. (1) 계층별 공문서 항목 번호 자동 부여"
                  >
                    <MaterialIcon name="formatListNumbered" size={14} className="text-slate-600" />
                    <span>번호 매기기</span>
                  </button>
                </div>
              </div>

              {/* 블럭 처리 중 로딩 */}
              {isTransformingBlock && (
                <div className="p-3 bg-indigo-50/70 border border-indigo-200/80 rounded-lg flex items-center justify-between text-xs text-indigo-900 animate-pulse">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin shrink-0" />
                    <span className="font-semibold">{blockActionTitle} 처리 중...</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCancelBlockTransform}
                    className="px-2 py-0.5 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded text-[11px] font-semibold transition cursor-pointer"
                  >
                    취소
                  </button>
                </div>
              )}

              {blockError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
                  {blockError}
                </div>
              )}
            </div>

            {/* 블럭 변환 결과 카드 */}
            {blockResult && (
              <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded font-bold text-xs">
                      {blockActionTitle || '변환 결과'}
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {blockResult.length.toLocaleString()}자
                    </span>
                  </div>

                  <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-md border border-slate-200">
                    <button
                      type="button"
                      onClick={() => setBlockViewMode('diff')}
                      className={`px-2 py-0.5 text-[11px] font-semibold rounded ${
                        blockViewMode === 'diff'
                          ? 'bg-white text-indigo-700 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      변경 비교 (Diff)
                    </button>
                    <button
                      type="button"
                      onClick={() => setBlockViewMode('text')}
                      className={`px-2 py-0.5 text-[11px] font-semibold rounded ${
                        blockViewMode === 'text'
                          ? 'bg-white text-indigo-700 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      결과 텍스트
                    </button>
                  </div>
                </div>

                {blockViewMode === 'diff' ? (
                  <div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 mb-1.5">
                      <span className="inline-block w-2.5 h-2.5 bg-rose-900/80 rounded" />
                      <span>원문 삭제</span>
                      <span className="inline-block w-2.5 h-2.5 bg-emerald-800/80 rounded ml-2" />
                      <span>변환된 내용</span>
                    </div>
                    {renderDiff(selectedBlockText, blockResult)}
                  </div>
                ) : (
                  <textarea
                    value={blockResult}
                    onChange={(e) => setBlockResult(e.target.value)}
                    rows={5}
                    className="w-full text-xs font-sans p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y leading-relaxed bg-white"
                  />
                )}

                {/* 결과 액션 바 */}
                <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        copyDraftToClipboard(blockResult);
                        showToast('변환된 문장이 클립보드에 복사되었습니다.');
                      }}
                      className="px-2.5 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition inline-flex items-center gap-1 cursor-pointer"
                    >
                      <MaterialIcon name="contentCopy" size={14} />
                      <span>복사</span>
                    </button>

                    {onPrepareInsert && (
                      <button
                        type="button"
                        onClick={() => onPrepareInsert(blockResult, 'cursor')}
                        className="px-2.5 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition inline-flex items-center gap-1 cursor-pointer"
                        title="기안기 본문 커서 위치에 삽입"
                      >
                        <MaterialIcon name="add" size={14} />
                        <span>본문 삽입</span>
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleReplaceSelection}
                    disabled={isReplacingSelection}
                    className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-sm disabled:opacity-50 cursor-pointer"
                    title="기안기에서 블럭 지정된 선택 영역을 이 변환 결과로 교체합니다"
                  >
                    <MaterialIcon name="check" size={15} />
                    <span>{isReplacingSelection ? '반영 중...' : '선택 영역에 즉시 반영'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
