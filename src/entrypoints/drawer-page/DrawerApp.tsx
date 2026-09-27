import { useEffect, useRef, useState } from 'react';
import { loadSettings, DEFAULT_SETTINGS, type Settings } from '@/lib/storage/settings';
import { cleanAdminDraft } from '@/lib/onnara/draft-cleaner';
import { copyDraftToClipboard } from '@/lib/onnara/draft-format';
import {
  buildDraftTitleSystemPrompt,
  extractRecommendedTitleAndDraft,
} from '@/lib/onnara/draft-title';
import {
  buildReferencePrompt,
  generateDocSummary,
  generateRuleBasedSummary,
  type RelatedDocInfo,
} from '@/lib/onnara/related-info';
import {
  type DraftTemplate,
} from '@/lib/onnara/draft-templates';
import {
  loadDraftTemplates,
  onDraftTemplatesChanged,
} from '@/lib/storage/draft-templates';
import { TemplateManager } from './components/TemplateManager';
import { MaterialIcon } from './components/MaterialIcon';

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

  // 관련정보 참고 문서 상태
  const [relatedDocs, setRelatedDocs] = useState<RelatedDocInfo[]>([]);
  const [selectedRelatedDoc, setSelectedRelatedDoc] = useState<RelatedDocInfo | null>(null);
  const [isReferenceExpanded, setIsReferenceExpanded] = useState<boolean>(false);
  const [customRefNotes, setCustomRefNotes] = useState<string>('');
  const [isFetchingRefDoc, setIsFetchingRefDoc] = useState<boolean>(false);
  const [refDocSummaries, setRefDocSummaries] = useState<Record<string, string>>({});
  const [isSummarizing, setIsSummarizing] = useState<boolean>(false);
  const [showRawContent, setShowRawContent] = useState<boolean>(false);
  const [isSettingsFolded, setIsSettingsFolded] = useState<boolean>(false);
  const [isRequestFolded, setIsRequestFolded] = useState<boolean>(false);
  const [isResultFolded, setIsResultFolded] = useState<boolean>(false);

  const resultSectionRef = useRef<HTMLElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const requestedReferenceTitles = useRef<Set<string>>(new Set());

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

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) || null;

  // 부모 윈도우와 통신 리스너
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'DRAFT_CONTEXT_RESPONSE') {
        if (data.title) setDocTitle(data.title);
        if (data.documentKey) setDocumentKey(data.documentKey);
        setNeedsOpenBody(Boolean(data.needsOpenBody));
        setHasWriteBodyBtn(Boolean(data.hasWriteBodyBtn));
        if (Array.isArray(data.relatedDocs) && data.relatedDocs.length > 0) {
          setRelatedDocs(data.relatedDocs);
          setSelectedRelatedDoc((prev) => prev ?? data.relatedDocs[0]);
        }
      } else if (data.type === 'DRAFT_RELATED_DOC_CONTENT') {
        setIsFetchingRefDoc(false);
        const { title, content, error, documentTitle, attachments } = data;
        setRelatedDocs((prev) =>
          prev.map((d) =>
            d.title === title
              ? { ...d, content, documentTitle, attachments, status: content ? 'loaded' : 'error', errorMessage: error }
              : d
          )
        );
        setSelectedRelatedDoc((prev) =>
          prev && prev.title === title
            ? { ...prev, content, documentTitle, attachments, status: content ? 'loaded' : 'error', errorMessage: error }
            : prev
        );
        if (content) {
          setStatusMsg(`'${title}' 본문을 성공적으로 불러왔습니다. (${content.length}자)`);
          setTimeout(() => setStatusMsg(''), 3000);
          triggerDocSummary(title, content);
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
    window.parent.postMessage({ type: 'DRAFT_GET_CONTEXT', requestId: `req_${Date.now()}` }, '*');

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const closeDrawer = () => {
    window.parent.postMessage({ type: 'SAIDE_CLOSE_DRAWER' }, '*');
  };

  const clickOpenBody = () => {
    window.parent.postMessage({ type: 'SAIDE_CLICK_OPEN_BODY' }, '*');
    setStatusMsg('기안기의 [본문작성] 버튼을 호출했습니다.');
    setTimeout(() => setStatusMsg(''), 2500);
  };

  const copyToClipboard = async () => {
    if (!generatedDraft) return;
    const ok = await copyDraftToClipboard(generatedDraft);
    if (ok) {
      setStatusMsg('공문서 표준 서식으로 복사되었습니다. (Ctrl+V로 붙여넣기)');
      setTimeout(() => setStatusMsg(''), 2800);
    } else {
      setStatusMsg('복사 실패');
    }
  };

  const triggerDocSummary = (title: string, content: string) => {
    if (!content || !content.trim()) return;
    // 1. 규칙 기반 요약 즉시 반영
    const initialSummary = generateRuleBasedSummary(content, title);
    setRefDocSummaries((prev) => ({ ...prev, [title]: initialSummary }));

    // 2. Ollama AI 요약 비동기 호출
    setIsSummarizing(true);
    generateDocSummary(content, title, settings)
      .then((aiSummary) => {
        if (aiSummary && aiSummary.trim()) {
          setRefDocSummaries((prev) => ({ ...prev, [title]: aiSummary.trim() }));
        }
      })
      .catch(() => {})
      .finally(() => setIsSummarizing(false));
  };

  useEffect(() => {
    if (selectedRelatedDoc?.content && selectedRelatedDoc.title && !refDocSummaries[selectedRelatedDoc.title]) {
      triggerDocSummary(selectedRelatedDoc.title, selectedRelatedDoc.content);
    }
  }, [selectedRelatedDoc, refDocSummaries]);

  // 참고 문서 본문 조회 요청
  const handleFetchRefContent = (doc: RelatedDocInfo) => {
    requestedReferenceTitles.current.add(doc.title);
    setIsFetchingRefDoc(true);
    window.parent.postMessage({ type: 'DRAFT_FETCH_RELATED_DOC', doc }, '*');
    setStatusMsg(`'${doc.title}' 본문을 조회하는 중입니다...`);
  };

  useEffect(() => {
    if (selectedRelatedDoc && !selectedRelatedDoc.content && !requestedReferenceTitles.current.has(selectedRelatedDoc.title)) {
      handleFetchRefContent(selectedRelatedDoc);
    }
  }, [selectedRelatedDoc]);

  // '내용' 버튼 클릭 토글 (펼칠 때 본문이 없으면 자동으로 본문 읽기 호출)
  const handleToggleExpand = (doc: RelatedDocInfo) => {
    const next = !isReferenceExpanded;
    setIsReferenceExpanded(next);
    if (next && !doc.content && !isFetchingRefDoc) {
      handleFetchRefContent(doc);
    }
  };


  // 서식관리 탭에서 서식을 선택하여 초안 작성으로 전환
  const handleSelectTemplateFromManager = (template: DraftTemplate) => {
    setSelectedTemplateId(template.id);
    setActiveTab('draft');
    setStatusMsg(`'${template.title}' 서식이 적용되었습니다.`);
    setTimeout(() => setStatusMsg(''), 2500);
  };

  // 초안 생성 실행 (로컬 Ollama)
  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    if (selectedRelatedDoc && !selectedRelatedDoc.content?.trim()) {
      if (!isFetchingRefDoc) handleFetchRefContent(selectedRelatedDoc);
      setGenerationError(`'${selectedRelatedDoc.title}'의 본문을 읽은 뒤 초안을 작성할 수 있습니다.`);
      return;
    }
    setIsSettingsFolded(true);
    setIsRequestFolded(false);
    setLoading(true);
    setGenerationError(null);
    setGeneratedDraft('');
    setHasAppliedTitle(false);
    setTitleApplyError(null);

    const effectiveRefDoc = selectedRelatedDoc
      ? {
          ...selectedRelatedDoc,
          content: customRefNotes.trim()
            ? (selectedRelatedDoc.content ? `${selectedRelatedDoc.content}\n\n[추가 참고 메모]\n${customRefNotes.trim()}` : customRefNotes.trim())
            : selectedRelatedDoc.content,
        }
      : null;

    // 참고 문서 및 지정 서식(Template) 반영 프롬프트 생성
    const userMessageContent = buildReferencePrompt({
      userPrompt: prompt,
      docTitle: docTitle || '기안문',
      referenceDoc: effectiveRefDoc,
      template: selectedTemplate,
    });

    let systemPrompt =
      '당신은 대한민국 정부 공문서 작성 전문가 AI입니다. 마크다운 특수기호(##, **, *, _, `, > 등)를 절대 사용하지 마십시오. 대한민국 행정업무운영편람의 표준 서식(1. -> 가. -> (1) -> 1) -> 가) -> (가)) 및 개조식 기호(-, ·)만을 사용하여 정형화된 공문서 어투(~코자 함, ~바람)로 명확하고 간결하게 작성하십시오.';

    if (selectedTemplate) {
      systemPrompt += ` 반드시 지정된 [${selectedTemplate.title}] 서식의 유형(${selectedTemplate.documentType})과 필수 주요 항목 순서(${selectedTemplate.sections.join(' -> ')})에 맞추어 누락 없이 각 항목별 실무 내용을 충실하게 작성하십시오.`;
      if (selectedTemplate.guidance) {
        systemPrompt += ` 서식 준수 지침: ${selectedTemplate.guidance}`;
      }
    }

    systemPrompt += ' 제공된 참고 문서(관련정보)의 추진 배경, 지침, 제출 기한, 서식명, 소관 부서 등의 사실관계를 충실히 반영하고, 사실이 불확실한 날짜나 금액은 [확인 필요: 내용]으로 표시하십시오.';

    // 추천 제목 지침 추가
    systemPrompt = buildDraftTitleSystemPrompt(systemPrompt);

    const requestBody = {
      model: settings.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessageContent },
      ],
      stream: false,
    };

    try {
      const res = await fetch(`${settings.endpoint}/api/chat`, {
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
      '*'
    );
  };

  // 클릭하여 삽입 위치 지정 모드 시작 (유저 제스처 컨텍스트에서 사전 복사)
  const handleStartClickTarget = async () => {
    if (!generatedDraft) return;
    const clean = cleanAdminDraft(generatedDraft);
    await copyDraftToClipboard(clean);
    setIsTargetSelecting(true);
    window.parent.postMessage({ type: 'SAIDE_START_CLICK_TARGET', text: clean }, '*');
    setStatusMsg('기안기 화면에서 초안을 넣을 위치를 클릭하세요. (Esc: 취소)');
  };

  // 타깃 지정 모드 취소
  const handleCancelClickTarget = () => {
    setIsTargetSelecting(false);
    window.parent.postMessage({ type: 'SAIDE_CANCEL_CLICK_TARGET' }, '*');
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
      '*'
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

  /** 참고문서의 실제 데이터 상태를 정확히 구분 */
  const getRefDocContentStatus = (doc: RelatedDocInfo, isSelected: boolean) => {
    if (doc.status === 'error' || doc.errorMessage) {
      return {
        key: 'error' as const,
        label: '오류',
        badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
        detail: doc.errorMessage || '본문을 불러오지 못했습니다.',
      };
    }
    if ((isFetchingRefDoc && isSelected) || doc.status === 'loading') {
      return {
        key: 'loading' as const,
        label: '본문 불러오는 중',
        badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
        detail: '온나라 열린 창에서 본문을 추출하고 있습니다.',
      };
    }
    if (doc.content && doc.content.trim()) {
      return {
        key: 'ready' as const,
        label: `본문 준비됨 (${doc.content.length.toLocaleString()}자)`,
        badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        detail: '본문이 준비되어 AI 작성 시 참고자료로 반영됩니다.',
      };
    }
    return {
      key: 'empty' as const,
      label: '본문 없음',
      badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
      detail: '본문이 아직 추출되지 않았습니다. [본문 읽어오기]를 눌러주세요.',
    };
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

              {/* 1-B. 참고문서 선택 카드 */}
              <div className="p-3 bg-white border border-slate-200 rounded-lg shadow-2xs space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900 text-xs sm:text-[13px]">
                    <MaterialIcon name="attachFile" size={15} className="text-blue-600" />
                    <span>참고문서 선택</span>
                    {relatedDocs.length > 0 && (
                      <span className="text-xs font-normal text-slate-500">
                        ({relatedDocs.length}건 감지됨)
                      </span>
                    )}
                  </div>
                  {selectedRelatedDoc && (
                    <button
                      type="button"
                      onClick={() => setSelectedRelatedDoc(null)}
                      className="text-xs text-slate-500 hover:text-slate-800 underline transition cursor-pointer"
                      title="선택된 참고문서 해제"
                    >
                      참고 해제
                    </button>
                  )}
                </div>

                {relatedDocs.length === 0 ? (
                  <div className="p-2.5 bg-slate-50 border border-dashed border-slate-200 rounded-lg text-center text-xs text-slate-500 leading-relaxed">
                    현재 화면에서 감지된 관련정보 참고문서가 없습니다.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {relatedDocs.map((doc, idx) => {
                      const isSelected = selectedRelatedDoc?.title === doc.title;

                      return (
                        <div
                          key={doc.title || idx}
                          className={`p-2 rounded-lg border transition ${
                            isSelected
                              ? 'bg-blue-50/40 border-blue-300 shadow-2xs'
                              : 'bg-white border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          {/* 1행: 라디오 + 구분 태그 + 문서 제목 + 체크 아이콘(선택 시) + [내용] 버튼(선택 시) */}
                          <div className="flex items-center justify-between gap-2">
                            <label
                              htmlFor={`refdoc-${idx}`}
                              className="flex-1 min-w-0 cursor-pointer flex items-center gap-1.5"
                            >
                              <input
                                type="radio"
                                id={`refdoc-${idx}`}
                                name="relatedDocChoice"
                                checked={isSelected}
                                onChange={() => setSelectedRelatedDoc(isSelected ? null : doc)}
                                className="accent-blue-600 h-4 w-4 cursor-pointer shrink-0 focus-visible:ring-2 focus-visible:ring-blue-500"
                              />
                              <span className="text-[11px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 shrink-0">
                                {doc.type || '문서'}
                              </span>
                              <span
                                className="text-xs sm:text-[13px] font-medium text-slate-900 truncate flex-1"
                                title={doc.title}
                              >
                                {doc.title}
                              </span>
                            </label>

                            {/* 우측: 선택 표시(체크 아이콘) & 내용 확인 버튼 */}
                            {isSelected && (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-blue-600 flex items-center" title="참고문서 선택됨">
                                  <MaterialIcon name="checkCircle" size={16} />
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleToggleExpand(doc)}
                                  className="px-2 py-0.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded text-xs font-medium transition flex items-center gap-1 cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500"
                                  title="참고문서 내용 요약 보기"
                                >
                                  <MaterialIcon name={isReferenceExpanded ? 'arrowUp' : 'arrowDown'} size={13} />
                                  <span>{isReferenceExpanded ? '접기' : '내용'}</span>
                                </button>
                              </div>
                            )}
                          </div>

                          {/* 펼침 영역: 요약 및 추가 메모 (내용 버튼 클릭 시 유지) */}
                          {isSelected && isReferenceExpanded && (
                            <div className="mt-2 pt-2 border-t border-slate-200 space-y-2 text-xs bg-slate-50/70 p-2.5 rounded-lg">
                              <div className="flex items-center justify-between text-slate-700">
                                <span className="font-bold text-xs flex items-center gap-1.5">
                                  <MaterialIcon name="assignment" size={14} className="text-blue-600" />
                                  <span>참고문서 핵심 요약</span>
                                  {isSummarizing && (
                                    <span className="text-[11px] text-blue-600 font-normal animate-pulse">
                                      (AI 요약 정리 중...)
                                    </span>
                                  )}
                                </span>
                                {selectedRelatedDoc.content && (
                                  <button
                                    type="button"
                                    onClick={() => setShowRawContent(!showRawContent)}
                                    className="text-xs text-blue-600 hover:text-blue-800 underline font-medium cursor-pointer"
                                  >
                                    {showRawContent ? '요약 보기' : '원문 전체 보기'}
                                  </button>
                                )}
                              </div>

                              {selectedRelatedDoc.content ? (
                                showRawContent ? (
                                  <div className="p-2.5 bg-white border border-slate-200 rounded max-h-36 overflow-y-auto font-mono text-[11px] leading-relaxed text-slate-700 whitespace-pre-wrap select-text">
                                    {selectedRelatedDoc.content}
                                  </div>
                                ) : (
                                  <div className="p-2.5 bg-white border border-slate-200 rounded max-h-36 overflow-y-auto text-xs leading-relaxed text-slate-800 whitespace-pre-wrap select-text shadow-2xs font-sans">
                                    {refDocSummaries[selectedRelatedDoc.title] ||
                                      generateRuleBasedSummary(selectedRelatedDoc.content, selectedRelatedDoc.title)}
                                  </div>
                                )
                              ) : isFetchingRefDoc ? (
                                <div className="p-3 bg-white border border-slate-200 rounded text-center text-blue-700 text-xs">
                                  <span className="animate-pulse font-medium">열린 탭에서 본문을 조회하고 요약하는 중입니다...</span>
                                </div>
                              ) : (
                                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 space-y-1">
                                  <p className="font-semibold flex items-center gap-1.5">
                                    <MaterialIcon name="warning" size={13} className="text-amber-600" />
                                    <span>본문이 아직 열려 있지 않습니다.</span>
                                  </p>
                                  <p className="text-[11px] text-amber-700 leading-normal">
                                    온나라 화면의 <strong>[관련정보]</strong>에서 해당 문서를 열고 [내용]을 다시 눌러 본문을 읽어주세요.
                                  </p>
                                </div>
                              )}

                              {selectedRelatedDoc.attachments?.length ? (
                                <div className="p-2.5 bg-white border border-slate-200 rounded text-xs text-slate-800">
                                  <div className="font-semibold mb-1">원문 붙임 파일명</div>
                                  {selectedRelatedDoc.attachments.map((name) => <div key={name}>{name}</div>)}
                                </div>
                              ) : null}

                              {/* 사용자 추가 첨언 메모 */}
                              <div>
                                <label htmlFor="ref-doc-custom-notes" className="text-xs text-slate-700 font-semibold block mb-1">
                                  참고문서 관련 추가 요구사항 또는 핵심 메모 (선택사항):
                                </label>
                                <textarea
                                  id="ref-doc-custom-notes"
                                  value={customRefNotes}
                                  onChange={(e) => setCustomRefNotes(e.target.value)}
                                  placeholder="위 내용을 확인하고, 우리 과 상황에 맞게 반영할 변경사항이나 강조할 내용을 적어주세요. (예: 우리 부서 제출 기한은 10월 12일까지로 변경하여 반영할 것)"
                                  className="w-full h-18 p-2 border border-slate-300 rounded bg-white text-xs resize-none focus:outline-none focus:ring-1 focus:ring-blue-500 leading-relaxed"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
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
                        : selectedRelatedDoc
                        ? `예: 위 참고문서 [${selectedRelatedDoc.title}]의 지침에 따라 우리 과 사업 안건 제출 공문 초안 작성해줘.`
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
                  onClick={handleGenerate}
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
                          : selectedRelatedDoc
                          ? '참고문서 반영하여 공문서 초안 생성'
                          : '공문서 초안 생성'}
                      </span>
                    </span>
                  )}
                </button>
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
                      : selectedRelatedDoc
                      ? `AI가 참고문서 [${selectedRelatedDoc.title}]를 반영하여 초안을 작성 중입니다...`
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
                    onClick={handleGenerate}
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
                      className="p-3.5 bg-white border border-slate-300 rounded-lg shadow-2xs whitespace-pre-wrap leading-[1.72] min-h-[180px] max-h-[380px] overflow-y-auto select-text font-sans text-slate-800 text-xs sm:text-sm tracking-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {generatedDraft}
                    </div>
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
