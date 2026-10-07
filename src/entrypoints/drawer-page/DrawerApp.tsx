import { messageOrigin, validatePostMessageEvent } from '@/lib/messaging/draft-protocol';
import { aiFetch } from '@/lib/llm/destination';
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadSettings, DEFAULT_SETTINGS, type Settings } from '@/lib/storage/settings';
import { cleanAdminDraft } from '@/lib/onnara/draft-cleaner';
import { copyDraftToClipboard } from '@/lib/onnara/draft-format';
import {
  buildDraftTitleSystemPrompt,
  extractRecommendedTitleAndDraft,
} from '@/lib/onnara/draft-title';
import {
  buildReferencePrompt,
  analyzeReferenceForDraft,
  generateDocSummary,
  generateRuleBasedSummary,
  type RelatedDocInfo,
} from '@/lib/onnara/related-info';
import {
  buildReferenceContext,
  findUnsupportedFacts,
  MAX_SELECTED_REFS,
  type ReferenceSource,
  type UnsupportedFact,
} from '@/lib/onnara/reference-context';
import { extractCodeFacts, isAnalysisComplete } from '@/lib/onnara/reference-analysis';
import {
  type DraftTemplate,
} from '@/lib/onnara/draft-templates';
import {
  loadDraftTemplates,
  onDraftTemplatesChanged,
} from '@/lib/storage/draft-templates';
import type { UserRef } from '@/lib/storage/user-refs';
import { TemplateManager } from './components/TemplateManager';
import { StyledDraftPreview } from './components/StyledDraftPreview';
import { buildStyledInsert, formatHierarchyPrompt, layoutDraft } from '@/lib/template-format/apply';
import { MaterialIcon } from './components/MaterialIcon';
import { ReferencePicker, onnaraKey, uploadKey } from './components/ReferencePicker';
import { tongdalKey, type TongdalRef } from './components/TongdalRefGroup';
import { getDocument } from '@/lib/tongdal/client';
import { loadConnection } from '@/lib/tongdal/connection';
import { locationOf } from '@/lib/tongdal/evidence';
import type { TongdalSearchHit } from '@/lib/tongdal/types';
import { needsAnalysis, useUserReferences } from './hooks/useUserReferences';
import { estimateTokens } from '@/lib/extract/budget';
import { handoffPrompt } from '@/lib/ai/work-plan';
import { checkRequirements, metCount, type RequirementResult } from '@/lib/ai/requirement-check';
import { clearHandoff, loadHandoff, onHandoffChanged, type StoredHandoff } from '@/lib/storage/work-plan-handoff';

/** 모델 문맥 한도(num_ctx 상한)와 초안 출력 몫. */
const CONTEXT_LIMIT = 32768;
const OUTPUT_TOKENS = 4096;
/**
 * 참고자료 묶음에 쓰는 토큰 상한.
 * ★ CPU에서 입력 처리는 초당 ~131토큰이다. 16K면 입력만 2분 남짓이라, 이보다 크게 잡으면
 *   정확도보다 기다림이 먼저 문제가 된다. 넘치는 분량은 관련 구간 발췌로 줄인다.
 */
const REFERENCE_BUDGET_MAX = 16000;
/** 이보다 긴 관련정보 원문은 구간별 사실 노트를 만들어 함께 넣는다(analyzeReferenceForDraft). */
const LONG_REFERENCE_CHARS = 12_000;
/** [원문 진단 파일 저장] 버튼 표시. 관련정보 원문을 못 읽는 새 사례를 조사할 때만 켠다. */
const SHOW_REFERENCE_DIAGNOSIS = false;

function parentMessageOrigin(): string | null {
  if (window.parent === window) return messageOrigin(location.href);
  return messageOrigin(new URLSearchParams(location.search).get('parentOrigin') || document.referrer);
}

function formatLabel(ref: UserRef): string {
  return { pdf: 'PDF', hwpx: 'HWPX', docx: 'DOCX', xlsx: 'XLSX', text: 'TXT' }[ref.format];
}

