import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  computeTextDiff,
  computeDiffSegments,
  composeFromSegments,
  type DiffPart,
  type DiffSegment,
} from '@/lib/onnara/text-diff';
import { guardSpellcheckResult, normalizeSpellText } from '@/lib/onnara/spell-guard';
import { applyContextFixes } from '@/lib/onnara/context-spell';
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
  // 사용자가 '×'로 제외한 교정 항목(번호). 제외한 항목은 원문 그대로 반영된다.
  const [excludedTitle, setExcludedTitle] = useState<ReadonlySet<number>>(() => new Set());
  const [excludedBody, setExcludedBody] = useState<ReadonlySet<number>>(() => new Set());
  const [isCheckingSpell, setIsCheckingSpell] = useState<boolean>(false);
  const [spellCheckError, setSpellCheckError] = useState<string | null>(null);
  const [spellViewMode, setSpellViewMode] = useState<'diff' | 'text'>('diff');
  const spellAbortRef = useRef<AbortController | null>(null);
  const [isApplyingSpell, setIsApplyingSpell] = useState<boolean>(false);
  // 반영 전 확인 팝업. 열려 있는 동안 교체 대상(바뀔 제목·본문)을 보여 준다.
  const [applyConfirm, setApplyConfirm] = useState<{ title?: string; body?: string } | null>(null);
  // 응답을 기다리는 반영 요청. 응답이 끝내 오지 않으면 그 사실을 알린다.
  const pendingApplyRef = useRef<string | null>(null);

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
        // 한글 조합형·보이지 않는 문자가 섞이면 같은 글자도 교정된 것처럼 보인다. 미리 정규화한다.
        const title = typeof data.title === 'string' ? normalizeSpellText(data.title) : '';
        const body = typeof data.text === 'string' ? normalizeSpellText(data.text) : '';
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
      } else if (data.type === 'SAIDE_SET_REVIEW_PREVIEW') {
        if (data.titleText !== undefined) setTitleText(data.titleText);
        if (data.bodyText !== undefined) setBodyText(data.bodyText);
        if (data.spellCheckedTitle !== undefined) setSpellCheckedTitle(data.spellCheckedTitle);
        if (data.spellCheckedText !== undefined) setSpellCheckedText(data.spellCheckedText);
        if (data.subTab !== undefined) setSubTab(data.subTab);
        if (data.spellViewMode !== undefined) setSpellViewMode(data.spellViewMode);
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

  // ── 교정 항목 계산: 원문 대비 바뀐 곳을 항목으로 묶고, 제외한 항목은 원문으로 되돌린다 ──
  const baseTitle = useMemo(() => normalizeSpellText(titleText.trim()), [titleText]);
  const baseBody = useMemo(() => normalizeSpellText(bodyText.trim()), [bodyText]);
  const titleSegments = useMemo<DiffSegment[]>(
    () => (spellCheckedTitle ? computeDiffSegments(baseTitle, spellCheckedTitle) : []),
    [baseTitle, spellCheckedTitle]
  );
  const bodySegments = useMemo<DiffSegment[]>(
    () => (spellCheckedText ? computeDiffSegments(baseBody, spellCheckedText) : []),
    [baseBody, spellCheckedText]
  );
  // 교정 결과나 원문이 바뀌면 항목 번호가 달라지므로 제외 목록을 비운다.
  useEffect(() => setExcludedTitle(new Set()), [titleSegments]);
  useEffect(() => setExcludedBody(new Set()), [bodySegments]);
  const finalTitle = useMemo(
    () => (spellCheckedTitle ? composeFromSegments(titleSegments, excludedTitle) : ''),
    [spellCheckedTitle, titleSegments, excludedTitle]
  );
  const finalBody = useMemo(
    () => (spellCheckedText ? composeFromSegments(bodySegments, excludedBody) : ''),
    [spellCheckedText, bodySegments, excludedBody]
  );
  const changeCount = (segs: DiffSegment[]) => segs.filter((s) => s.kind === 'change').length;
  const totalChanges = changeCount(titleSegments) + changeCount(bodySegments);
  const totalExcluded = excludedTitle.size + excludedBody.size;

  const toggleExcluded = (
    setter: (fn: (prev: ReadonlySet<number>) => ReadonlySet<number>) => void,
    id: number
  ) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
        const oneLine = cleanAdminDraft(titleResult).replace(/\s*\n+\s*/g, ' ').trim();
        // 줄 보호(spell-guard)가 AI 교정 줄을 버리고 원문으로 되돌린 경우에도 문맥 혼동어 교정은 남도록, 보호 뒤에 한 번 더 적용한다.
        setSpellCheckedTitle(applyContextFixes(guardSpellcheckResult(normalizeSpellText(titleToProcess), oneLine)));
      } else {
        setSpellCheckedTitle('');
      }

      if (textToProcess) {
        const result = await transformTextWithAI('spellcheck', textToProcess, abort.signal, context);
        // ★ 맞춤법 검사는 글자만 고친다. AI가 소제목·항목 기호·줄을 지우거나 덧붙여도
        //   원문 줄 구성에 맞춰 되돌린다(spell-guard).
        setSpellCheckedText(applyContextFixes(guardSpellcheckResult(normalizeSpellText(textToProcess), cleanAdminDraft(result))));
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
  // ★ 본문 전체를 바꾸는 동작이라 버튼을 누르면 먼저 확인 팝업을 띄우고, 팝업에서 승인해야 반영한다.
  const handleApplySpellCheckToBody = () => {
    const newBody = finalBody.trim();
    const newTitle = finalTitle.trim();
    const bodyChanged = Boolean(newBody) && newBody !== baseBody;
    const titleChanged = Boolean(newTitle) && newTitle !== baseTitle;
    if (!bodyChanged && !titleChanged) {
      showToast('교정으로 바뀐 내용이 없어 반영할 것이 없습니다.');
      return;
    }
    setApplyConfirm({
      ...(bodyChanged ? { body: newBody } : {}),
      ...(titleChanged ? { title: newTitle } : {}),
    });
  };

  // 확인 팝업에서 승인하면 기안기 필드에 실제로 반영한다.
  const handleConfirmApply = () => {
    const target = applyConfirm;
    setApplyConfirm(null);
    if (!target) return;
    setIsApplyingSpell(true);
    const requestId = `fields_${Date.now()}`;
    pendingApplyRef.current = requestId;
    window.parent.postMessage(
      {
        type: 'DRAFT_REPLACE_FIELDS',
        requestId,
        ...(target.body ? { body: target.body } : {}),
        ...(target.title ? { title: target.title } : {}),
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

  // 교정 항목별 Diff: 각 교정 옆의 '×'로 그 교정만 제외(원문 유지)하고, '↺'로 다시 적용한다.
  const renderSegments = (
    segments: DiffSegment[],
    excluded: ReadonlySet<number>,
    onToggle: (id: number) => void
  ) => (
    <div className="font-mono text-xs leading-relaxed p-3 bg-slate-900 text-slate-100 rounded-lg max-h-64 overflow-y-auto whitespace-pre-wrap select-text border border-slate-800">
      {segments.map((seg, idx) => {
        if (seg.kind === 'same') return <span key={idx}>{seg.text}</span>;
        if (excluded.has(seg.id)) {
          return (
            <span key={idx} data-spell-change={seg.id} data-excluded="true">
              <span className="border-b border-dashed border-slate-500" title="교정 제외됨 (원문 유지)">
                {seg.removed}
              </span>
              <button
                type="button"
                onClick={() => onToggle(seg.id)}
                aria-label="이 교정 다시 적용"
                title="이 교정 다시 적용"
                className="inline-flex items-center justify-center w-3.5 h-3.5 mx-0.5 align-middle rounded-full bg-slate-700 hover:bg-slate-500 text-slate-200 text-[10px] leading-none cursor-pointer"
              >
                ↺
              </button>
            </span>
          );
        }
        return (
          <span key={idx} data-spell-change={seg.id}>
            {seg.removed && (
              <span className="bg-rose-900/80 text-rose-300 line-through opacity-80 px-0.5 rounded" title="삭제/교정 전">
                {seg.removed}
              </span>
            )}
            {seg.added && (
              <span
                className="bg-emerald-800/80 text-emerald-200 px-0.5 rounded font-semibold underline decoration-emerald-400"
                title="추가/교정됨"
              >
                {seg.added}
              </span>
            )}
            <button
              type="button"
              onClick={() => onToggle(seg.id)}
              aria-label="이 교정 제외"
              title="이 교정 제외 (원문 유지)"
              className="inline-flex items-center justify-center w-3.5 h-3.5 mx-0.5 align-middle rounded-full bg-slate-700 hover:bg-rose-600 text-slate-200 text-[10px] leading-none cursor-pointer"
            >
              ×
            </button>
          </span>
        );
      })}
    </div>
  );

  // Diff 렌더링 헬퍼
  const renderDiff =(original: string, modified: string) => {
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
      {/* ── 1. 서브 네비게이션 (맞춤법 검사 / 블럭 메뉴) ── */}
      <div className="px-4 py-2 bg-white border-b border-slate-200 shadow-sm shrink-0">
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
            <span>맞춤법 검사</span>
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
                      {finalBody.length.toLocaleString()}자
                    </span>
                    <span className="text-[11px] text-slate-500">
                      교정 {totalChanges - totalExcluded}건
                      {totalExcluded > 0 && ` · 제외 ${totalExcluded}건`}
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
                      <span className="ml-2">× 누르면 그 교정 제외</span>
                    </div>
                    {spellCheckedTitle && (
                      <div>
                        <div className="text-[11px] font-semibold text-slate-500 mb-1">제목</div>
                        {renderSegments(titleSegments, excludedTitle, (id) => toggleExcluded(setExcludedTitle, id))}
                      </div>
                    )}
                    {spellCheckedText && (
                      <div>
                        <div className="text-[11px] font-semibold text-slate-500 mb-1">본문</div>
                        {renderSegments(bodySegments, excludedBody, (id) => toggleExcluded(setExcludedBody, id))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {spellCheckedTitle && (
                      <input
                        type="text"
                        value={finalTitle}
                        onChange={(e) => setSpellCheckedTitle(e.target.value)}
                        className="w-full text-xs font-sans px-2.5 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      />
                    )}
                    {spellCheckedText && (
                      <textarea
                        value={finalBody}
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
                          [finalTitle && `제목: ${finalTitle}`, finalBody]
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
                    <span>{isApplyingSpell ? '반영 중...' : '기안기 본문에 반영'}</span>
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
            {/* 사용 순서: ① 본문 드래그 → ② 가져오기(버튼) → ③ 교정·다듬기 */}
            <ol
              className="p-2 bg-indigo-50/70 border border-indigo-200/80 rounded-lg flex items-stretch justify-between gap-1 text-[11px] text-indigo-900"
              aria-label="사용 순서"
            >
              <li className="flex-1 flex flex-col items-center gap-1 py-1.5" title="기안기 본문에서 문장을 마우스로 드래그해 블럭 지정">
                <span className="w-8 h-8 rounded-full bg-white text-blue-600 flex items-center justify-center shadow-xs">
                  <MaterialIcon name="highlightAlt" size={18} />
                </span>
                <span className="font-semibold">본문 드래그</span>
              </li>
              <li className="flex items-center text-blue-300" aria-hidden="true">
                <MaterialIcon name="chevronRight" size={18} />
              </li>
              <li className="flex-1 flex">
                <button
                  type="button"
                  onClick={requestFetchSelectionText}
                  disabled={isFetchingSelection}
                  className="flex-1 flex flex-col items-center gap-1 py-1.5 rounded-md hover:bg-indigo-100/80 transition disabled:opacity-50 cursor-pointer"
                  title="기안기 화면에서 현재 선택된 문장 가져오기"
                >
                  <span className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-xs">
                    <MaterialIcon name="fileDownload" size={18} className={isFetchingSelection ? 'animate-pulse' : ''} />
                  </span>
                  <span className="font-bold text-blue-700">{isFetchingSelection ? '확인 중...' : '가져오기'}</span>
                </button>
              </li>
              <li className="flex items-center text-blue-300" aria-hidden="true">
                <MaterialIcon name="chevronRight" size={18} />
              </li>
              <li className="flex-1 flex flex-col items-center gap-1 py-1.5" title="아래 버튼으로 맞춤법 교정 또는 문장 다듬기 실행">
                <span className="w-8 h-8 rounded-full bg-white text-blue-600 flex items-center justify-center shadow-xs">
                  <MaterialIcon name="autoFixHigh" size={18} />
                </span>
                <span className="font-semibold">교정·다듬기</span>
              </li>
            </ol>

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
                      <MaterialIcon name="article" size={14} className="text-blue-600" />
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
                      <MaterialIcon name="accountBalance" size={14} className="text-blue-600" />
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
                      <MaterialIcon name="checklist" size={14} className="text-blue-600" />
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
                      <MaterialIcon name="translate" size={14} className="text-blue-600" />
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
                      <MaterialIcon name="chat" size={14} className="text-blue-600" />
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

      {/* 본문 교체 확인 팝업: 기안기의 제목·본문을 통째로 덮어쓰기 전에 사용자 승인을 받는다 */}
      {applyConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="apply-confirm-title"
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-3 z-50"
          onKeyDown={(e) => { if (e.key === 'Escape') setApplyConfirm(null); }}
        >
          <div className="bg-white rounded-xl p-4 max-w-sm w-full space-y-3.5 shadow-xl border border-slate-200">
            <h3 id="apply-confirm-title" className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <MaterialIcon name="warning" size={18} className="text-amber-500" />
              <span>기안기 본문 교체 확인</span>
            </h3>
            <p className="text-slate-700 text-xs leading-relaxed">
              기안기의{' '}
              {applyConfirm.title && <strong className="text-blue-700">제목</strong>}
              {applyConfirm.title && applyConfirm.body && '과 '}
              {applyConfirm.body && <strong className="text-blue-700">본문</strong>}
              을(를) 교정본으로 <strong>통째로 교체</strong>합니다.
            </p>
            <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg leading-relaxed space-y-1">
              <p>※ 지금 기안기에 있는 내용은 교정본으로 덮어써집니다.</p>
              <p>※ 자동 저장이나 결재는 진행되지 않습니다. 반영 후 내용을 확인하고 직접 저장하세요.</p>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                autoFocus
                onClick={() => setApplyConfirm(null)}
                className="px-3.5 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold text-xs transition cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleConfirmApply}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-semibold text-xs transition cursor-pointer shadow-xs"
              >
                교체하여 반영
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