export function DrawerApp() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab] = useState<'draft' | 'templates'>('draft');

  // 문서 컨텍스트 상태
  const [docTitle, setDocTitle] = useState<string>('');
  const [documentKey, setDocumentKey] = useState<string>('');
  const [needsOpenBody, setNeedsOpenBody] = useState<boolean>(false);
  const [hasWriteBodyBtn, setHasWriteBodyBtn] = useState<boolean>(false);

  // 초안 작성 상태
  const [prompt, setPrompt] = useState('');
  const [generatedDraft, setGeneratedDraft] = useState('');
  const [recommendedTitle, setRecommendedTitle] = useState<string>('');
  const [isApplyingTitle, setIsApplyingTitle] = useState<boolean>(false);
  const [hasAppliedTitle, setHasAppliedTitle] = useState<boolean>(false);
  const [titleApplyError, setTitleApplyError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [approvalModal, setApprovalModal] = useState<{
    open: boolean;
    token?: string;
    preview?: string;
    targetLabel?: string;
  }>({ open: false });
  const [isTargetSelecting, setIsTargetSelecting] = useState<boolean>(false);

  // 서식(템플릿) 관리 상태
  const [templates, setTemplates] = useState<DraftTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');

  // 참고문서 상태 — 온나라 관련정보와 내 참고자료를 합쳐 최대 3건
  const [relatedDocs, setRelatedDocs] = useState<RelatedDocInfo[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  /** TONGDAL 서고에서 고른 문서. 고를 때 본문을 받아 와 여기 둔다. */
  const [tongdalRefs, setTongdalRefs] = useState<TongdalRef[]>([]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [onnaraMemos, setOnnaraMemos] = useState<Record<string, string>>({});
  const [fetchingTitle, setFetchingTitle] = useState<string | null>(null);
  const [refDocSummaries, setRefDocSummaries] = useState<Record<string, string>>({});
  const [summarizingTitle, setSummarizingTitle] = useState<string | null>(null);
  /** 선택한 내 참고자료의 분석이 끝나지 않았을 때 사용자에게 물을 자료 이름. */
  const [analysisGate, setAnalysisGate] = useState<string[] | null>(null);
  const [generateWhenReady, setGenerateWhenReady] = useState<boolean>(false);
  const [unsupportedFacts, setUnsupportedFacts] = useState<UnsupportedFact[]>([]);
  const [partialRefs, setPartialRefs] = useState<string[]>([]);
  const [isSettingsFolded, setIsSettingsFolded] = useState<boolean>(false);
  const [isRequestFolded, setIsRequestFolded] = useState<boolean>(false);
  const [isResultFolded, setIsResultFolded] = useState<boolean>(false);

  // 업무계획(사이드패널)에서 넘어온 회신 준비 — 요구사항은 원문에서 확인한 것만 기본으로 고른다.
  const [handoff, setHandoff] = useState<StoredHandoff | null>(null);
  const [handoffChosen, setHandoffChosen] = useState<Set<number>>(new Set());
  /** 작성 요청에 채운 요구사항. 초안의 요구사항 점검은 이 목록으로 한다. */
  const [requirements, setRequirements] = useState<string[]>([]);
  const [reqResults, setReqResults] = useState<RequirementResult[] | null>(null);
  const [reqChecking, setReqChecking] = useState<boolean>(false);
  const [reqError, setReqError] = useState<string | null>(null);

  const resultSectionRef = useRef<HTMLElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const requestedReferenceTitles = useRef<Set<string>>(new Set());
  const summaryRequested = useRef<Set<string>>(new Set());
  const autoSelected = useRef(false);
  /** 긴 관련정보 원문의 구간 노트. 초안을 다시 만들 때마다 같은 원문을 다시 분석하지 않는다. */
  const onnaraNotes = useRef<Map<string, string>>(new Map());

  const userRefsApi = useUserReferences({ endpoint: settings.endpoint, model: settings.model, paused: loading });
  const userRefs = userRefsApi.refs;

  // 초안 결과가 생성되거나 주입되면 결과 영역으로 매끄럽게 자동 스크롤
  useEffect(() => {
    if (generatedDraft) {
      const timer = setTimeout(() => {
        resultSectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [generatedDraft]);

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  // 서식 목록 로드 및 변경 구독
  useEffect(() => {
    loadDraftTemplates().then((list) => {
      setTemplates(list);
    });
    return onDraftTemplatesChanged((list) => {
      setTemplates(list);
    });
  }, []);

  // 업무계획에서 보낸 회신 준비를 받는다. 드로어가 열려 있는 동안 새로 보내면 그것으로 바꾼다.
  // ★ 지운 신호(null)로는 카드를 치우지 않는다. 작성 요청에 채운 뒤 저장소를 비워도 화면의 카드는 남아야 한다.
  useEffect(() => {
    const accept = (next: StoredHandoff | null) => {
      if (!next) return;
      setHandoff(next);
      setHandoffChosen(new Set(next.requirements.flatMap((item, index) => (item.verified ? [index] : []))));
    };
    loadHandoff().then(accept).catch(() => {});
    return onHandoffChanged(accept);
  }, []);

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) || null;
  const selectedFormat = selectedTemplate?.format;

  // 서식관리에서 파일로 등록한 본문 서식이 있으면, 초안에 그 서식을 입힌 모양(미리보기·삽입·복사)을 만든다.
  const styledParas = useMemo(
    () => (selectedFormat && generatedDraft ? layoutDraft(cleanAdminDraft(generatedDraft), selectedFormat) : null),
    [selectedFormat, generatedDraft],
  );
  const buildStyled = (clean: string) => (selectedFormat ? buildStyledInsert(clean, selectedFormat) : undefined);

  const selectedOnnara = relatedDocs.filter((doc) => selectedKeys.includes(onnaraKey(doc)));
  const selectedUploads = selectedKeys
    .map((key) => userRefs.find((ref) => uploadKey(ref) === key))
    .filter((ref): ref is UserRef => Boolean(ref));
  const firstSelectedTitle = selectedKeys
    .map((key) => relatedDocs.find((doc) => onnaraKey(doc) === key)?.title ?? userRefs.find((ref) => uploadKey(ref) === key)?.name
      ?? tongdalRefs.find((ref) => ref.key === key)?.title)
    .find(Boolean);

  // 지워진 자료는 선택에서도 뺀다.
  useEffect(() => {
    setSelectedKeys((prev) => {
      const next = prev.filter((key) => !key.startsWith('upload:') || userRefs.some((ref) => uploadKey(ref) === key));
      return next.length === prev.length ? prev : next;
    });
  }, [userRefs]);

  // 부모 윈도우와 통신 리스너
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = parentMessageOrigin();
      if (!origin || !validatePostMessageEvent(event, origin, window.parent)) return;
      const data = event.data;

      if (data.type === 'DRAFT_CONTEXT_RESPONSE') {
        if (data.title) setDocTitle(data.title);
        if (data.documentKey) setDocumentKey(data.documentKey);
        setNeedsOpenBody(Boolean(data.needsOpenBody));
        setHasWriteBodyBtn(Boolean(data.hasWriteBodyBtn));
        if (Array.isArray(data.relatedDocs) && data.relatedDocs.length > 0) {
          setRelatedDocs(data.relatedDocs);
          // 처음 한 번만 첫 관련정보를 골라 둔다(이전 동작 유지).
          if (!autoSelected.current) {
            autoSelected.current = true;
            setSelectedKeys((prev) => (prev.length ? prev : [onnaraKey(data.relatedDocs[0])]));
          }
        }
      } else if (data.type === 'DRAFT_RELATED_DOC_CONTENT') {
        setFetchingTitle(null);
        const { title, content, error, documentTitle, attachments } = data;
        setRelatedDocs((prev) =>
          prev.map((d) =>
            d.title === title && (!data.docId || d.id === data.docId)
              ? { ...d, content, documentTitle, attachments, status: content ? 'loaded' : 'error', errorMessage: error }
              : d
          )
        );
        if (content) {
          setStatusMsg(`'${title}' 본문을 성공적으로 불러왔습니다. (${content.length}자)`);
          setTimeout(() => setStatusMsg(''), 3000);
        } else if (error) {
          setStatusMsg(error);
          setTimeout(() => setStatusMsg(''), 4500);
        }
      } else if (data.type === 'SAIDE_TARGET_INSERT_RESULT') {
        setIsTargetSelecting(false);
        setLoading(false);
        setStatusMsg(data.message || (data.status === 'applied' ? '삽입되었습니다.' : '취소되었습니다.'));
        setTimeout(() => setStatusMsg(''), 3500);
      } else if (data.type === 'DRAFT_PREPARED_RESPONSE') {
        setApprovalModal({
          open: true,
          token: data.approvalToken,
          preview: data.preview,
          targetLabel: data.targetLabel,
        });
      } else if (data.type === 'DRAFT_APPLY_RESPONSE') {
        setLoading(false);
        setApprovalModal({ open: false });
        setStatusMsg(data.message || (data.status === 'applied' ? '본문에 삽입되었습니다.' : '삽입에 실패했습니다.'));
        setTimeout(() => setStatusMsg(''), 3000);
      } else if (data.type === 'SAIDE_FILL_PROMPT' && data.text) {
        setPrompt(data.text);
        setStatusMsg('선택한 내용이 질의 프롬프트로 입력되었습니다.');
        setTimeout(() => setStatusMsg(''), 3000);
      } else if (data.type === 'DRAFT_APPLY_TITLE_RESULT') {
        setIsApplyingTitle(false);
        if (data.success) {
          setHasAppliedTitle(true);
          setTitleApplyError(null);
          if (data.title) setDocTitle(data.title);
          setStatusMsg(data.message || '공문 본 화면의 제목 필드에 반영되었습니다.');
        } else {
          setTitleApplyError(data.message || '제목 반영에 실패했습니다.');
          setStatusMsg(data.message || '제목 반영에 실패했습니다.');
        }
        setTimeout(() => setStatusMsg(''), 3500);
      } else if (data.type === 'SAIDE_SET_DRAFT_PREVIEW') {
        if (data.prompt !== undefined) setPrompt(data.prompt);
        if (data.draft !== undefined) {
          setGeneratedDraft(data.draft);
          setGenerationError(null);
          setIsRequestFolded(Boolean(data.draft.trim()));
          if (data.draft.trim()) setIsResultFolded(false);
        }
        if (data.templateId !== undefined) setSelectedTemplateId(data.templateId);
        if (data.activeTab !== undefined) setActiveTab(data.activeTab);
        if (data.recommendedTitle !== undefined) setRecommendedTitle(data.recommendedTitle);
      }
    };

    window.addEventListener('message', handleMessage);
    // 부모에 초기 맥락 요청
    window.parent.postMessage({ type: 'DRAFT_GET_CONTEXT', requestId: `req_${Date.now()}` }, parentMessageOrigin() ?? location.origin);

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const closeDrawer = () => {
    window.parent.postMessage({ type: 'SAIDE_CLOSE_DRAWER' }, parentMessageOrigin() ?? location.origin);
  };

  const clickOpenBody = () => {
    window.parent.postMessage({ type: 'SAIDE_CLICK_OPEN_BODY' }, parentMessageOrigin() ?? location.origin);
    setStatusMsg('기안기의 [본문작성] 버튼을 호출했습니다.');
    setTimeout(() => setStatusMsg(''), 2500);
  };

  const copyToClipboard = async () => {
    if (!generatedDraft) return;
    const styled = buildStyled(cleanAdminDraft(generatedDraft));
    const ok = await copyDraftToClipboard(generatedDraft, styled);
    if (ok) {
      setStatusMsg(styled
        ? `[${selectedTemplate?.title}] 서식을 입혀 복사했습니다. (Ctrl+V로 붙여넣기)`
        : '공문서 표준 서식으로 복사되었습니다. (Ctrl+V로 붙여넣기)');
      setTimeout(() => setStatusMsg(''), 2800);
    } else {
      setStatusMsg('복사 실패');
    }
  };

  // 선택한 관련정보 문서의 요약을 하나씩 만든다(규칙 기반 즉시 → AI 요약으로 교체).
  useEffect(() => {
    if (summarizingTitle || loading) return;
    const doc = selectedOnnara.find((d) => d.content?.trim() && !summaryRequested.current.has(d.title));
    if (!doc?.content) return;
    summaryRequested.current.add(doc.title);
    setRefDocSummaries((prev) => ({ ...prev, [doc.title]: generateRuleBasedSummary(doc.content!, doc.title) }));
    setSummarizingTitle(doc.title);
    generateDocSummary(doc.content, doc.title, settings)
      .then((aiSummary) => {
        if (aiSummary && aiSummary.trim()) {
          setRefDocSummaries((prev) => ({ ...prev, [doc.title]: aiSummary.trim() }));
        }
      })
      .catch(() => {})
      .finally(() => setSummarizingTitle(null));
  }, [selectedOnnara, summarizingTitle, loading, settings]);

  // 참고 문서 본문 조회 요청
  const handleFetchRefContent = (doc: RelatedDocInfo) => {
    requestedReferenceTitles.current.add(doc.title);
    setFetchingTitle(doc.title);
    window.parent.postMessage({ type: 'DRAFT_FETCH_RELATED_DOC', doc }, parentMessageOrigin() ?? location.origin);
    setStatusMsg(`'${doc.title}' 본문을 조회하는 중입니다...`);
  };

  // 원문을 읽지 못한 관련정보의 실제 화면 구조를 진단 파일로 저장한다(읽기 전용).
  // 버튼은 숨겨 둔다. 새 종류의 문서를 못 읽을 때 SHOW_REFERENCE_DIAGNOSIS를 켜서 다시 쓴다.
  const [diagnosing, setDiagnosing] = useState(false);
  const handleDiagnoseRef = (doc: RelatedDocInfo) => {
    if (diagnosing || typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    setDiagnosing(true);
    setStatusMsg(`'${doc.title}' 원문 화면을 진단하는 중입니다...`);
    chrome.runtime.sendMessage(
      { type: 'DIAGNOSE_RELATED_DOC', doc: { title: doc.title, id: doc.id, url: doc.url, type: doc.type } },
      (response?: { filename?: string; error?: string }) => {
        setDiagnosing(false);
        const error = response?.error || chrome.runtime.lastError?.message;
        setStatusMsg(error ? `진단 실패: ${error}` : `진단 파일을 다운로드 폴더에 저장했습니다: ${response?.filename ?? ''}`);
        setTimeout(() => setStatusMsg(''), 8000);
      },
    );
  };

  // 선택한 관련정보 중 본문이 없는 것을 하나씩 읽어 온다(동시에 여러 원문을 요청하지 않는다).
  useEffect(() => {
    if (fetchingTitle) return;
    const doc = selectedOnnara.find((d) => !d.content && !requestedReferenceTitles.current.has(d.title));
    if (doc) handleFetchRefContent(doc);
  }, [selectedOnnara, fetchingTitle]);

  const handleToggleSelect = (key: string) => {
    setSelectedKeys((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= MAX_SELECTED_REFS) return prev;
      return [...prev, key];
    });
    if (expandedKey === key && key.startsWith('onnara:')) setExpandedKey(null);
  };

  // '내용'·'분석' 버튼 (펼칠 때 관련정보 본문이 없으면 다시 읽어 온다)
  const handleToggleExpand = (key: string) => {
    const next = expandedKey === key ? null : key;
    setExpandedKey(next);
    const doc = relatedDocs.find((d) => onnaraKey(d) === key);
    if (next && doc && !doc.content && !fetchingTitle) handleFetchRefContent(doc);
  };

  /** TONGDAL 서고 문서를 고르거나 뺀다. 고르면 본문(최대 2만 자)을 받아 온다. */
  const handleToggleTongdal = (documentId: string, hit?: TongdalSearchHit) => {
    const key = tongdalKey(documentId);
    if (selectedKeys.includes(key)) {
      setSelectedKeys((prev) => prev.filter((k) => k !== key));
      setTongdalRefs((prev) => prev.filter((ref) => ref.key !== key));
      return;
    }
    if (selectedKeys.length >= MAX_SELECTED_REFS || !hit) return;
    setSelectedKeys((prev) => (prev.includes(key) || prev.length >= MAX_SELECTED_REFS ? prev : [...prev, key]));
    setTongdalRefs((prev) => [...prev.filter((ref) => ref.key !== key), {
      key, documentId, title: hit.title, location: locationOf(hit), text: null, loading: true, error: null,
    }]);
    void (async () => {
      let text: string | null = null;
      let error: string | null = null;
      try {
        const detail = await getDocument(await loadConnection(), documentId, { includeText: true, maxChars: 20_000 });
        if (detail.text?.indexed && detail.text.content.trim()) text = detail.text.content;
        else error = 'TONGDAL.ai가 아직 이 문서의 글자를 뽑지 못했습니다(색인 전).';
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      setTongdalRefs((prev) => prev.map((ref) => (ref.key === key ? { ...ref, text, error, loading: false } : ref)));
    })();
  };

  const handleUpload = async (files: File[]) => {
    const ids = await userRefsApi.upload(files);
    if (!ids.length) return;
    // 올린 자료를 자리가 남는 만큼 바로 고른다.
    setSelectedKeys((prev) => {
      const next = [...prev];
      for (const id of ids) {
        const key = `upload:${id}`;
        if (!next.includes(key) && next.length < MAX_SELECTED_REFS) next.push(key);
      }
      return next;
    });
    setStatusMsg(`${ids.length}건을 내 참고자료에 보관했습니다. 원문 분석은 뒤에서 이어집니다.`);
    setTimeout(() => setStatusMsg(''), 3500);
  };

  // 서식관리 탭에서 서식을 선택하여 초안 작성으로 전환
  const handleSelectTemplateFromManager = (template: DraftTemplate) => {
    setSelectedTemplateId(template.id);
    setActiveTab('draft');
    setStatusMsg(`'${template.title}' 서식이 적용되었습니다.`);
    setTimeout(() => setStatusMsg(''), 2500);
  };

  /** 선택 순서대로 초안 프롬프트용 자료를 만든다. */
  const buildSources = (): ReferenceSource[] =>
    selectedKeys.flatMap((key): ReferenceSource[] => {
      const doc = relatedDocs.find((d) => onnaraKey(d) === key);
      if (doc?.content) {
        return [{
          key,
          origin: 'onnara',
          role: 'fact',
          title: doc.documentTitle || doc.title,
          docType: doc.type,
          docNumber: doc.docNumber,
          text: doc.content,
          memo: onnaraMemos[doc.title],
          attachments: doc.attachments,
          codeFacts: extractCodeFacts(doc.content),
          notes: onnaraNotes.current.get(`${doc.title}#${doc.content.length}`),
        }];
      }
      const shelf = tongdalRefs.find((r) => r.key === key);
      if (shelf) {
        if (!shelf.text) return [];
        return [{
          key,
          origin: 'tongdal',
          role: 'fact',
          title: shelf.title,
          docType: '서고',
          text: shelf.text,
          codeFacts: extractCodeFacts(shelf.text),
        }];
      }
      const ref = userRefs.find((r) => uploadKey(r) === key);
      if (!ref) return [];
      const complete = isAnalysisComplete(ref.analysis, ref.role, settings.model);
      return [{
        key,
        origin: 'upload',
        role: ref.role,
        title: ref.name,
        docType: formatLabel(ref),
        text: ref.text,
        memo: ref.memo,
        codeFacts: ref.codeFacts,
        fact: complete ? ref.analysis?.fact : undefined,
        example: complete ? ref.analysis?.example : undefined,
      }];
    });

  /**
   * 넘어온 회신 준비로 작성 요청을 채운다. 고른 요구사항은 초안을 만든 뒤 점검 목록이 된다.
   * ★ 채우면 저장소의 묶음은 지운다 — 다음에 여는 다른 기안에 같은 요구사항이 다시 뜨지 않게 한다.
   */
  const applyHandoff = () => {
    if (!handoff) return;
    const chosen = handoff.requirements.filter((_, index) => handoffChosen.has(index)).map((item) => item.text);
    setPrompt(handoffPrompt(handoff, chosen));
    setRequirements(chosen);
    setReqResults(null);
    setReqError(null);
    setIsRequestFolded(false);
    void clearHandoff();
    setStatusMsg('업무계획의 회신 요구사항을 작성 요청에 채웠습니다. 내용을 확인한 뒤 초안을 생성하세요.');
    setTimeout(() => setStatusMsg(''), 3500);
  };

  const dismissHandoff = () => {
    void clearHandoff();
    setHandoff(null);
  };

  const toggleHandoffItem = (index: number) => {
    setHandoffChosen((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  // 초안이 요구사항을 담았는지 점검한다. 모델의 판정은 초안에서 인용을 확인한 것만 충족으로 센다.
  const handleCheckRequirements = async () => {
    if (!generatedDraft.trim() || !requirements.length || reqChecking) return;
    setReqChecking(true);
    setReqError(null);
    try {
      setReqResults(await checkRequirements(settings, requirements, generatedDraft));
    } catch (e) {
      setReqError(e instanceof Error ? e.message : String(e));
    } finally {
      setReqChecking(false);
    }
  };

  // 초안 생성 실행 (로컬 Ollama)
  const handleGenerate = async (force = false) => {
    if (!prompt.trim()) return;
    const unread = selectedOnnara.find((doc) => !doc.content?.trim());
    if (unread) {
      if (!fetchingTitle) handleFetchRefContent(unread);
      setGenerationError(`'${unread.title}'의 본문을 읽은 뒤 초안을 작성할 수 있습니다.`);
      return;
    }
    const shelfPending = tongdalRefs.find((ref) => selectedKeys.includes(ref.key) && !ref.text);
    if (shelfPending) {
      setGenerationError(shelfPending.loading
        ? `'${shelfPending.title}'의 본문을 TONGDAL.ai에서 받는 중입니다. 잠시 후 다시 누르세요.`
        : `'${shelfPending.title}'의 본문을 받지 못했습니다. 선택을 빼거나 TONGDAL.ai 상태를 확인하세요.`);
      return;
    }
    const pending = selectedUploads.filter((ref) => needsAnalysis(ref, settings.model));
    if (!force && pending.length) {
      setAnalysisGate(pending.map((ref) => ref.name));
      return;
    }
    setAnalysisGate(null);
    setGenerateWhenReady(false);
    setIsSettingsFolded(true);
    setIsRequestFolded(false);
    setLoading(true);
    setGenerationError(null);
    setGeneratedDraft('');
    setHasAppliedTitle(false);
    setTitleApplyError(null);
    setUnsupportedFacts([]);
    setPartialRefs([]);
    // 지난 초안의 점검 결과를 새 초안에 붙여 두지 않는다.
    setReqResults(null);
    setReqError(null);

    // 긴 관련정보 원문은 모든 구간을 읽힌 사실 노트를 함께 넣는다(한 번 만든 노트는 다시 쓰지 않는다).
    try {
      for (const doc of selectedOnnara) {
        const cacheKey = `${doc.title}#${doc.content!.length}`;
        if (doc.content!.length > LONG_REFERENCE_CHARS && !onnaraNotes.current.has(cacheKey)) {
          setStatusMsg(`'${doc.title}' 전체 내용을 분석하고 있습니다...`);
          onnaraNotes.current.set(cacheKey, await analyzeReferenceForDraft(doc.content!, doc.title, settings));
          setStatusMsg('');
        }
      }
    } catch (error) {
      setStatusMsg('');
      setGenerationError(error instanceof Error ? error.message : String(error));
      setLoading(false);
      return;
    }

    const sources = buildSources();
    const hasFact = sources.some((source) => source.role === 'fact');
    const hasExample = sources.some((source) => source.role === 'example');

    let systemPrompt =
      '당신은 대한민국 정부 공문서 작성 전문가 AI입니다. 마크다운 특수기호(##, **, *, _, `, > 등)를 절대 사용하지 마십시오. 대한민국 행정업무운영편람의 표준 서식(1. -> 가. -> (1) -> 1) -> 가) -> (가)) 및 개조식 기호(-, ·)만을 사용하여 정형화된 공문서 어투(~코자 함, ~바람)로 명확하고 간결하게 작성하십시오.';

    if (selectedTemplate) {
      systemPrompt += ` 반드시 지정된 [${selectedTemplate.title}] 서식의 유형(${selectedTemplate.documentType})과 필수 주요 항목 순서(${selectedTemplate.sections.join(' -> ')})에 맞추어 누락 없이 각 항목별 실무 내용을 충실하게 작성하십시오.`;
      if (selectedTemplate.guidance) {
        systemPrompt += ` 서식 준수 지침: ${selectedTemplate.guidance}`;
      }
      if (selectedTemplate.format) {
        const hierarchy = formatHierarchyPrompt(selectedTemplate.format);
        if (hierarchy) systemPrompt += ` ${hierarchy}`;
      }
    }

    if (hasFact || !sources.length) {
      systemPrompt += ' 제공된 참고 문서(관련정보)의 추진 배경, 지침, 제출 기한, 서식명, 소관 부서 등의 사실관계를 충실히 반영하고, 사실이 불확실한 날짜나 금액은 [확인 필요: 내용]으로 표시하십시오.';
    }
    if (hasExample) {
      systemPrompt += ' 작성 예시로 제공된 문서는 구성·번호 체계·문체만 본뜨고, 그 문서의 날짜·금액·기관·사업 내용은 새 공문에 옮기지 마십시오.';
    }

    // 추천 제목 지침 추가
    systemPrompt = buildDraftTitleSystemPrompt(systemPrompt);

    // 참고자료 묶음이 쓸 수 있는 토큰: 한도 − 출력 − 시스템 − 참고자료를 뺀 프롬프트 − 여유
    const basePrompt = buildReferencePrompt({ userPrompt: prompt, docTitle: docTitle || '기안문', template: selectedTemplate });
    const available = CONTEXT_LIMIT - OUTPUT_TOKENS - estimateTokens(systemPrompt + basePrompt) - 800;
    const referenceContext = sources.length
      ? buildReferenceContext(sources, prompt, Math.min(REFERENCE_BUDGET_MAX, available))
      : null;

    const userMessageContent = buildReferencePrompt({
      userPrompt: prompt,
      docTitle: docTitle || '기안문',
      template: selectedTemplate,
      referenceContext,
    });

    const requiredContext = estimateTokens(systemPrompt + userMessageContent) + OUTPUT_TOKENS;
    if (requiredContext > CONTEXT_LIMIT) {
      setGenerationError('작성 요청과 서식만으로 모델의 32K 컨텍스트 한도를 넘었습니다. 요청 내용을 줄여 주세요.');
      setLoading(false);
      return;
    }

    const requestBody = {
      model: settings.model,
      options: { num_ctx: Math.max(8192, Math.ceil(requiredContext / 1024) * 1024) },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessageContent },
      ],
      stream: false,
    };

    try {
      const res = await aiFetch(settings.endpoint, '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) throw new Error(`Ollama 응답 오류 (${res.status})`);
      const json = await res.json();
      const raw = json.message?.content || '';
      const { title: recTitle, draft: cleanDraft } = extractRecommendedTitleAndDraft(
        raw,
        prompt,
        docTitle
      );
      setRecommendedTitle(recTitle);
      setGeneratedDraft(cleanDraft);
      if (sources.length) {
        setUnsupportedFacts(findUnsupportedFacts(cleanDraft, sources, prompt));
        setPartialRefs(referenceContext?.partial ?? []);
        void userRefsApi.touch(selectedUploads.map((ref) => ref.id));
      }
      if (cleanDraft.trim()) {
        setIsRequestFolded(true);
        setIsResultFolded(false);
      }
    } catch (e: any) {
      setGenerationError(e?.message ? `로컬 AI 모델(Ollama) 통신 실패: ${e.message}` : '로컬 AI 모델(Ollama)과 통신하지 못했습니다.');
      setGeneratedDraft('');
    } finally {
      setLoading(false);
    }
  };

  // '분석 끝나면 생성'을 고른 경우: 선택한 자료의 분석이 모두 끝나면 초안을 만든다.
  useEffect(() => {
    if (!generateWhenReady || loading) return;
    if (selectedUploads.every((ref) => !needsAnalysis(ref, settings.model))) {
      setGenerateWhenReady(false);
      void handleGenerate(true);
    }
  });

  // 공문 본 화면의 '제목' 필드에 추천 제목 반영
  const handleApplyTitle = () => {
    if (!recommendedTitle.trim() || isApplyingTitle) return;
    setIsApplyingTitle(true);
    setTitleApplyError(null);
    setStatusMsg('공문 본 화면의 제목 필드에 반영하는 중입니다...');
    window.parent.postMessage(
      {
        type: 'DRAFT_APPLY_TITLE',
        title: recommendedTitle.trim(),
      },
      parentMessageOrigin() ?? location.origin
    );
  };

  // 클릭하여 삽입 위치 지정 모드 시작 (유저 제스처 컨텍스트에서 사전 복사)
  const handleStartClickTarget = async () => {
    if (!generatedDraft) return;
    const clean = cleanAdminDraft(generatedDraft);
    const styled = buildStyled(clean);
    await copyDraftToClipboard(clean, styled);
    setIsTargetSelecting(true);
    window.parent.postMessage({ type: 'SAIDE_START_CLICK_TARGET', text: styled?.text ?? clean, ...(styled ? { styled } : {}) }, parentMessageOrigin() ?? location.origin);
    setStatusMsg('기안기 화면에서 초안을 넣을 위치를 클릭하세요. (Esc: 취소)');
  };

  // 타깃 지정 모드 취소
  const handleCancelClickTarget = () => {
    setIsTargetSelecting(false);
    window.parent.postMessage({ type: 'SAIDE_CANCEL_CLICK_TARGET' }, parentMessageOrigin() ?? location.origin);
    setStatusMsg('위치 지정이 취소되었습니다.');
    setTimeout(() => setStatusMsg(''), 2500);
  };

  // 2단계: 사용자 명시적 최종 승인
  const handleConfirmApply = () => {
    if (!approvalModal.token) return;
    setLoading(true);
    window.parent.postMessage(
      {
        type: 'DRAFT_APPLY_INSERT',
        requestId: `req_${Date.now()}`,
        approvalToken: approvalModal.token,
        text: generatedDraft,
      },
      parentMessageOrigin() ?? location.origin
    );
  };

  // Enter로 초안 생성 시작, Shift + Enter는 줄바꿈 (한글 조합 중 실행 방지)
  const handlePromptKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!loading && prompt.trim()) {
        void handleGenerate();
      }
    }
  };
  return (
    <div className="flex flex-col h-full bg-slate-50 text-slate-800 text-[13.5px]">
      {/* ── 상단 헤더: 온나라 sAIde 브랜드 + 기안 코파일럿 시스템 명칭 ── */}
      <header className="flex items-center justify-between px-3.5 py-2.5 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-2 select-none">
          {/* 플랫폼 브랜드 */}
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block shadow-2xs" />
            <span className="font-bold text-slate-900 text-sm tracking-tight">
              온나라 s<span className="text-blue-600 font-extrabold">AI</span>de
            </span>
          </div>

          {/* 시스템 레벨 구분 디바이더 */}
          <span className="h-3 w-px bg-slate-300" aria-hidden="true" />

          {/* 시스템 명칭 레이블 */}
          <div className="flex items-center gap-1 font-semibold text-sm tracking-tight">
            <span className="text-slate-800 font-bold">기안</span>
            <span className="font-extrabold text-blue-600 flex items-center gap-0.5">
              <span>코파일럿</span>
              <svg className="w-3.5 h-3.5 text-blue-500 fill-current ml-0.5" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z" />
              </svg>
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={closeDrawer}
          className="text-slate-400 hover:text-slate-700 p-1 rounded-md hover:bg-slate-100 transition flex items-center justify-center cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500"
          title="사이드카 접기 (Esc)"
          aria-label="사이드카 닫기"
        >
          <MaterialIcon name="close" size={18} />
        </button>
      </header>

      {/* ── 상단 탭 메뉴: 초안 작성 / 서식관리 (서식관리는 별도 관리 화면) ── */}
      <nav className="flex items-center border-b border-slate-200 bg-white px-3 gap-1 pt-1.5 shrink-0" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'draft'}
          onClick={() => setActiveTab('draft')}
          className={`px-3 py-2 font-semibold text-xs sm:text-[13px] border-b-2 transition flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'draft'
              ? 'border-blue-600 text-blue-700 bg-blue-50/60 rounded-t'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-t'
          }`}
        >
          <MaterialIcon name="edit" size={16} />
          <span>초안 작성</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'templates'}
          onClick={() => setActiveTab('templates')}
          className={`px-3 py-2 font-semibold text-xs sm:text-[13px] border-b-2 transition flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'templates'
              ? 'border-blue-600 text-blue-700 bg-blue-50/60 rounded-t'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-t'
          }`}
        >
          <MaterialIcon name="description" size={16} />
          <span>서식관리</span>
          {templates.length > 0 && (
            <span className="text-[11px] px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600 font-bold border border-slate-200">
              {templates.length}
            </span>
          )}
        </button>
      </nav>

      {/* ── 탭 2: 서식관리 화면 (별도 관리 도구) ── */}
      {activeTab === 'templates' ? (
        <TemplateManager
          templates={templates}
          onSelectTemplateForDraft={handleSelectTemplateFromManager}
          onRefreshTemplates={() => {
            loadDraftTemplates().then(setTemplates);
          }}
        />
      ) : (
        /* ── 탭 1: 공문 초안 작성 화면 (작성 설정 → 작성 요청 → 생성 결과 → 온나라에 적용) ── */
        <>
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-3.5 space-y-4">
            {/* 본문작성 화면 진입 안내 배너 (문서관리카드 상태일 때) */}
            {needsOpenBody && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 space-y-1.5 shadow-2xs">
                <div className="flex items-center justify-between font-bold text-xs">
                  <span className="flex items-center gap-1.5 text-amber-800">
                    <MaterialIcon name="lightbulb" size={15} />
                    <span>본문 에디터 열기 필요</span>
                  </span>
                  {hasWriteBodyBtn && (
                    <button
                      type="button"
                      onClick={clickOpenBody}
                      className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-semibold transition cursor-pointer"
                    >
                      [본문작성] 열기
                    </button>
                  )}
                </div>
                <p className="text-xs leading-normal text-amber-800">
                  현재 화면은 문서관리카드입니다. 본문 안에 초안을 삽입하시려면 기안기 상단의 <strong>[본문작성]</strong> 버튼을 먼저 클릭해 본문 편집창을 열어주세요.
                </p>
              </div>
            )}

            {/* 업무계획(사이드패널)에서 넘어온 회신 준비. 고른 요구사항으로 작성 요청을 채운다. */}
            {handoff && (
              <section aria-labelledby="handoff-title" className="p-3 bg-white border border-blue-200 rounded-lg shadow-2xs space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h2 id="handoff-title" className="font-bold text-slate-900 text-xs sm:text-[13px] flex items-center gap-1.5 min-w-0">
                    <MaterialIcon name="assignment" size={15} className="text-blue-600 shrink-0" />
                    <span className="truncate">업무계획에서 넘어온 회신 준비</span>
                  </h2>
                  <button
                    type="button"
                    onClick={dismissHandoff}
                    className="text-slate-400 hover:text-slate-700 p-0.5 rounded cursor-pointer"
                    title="회신 준비 닫기"
                    aria-label="회신 준비 닫기"
                  >
                    <MaterialIcon name="close" size={14} />
                  </button>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  <strong className="text-slate-900">{handoff.source.title}</strong>
                  {handoff.requester ? ` · ${handoff.requester}` : ''} · {handoff.requestType}
                </p>
                {handoff.requirements.length > 0 ? (
                  <ul className="space-y-1" aria-label="회신에 담을 요구사항">
                    {handoff.requirements.map((item, index) => (
                      <li key={`${item.text}-${index}`}>
                        <label className="flex items-start gap-2 text-xs text-slate-800 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={handoffChosen.has(index)}
                            onChange={() => toggleHandoffItem(index)}
                            className="mt-0.5 accent-blue-600"
                          />
                          <span className="flex-1">{item.text}</span>
                          <span className={`shrink-0 text-[11px] font-semibold px-1.5 rounded border ${item.verified ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-amber-800 bg-amber-50 border-amber-200'}`}>
                            {item.verified ? '원문 확인' : '원문 미확인'}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500">업무계획에서 회신 요구사항을 찾지 못했습니다. 요지와 기한만 채웁니다.</p>
                )}
                {handoff.deadlines.some((deadline) => deadline.verified) && (
                  <p className="text-[11px] text-slate-600">
                    기한: {handoff.deadlines.filter((deadline) => deadline.verified).map((deadline) => deadline.text).join(' / ')}
                  </p>
                )}
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={applyHandoff}
                    className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition cursor-pointer"
                  >
                    작성 요청에 채우기
                  </button>
                </div>
              </section>
            )}

            {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                영역 1: 작성 설정 (서식 선택 & 참고문서 선택을 동일 위계로 배치)
               ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            <section aria-labelledby="section-settings-title" className="space-y-3">
              <div className="flex items-center justify-between gap-2 pb-1 border-b border-slate-200">
                <h2 id="section-settings-title" className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-700 font-bold text-xs flex items-center justify-center border border-slate-300">
                    1
                  </span>
                  <span>작성 설정</span>
                </h2>
                <button
                  type="button"
                  aria-expanded={!isSettingsFolded}
                  aria-controls="section-settings-content"
                  onClick={() => setIsSettingsFolded((folded) => !folded)}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 rounded px-1 py-0.5 cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <span>서식 및 참고문서 지정</span>
                  <MaterialIcon name={isSettingsFolded ? 'arrowDown' : 'arrowUp'} size={14} />
                  <span className="sr-only">{isSettingsFolded ? '펼치기' : '접기'}</span>
                </button>
              </div>

              <div id="section-settings-content" hidden={isSettingsFolded} className="space-y-3">
              {/* 1-A. 서식 선택 카드 */}
              <div className="p-3 bg-white border border-slate-200 rounded-lg shadow-2xs space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900 text-xs sm:text-[13px]">
                    <MaterialIcon name="description" size={15} className="text-blue-600" />
                    <span>서식 선택</span>
                    {selectedTemplate && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.2 rounded">
                        <MaterialIcon name="check" size={12} />
                        <span>선택됨</span>
                      </span>
                    )}
                  </div>
                  {selectedTemplate && (
                    <button
                      type="button"
                      onClick={() => setSelectedTemplateId('')}
                      className="text-xs text-slate-500 hover:text-slate-800 underline transition cursor-pointer"
                      title="선택된 서식 해제"
                    >
                      서식 해제
                    </button>
                  )}
                </div>

                {/* 서식 선택 드롭다운 */}
                <div>
                  <select
                    id="template-select"
                    value={selectedTemplateId}
                    onChange={(e) => setSelectedTemplateId(e.target.value)}
                    className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs sm:text-[13px] text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                  >
                    <option value="">-- 서식 미선택 (자유 형식 기안문) --</option>
                    {templates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        [{tpl.documentType}] {tpl.title} ({tpl.sections.length}개 항목)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 1-B. 참고문서 선택 카드 (온나라 관련정보 + 내 참고자료, 최대 3건) */}
              <ReferencePicker
                selectedKeys={selectedKeys}
                expandedKey={expandedKey}
                onToggleSelect={handleToggleSelect}
                onClearAll={() => { setSelectedKeys([]); setExpandedKey(null); setTongdalRefs([]); }}
                onToggleExpand={handleToggleExpand}
                onRetry={handleFetchRefContent}
                onDiagnose={SHOW_REFERENCE_DIAGNOSIS ? handleDiagnoseRef : undefined}
                diagnosing={diagnosing}
                relatedDocs={relatedDocs}
                fetchingTitle={fetchingTitle}
                refDocSummaries={refDocSummaries}
                summarizingTitle={summarizingTitle}
                onnaraMemos={onnaraMemos}
                onOnnaraMemo={(title, memo) => setOnnaraMemos((prev) => ({ ...prev, [title]: memo }))}
                model={settings.model}
                userRefs={userRefs}
                uploads={userRefsApi.uploads}
                analyzing={userRefsApi.analyzing}
                loadError={userRefsApi.loadError}
                onUpload={(files) => void handleUpload(files)}
                onDismissUpload={userRefsApi.dismissUpload}
                onRole={(id, role) => void userRefsApi.setRole(id, role)}
                onMemo={(id, memo) => void userRefsApi.setMemo(id, memo)}
                onReanalyze={(id) => void userRefsApi.reanalyze(id)}
                onDelete={(id) => void userRefsApi.remove(id)}
                tongdalRefs={tongdalRefs}
                onToggleTongdal={handleToggleTongdal}
              />
              </div>
            </section>

            {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                영역 2: 작성 요청 (설명적 라벨, 충분한 높이의 textarea, 도움말, 초안 생성 버튼)
                (선택된 서식의 상태 배지는 제목 옆에 중복 표시하지 않음)
               ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            <section aria-labelledby="section-request-title" className="space-y-3">
              <div className="flex items-center justify-between gap-2 pb-1 border-b border-slate-200">
                <h2 id="section-request-title" className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-700 font-bold text-xs flex items-center justify-center border border-slate-300">
                    2
                  </span>
                  <span>작성 요청</span>
                </h2>
                <button
                  type="button"
                  aria-expanded={!isRequestFolded}
                  aria-controls="section-request-content"
                  onClick={() => setIsRequestFolded((folded) => !folded)}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 rounded px-1 py-0.5 cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <span>핵심 내용 및 요구사항</span>
                  <MaterialIcon name={isRequestFolded ? 'arrowDown' : 'arrowUp'} size={14} />
                  <span className="sr-only">{isRequestFolded ? '펼치기' : '접기'}</span>
                </button>
              </div>

              <div id="section-request-content" hidden={isRequestFolded} className="p-3 bg-white border border-slate-200 rounded-lg space-y-2.5 shadow-2xs">
                <div>
                  <label htmlFor="draft-prompt-textarea" className="font-semibold text-xs sm:text-[13px] text-slate-800 block mb-1">
                    기안할 공문서의 핵심 내용이나 개요
                  </label>
                  <textarea
                    id="draft-prompt-textarea"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={handlePromptKeyDown}
                    placeholder={
                      selectedTemplate
                        ? `[${selectedTemplate.title}] 서식에 맞추어 작성할 핵심 메모나 요구사항을 입력하세요. (AI가 서식 항목 순서와 표준 공문 어투에 맞춰 완성합니다.)`
                        : firstSelectedTitle
                        ? `예: 위 참고문서 [${firstSelectedTitle}]의 지침에 따라 우리 과 사업 안건 제출 공문 초안 작성해줘.`
                        : '예: 2026년 공공 AI 업무혁신 추진계획. 추진배경과 3대 전략을 개조식으로 작성해줘.'
                    }
                    className="w-full h-28 min-h-[7rem] p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-xs sm:text-sm resize-y bg-white leading-relaxed placeholder:text-slate-400"
                  />
                </div>

                <div className="flex items-center justify-between text-xs text-slate-500 px-0.5">
                  <span>Enter: 초안 생성 · Shift + Enter: 줄바꿈</span>
                  {prompt.trim().length > 0 && <span>{prompt.trim().length}자</span>}
                </div>

                <button
                  type="button"
                  onClick={() => void handleGenerate()}
                  disabled={loading || !prompt.trim()}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-lg font-semibold text-sm transition flex items-center justify-center gap-2 shadow-xs cursor-pointer disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>AI 초안 작성 중...</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <MaterialIcon name="autoAwesome" size={16} />
                      <span>
                        {selectedTemplate
                          ? `[${selectedTemplate.title}] 서식으로 초안 생성`
                          : selectedKeys.length
                          ? `참고문서 ${selectedKeys.length}건 반영하여 공문서 초안 생성`
                          : '공문서 초안 생성'}
                      </span>
                    </span>
                  )}
                </button>

                {/* 선택한 내 참고자료의 분석이 끝나지 않았을 때: 기다릴지, 코드 추출 사실만으로 지금 만들지 묻는다 */}
                {generateWhenReady ? (
                  <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900 flex items-center justify-between gap-2" role="status">
                    <span className="animate-pulse">내 참고자료 분석이 끝나면 초안을 자동으로 생성합니다...</span>
                    <button type="button" onClick={() => setGenerateWhenReady(false)} className="shrink-0 px-2 py-1 bg-white border border-blue-300 text-blue-700 rounded font-semibold cursor-pointer">대기 취소</button>
                  </div>
                ) : analysisGate ? (
                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-2" role="alert">
                    <p className="leading-relaxed">
                      선택한 내 참고자료 <strong>{analysisGate.join(', ')}</strong>의 정밀 분석이 아직 끝나지 않았습니다.
                    </p>
                    <div className="flex flex-wrap gap-1.5 justify-end">
                      <button type="button" onClick={() => setAnalysisGate(null)} className="px-2 py-1 border border-amber-300 bg-white text-amber-800 rounded cursor-pointer">취소</button>
                      <button type="button" onClick={() => void handleGenerate(true)} className="px-2 py-1 border border-amber-300 bg-white text-amber-800 rounded font-semibold cursor-pointer" title="코드가 원문에서 찾은 날짜·금액·법령과 원문 발췌만으로 작성합니다">지금 생성</button>
                      <button type="button" onClick={() => { setAnalysisGate(null); setGenerateWhenReady(true); }} className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded font-semibold cursor-pointer">분석 끝나면 생성</button>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            {/* 초안 생성 중 애니메이션 인디케이터 */}
            {loading && (
              <div className="p-3.5 bg-blue-50/60 border border-blue-200 rounded-lg space-y-2.5 animate-pulse">
                <div className="flex items-center gap-2 text-blue-700 font-semibold text-xs">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-600" />
                  </span>
                  <span>
                    {selectedTemplate
                      ? `AI가 [${selectedTemplate.title}] 서식의 ${selectedTemplate.sections.length}개 주요 항목에 맞추어 작성 중입니다...`
                      : selectedKeys.length
                      ? `AI가 참고문서 ${selectedKeys.length}건을 반영하여 초안을 작성 중입니다...`
                      : 'AI가 공문서 추천 제목과 표준 서식 초안을 작성 중입니다...'}
                  </span>
                </div>
                <div className="space-y-2 pt-1">
                  <div className="h-2.5 bg-blue-200/60 rounded-full w-11/12" />
                  <div className="h-2.5 bg-blue-200/50 rounded-full w-4/5" />
                  <div className="h-2.5 bg-blue-200/60 rounded-full w-5/6" />
                  <div className="h-2.5 bg-blue-200/40 rounded-full w-3/5" />
                </div>
              </div>
            )}

            {/* 초안 생성 오류 안내 (오류 문구를 생성된 초안으로 취급하지 않음) */}
            {generationError && !loading && (
              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-lg space-y-2 text-rose-900" role="alert">
                <div className="flex items-center justify-between font-bold text-xs">
                  <span className="flex items-center gap-1.5 text-rose-700">
                    <MaterialIcon name="warning" size={16} />
                    <span>초안 생성 실패</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setGenerationError(null)}
                    className="text-rose-500 hover:text-rose-700 p-0.5 rounded cursor-pointer"
                    title="오류 닫기"
                  >
                    <MaterialIcon name="close" size={14} />
                  </button>
                </div>
                <p className="text-xs text-rose-800 leading-relaxed font-mono whitespace-pre-wrap bg-white/70 p-2 rounded border border-rose-200">
                  {generationError}
                </p>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-rose-600">
                    로컬 AI 모델(Ollama) 설정과 서비스 상태를 확인해주세요.
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleGenerate()}
                    disabled={loading || !prompt.trim()}
                    className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-semibold transition cursor-pointer"
                  >
                    다시 시도
                  </button>
                </div>
              </div>
            )}

            {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                영역 3: 생성 결과 (결과가 생성되었을 때만 표시)
                - 추천 제목: 수정 가능한 입력창과 '제목 반영' 버튼을 한 그룹으로 배치
                - 초안 본문: 결과의 중심 콘텐츠, 넉넉한 글자 크기(14px)와 줄 간격
                - 서식 복사/초안 복사 중복 제거: 복사 동작은 하단 고정 동작 영역에만 배치
               ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            {(generatedDraft || recommendedTitle) && !loading && !generationError && (
              <section ref={resultSectionRef} aria-labelledby="section-result-title" className="space-y-3">
                <div className="flex items-center justify-between gap-2 pb-1 border-b border-slate-200">
                  <h2 id="section-result-title" className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center border border-blue-300">
                      3
                    </span>
                    <span>생성 결과</span>
                  </h2>
                  <button
                    type="button"
                    aria-expanded={!isResultFolded}
                    aria-controls="section-result-content"
                    onClick={() => setIsResultFolded((folded) => !folded)}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 rounded px-1 py-0.5 cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <span>제목 반영 및 본문 확인</span>
                    <MaterialIcon name={isResultFolded ? 'arrowDown' : 'arrowUp'} size={14} />
                    <span className="sr-only">{isResultFolded ? '펼치기' : '접기'}</span>
                  </button>
                </div>

                <div id="section-result-content" hidden={isResultFolded} className="space-y-3">
                {/* 3-A. 추천 공문 제목 그룹 (입력창 + 제목 반영 버튼 + 상태 표시) */}
                <div className="p-3 bg-white border border-slate-200 rounded-lg shadow-2xs space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="recommended-title-input" className="font-bold text-slate-900 text-xs sm:text-[13px] flex items-center gap-1.5">
                      <MaterialIcon name="label" size={15} className="text-blue-600" />
                      <span>추천 공문 제목</span>
                    </label>

                    {/* 제목 반영 상태 인디케이터 */}
                    {isApplyingTitle ? (
                      <span className="text-xs text-blue-700 font-medium flex items-center gap-1">
                        <span className="w-3 h-3 border-2 border-blue-600/30 border-t-blue-600 rounded-full animate-spin" />
                        <span>반영 중...</span>
                      </span>
                    ) : hasAppliedTitle ? (
                      <span className="text-xs text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded flex items-center gap-1">
                        <MaterialIcon name="check" size={13} />
                        <span>공문 본 화면 반영됨</span>
                      </span>
                    ) : titleApplyError ? (
                      <span className="text-xs text-rose-600 font-medium flex items-center gap-1">
                        <MaterialIcon name="warning" size={13} />
                        <span>{titleApplyError}</span>
                      </span>
                    ) : null}
                  </div>

                  <div className="flex gap-2 items-center">
                    <input
                      id="recommended-title-input"
                      type="text"
                      value={recommendedTitle}
                      onChange={(e) => {
                        setRecommendedTitle(e.target.value);
                        setHasAppliedTitle(false);
                        setTitleApplyError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleApplyTitle();
                        }
                      }}
                      placeholder="초안에 적합한 공문 제목을 입력하거나 수정하세요"
                      className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs sm:text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                    />
                    <button
                      type="button"
                      onClick={handleApplyTitle}
                      disabled={!recommendedTitle.trim() || isApplyingTitle}
                      className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-lg text-xs font-bold transition shrink-0 flex items-center gap-1 shadow-2xs cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500"
                      title="공문 본 화면의 '제목' 필드에 즉시 입력합니다"
                    >
                      <span>제목 반영</span>
                    </button>
                  </div>
                </div>

                {/* 3-B. 초안 본문 영역 (결과의 중심 콘텐츠로 편안한 읽기 환경 제공) */}
                {generatedDraft && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="font-bold text-slate-900 text-xs sm:text-[13px] flex items-center gap-1.5">
                        <MaterialIcon name="description" size={15} className="text-slate-700" />
                        <span>공문서 초안 본문</span>
                      </label>
                      <span className="text-xs text-slate-500 font-medium">
                        {generatedDraft.length.toLocaleString()}자
                      </span>
                    </div>
                    <div
                      tabIndex={0}
                      aria-label="생성된 공문서 초안 본문"
                      className={`p-3.5 bg-white border border-slate-300 rounded-lg shadow-2xs min-h-[180px] max-h-[380px] overflow-y-auto select-text text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 ${styledParas ? '' : 'whitespace-pre-wrap leading-[1.72] font-sans text-xs sm:text-sm tracking-tight'}`}
                    >
                      {styledParas && selectedTemplate
                        ? <StyledDraftPreview paras={styledParas} templateTitle={selectedTemplate.title} />
                        : generatedDraft}
                    </div>
                  </div>
                )}

                {/* 3-C. 생성 후 사실 대조: 참고자료·작성 요청에 없는 날짜·금액 */}
                {generatedDraft && (unsupportedFacts.length > 0 || partialRefs.length > 0) && (
                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-1.5" role="note">
                    {unsupportedFacts.length > 0 && (
                      <div>
                        <p className="font-bold flex items-center gap-1.5">
                          <MaterialIcon name="warning" size={14} className="text-amber-600" />
                          <span>[확인 필요] 참고자료와 작성 요청에서 찾지 못한 날짜·금액</span>
                        </p>
                        <p className="mt-1 leading-relaxed">{unsupportedFacts.map((f) => f.text).join(', ')}</p>
                        <p className="text-[11px] text-amber-700">모델이 지어냈거나 작성 예시에서 옮겨 적었을 수 있습니다. 삽입 전에 확인하세요.</p>
                      </div>
                    )}
                    {partialRefs.length > 0 && (
                      <p className="text-[11px] text-amber-800">분량이 많아 관련 구간만 반영한 참고자료: {partialRefs.join(', ')}</p>
                    )}
                  </div>
                )}

                {/* 3-D. 업무계획 요구사항 점검: 초안에서 인용을 확인한 것만 충족으로 센다 */}
                {generatedDraft && requirements.length > 0 && (
                  <div className="p-3 bg-white border border-slate-200 rounded-lg shadow-2xs space-y-2" aria-labelledby="requirement-check-title">
                    <div className="flex items-center justify-between gap-2">
                      <p id="requirement-check-title" className="font-bold text-slate-900 text-xs sm:text-[13px] flex items-center gap-1.5">
                        <MaterialIcon name="taskAlt" size={15} className="text-blue-600" />
                        <span>요구사항 점검</span>
                        {reqResults && (
                          <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 rounded">
                            {metCount(reqResults)}/{reqResults.length} 충족
                          </span>
                        )}
                      </p>
                      <button
                        type="button"
                        onClick={() => void handleCheckRequirements()}
                        disabled={reqChecking}
                        className="px-2.5 py-1 border border-blue-300 bg-white hover:bg-blue-50 disabled:text-slate-400 text-blue-700 rounded text-xs font-semibold transition cursor-pointer disabled:cursor-not-allowed"
                      >
                        {reqChecking ? '점검 중...' : reqResults ? '다시 점검' : '요구사항 점검'}
                      </button>
                    </div>
                    <ul className="space-y-1.5">
                      {requirements.map((requirement, index) => {
                        const result = reqResults?.[index];
                        const label = !result ? '점검 전' : result.status === 'met' ? '충족' : result.status === 'missing' ? '빠짐' : '확인 못함';
                        const tone = !result
                          ? 'text-slate-600 bg-slate-50 border-slate-200'
                          : result.status === 'met'
                          ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                          : result.status === 'missing'
                          ? 'text-rose-700 bg-rose-50 border-rose-200'
                          : 'text-amber-800 bg-amber-50 border-amber-200';
                        return (
                          <li key={`${requirement}-${index}`} className="text-xs text-slate-800">
                            <div className="flex items-start gap-2">
                              <span className="flex-1">{requirement}</span>
                              <span className={`shrink-0 text-[11px] font-semibold px-1.5 rounded border ${tone}`}>{label}</span>
                            </div>
                            {result?.quote && (
                              <p className="mt-0.5 pl-2 border-l-2 border-slate-300 text-[11px] text-slate-500">{result.quote}</p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {reqError && <p className="text-[11px] text-rose-700" role="alert">{reqError}</p>}
                    <p className="text-[11px] text-slate-500">AI 판정 중 초안에서 인용을 확인한 것만 충족으로 셉니다. 확인 못함은 직접 살펴보세요.</p>
                  </div>
                )}
                </div>
              </section>
            )}

            {/* 상태 알림 메시지 */}
            {statusMsg && (
              <div
                role="status"
                aria-live="polite"
                className="p-2.5 bg-blue-50 border border-blue-200 text-blue-900 rounded-lg text-center font-medium text-xs shadow-2xs"
              >
                {statusMsg}
              </div>
            )}
          </div>

          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
              하단 고정 동작 영역
              - 결과가 있을 때: '초안 복사'와 '본문에 삽입'(주요 동작) 표시
              - 삽입 위치 선택 중: 안내 문구와 '선택 취소' 표시
             ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          <footer className="p-3 bg-white border-t border-slate-200 shrink-0">
            {isTargetSelecting ? (
              <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between gap-2">
                <span className="text-blue-900 font-medium text-xs flex items-center gap-1.5 flex-1 min-w-0">
                  <MaterialIcon name="adsClick" size={16} className="text-blue-600 shrink-0" />
                  <span className="truncate">기안기 화면에서 초안을 넣을 위치를 클릭하세요 (Esc 취소)</span>
                </span>
                <button
                  type="button"
                  onClick={handleCancelClickTarget}
                  className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-blue-300 text-blue-700 rounded-md text-xs font-semibold transition shrink-0 shadow-2xs cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  선택 취소
                </button>
              </div>
            ) : generatedDraft ? (
              <div className="flex gap-2 items-center">
                <button
                  type="button"
                  onClick={copyToClipboard}
                  disabled={loading}
                  className="px-3.5 py-2.5 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-lg font-semibold text-xs sm:text-sm whitespace-nowrap shadow-2xs transition flex items-center gap-1.5 cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500"
                  title="정제된 표준 공문서 초안을 클립보드에 복사합니다 (Ctrl+V로 붙여넣기)"
                >
                  <MaterialIcon name="contentCopy" size={15} />
                  <span>초안 복사</span>
                </button>
                <button
                  type="button"
                  onClick={handleStartClickTarget}
                  disabled={loading}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-xs sm:text-sm whitespace-nowrap px-4 shadow-xs flex items-center justify-center gap-1.5 transition cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500"
                  title="기안기 본문 또는 원하는 입력창을 클릭하여 즉시 삽입합니다"
                >
                  <MaterialIcon name="adsClick" size={16} />
                  <span>본문에 삽입</span>
                </button>
              </div>
            ) : null}
          </footer>

          {/* 2단계 명시적 승인 모달 (본문 삽입 사전 확인) */}
          {approvalModal.open && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="approval-modal-title"
              className="fixed inset-0 bg-black/40 flex items-center justify-center p-3 z-50"
            >
              <div className="bg-white rounded-xl p-4 max-w-sm w-full space-y-3.5 shadow-xl border border-slate-200">
                <h3 id="approval-modal-title" className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <MaterialIcon name="warning" size={18} className="text-amber-500" />
                  <span>본문 삽입 사전 확인</span>
                </h3>
                <p className="text-slate-700 text-xs leading-relaxed">
                  기안기 <span className="font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">{approvalModal.targetLabel}</span>에 생성된 초안을 직접 입력합니다.
                </p>
                <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg leading-relaxed">
                  ※ 자동 저장이나 결재는 진행되지 않습니다. 삽입 후 기안기 본문에서 내용을 최종 검토하고 직접 저장하세요.
                </div>
                <div className="flex gap-2 justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => setApprovalModal({ open: false })}
                    className="px-3.5 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold text-xs transition cursor-pointer"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmApply}
                    className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-semibold text-xs transition cursor-pointer shadow-xs"
                  >
                    이 문서에 삽입
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
