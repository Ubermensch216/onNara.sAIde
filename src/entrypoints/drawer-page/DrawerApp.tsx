import { useEffect, useState } from 'react';
import { loadSettings, DEFAULT_SETTINGS, type Settings } from '@/lib/storage/settings';
import { cleanAdminDraft } from '@/lib/onnara/draft-cleaner';
import { copyDraftToClipboard } from '@/lib/onnara/draft-format';
import {
  buildReferencePrompt,
  generateDocSummary,
  generateRuleBasedSummary,
  type RelatedDocInfo,
} from '@/lib/onnara/related-info';
import {
  generateTemplateOutline,
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
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [approvalModal, setApprovalModal] = useState<{
    open: boolean;
    token?: string;
    preview?: string;
    targetLabel?: string;
  }>({ open: false });
  const [isTargetSelecting, setIsTargetSelecting] = useState<boolean>(false);

  // 📑 서식(템플릿) 관리 상태
  const [templates, setTemplates] = useState<DraftTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');

  // 📎 관련정보 참고 문서 상태
  const [relatedDocs, setRelatedDocs] = useState<RelatedDocInfo[]>([]);
  const [selectedRelatedDoc, setSelectedRelatedDoc] = useState<RelatedDocInfo | null>(null);
  const [isReferenceExpanded, setIsReferenceExpanded] = useState<boolean>(false);
  const [customRefNotes, setCustomRefNotes] = useState<string>('');
  const [isFetchingRefDoc, setIsFetchingRefDoc] = useState<boolean>(false);
  const [refDocSummaries, setRefDocSummaries] = useState<Record<string, string>>({});
  const [isSummarizing, setIsSummarizing] = useState<boolean>(false);
  const [showRawContent, setShowRawContent] = useState<boolean>(false);

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
          setSelectedRelatedDoc(prev => prev ?? data.relatedDocs[0]);
        }
      } else if (data.type === 'DRAFT_RELATED_DOC_CONTENT') {
        setIsFetchingRefDoc(false);
        const { title, content, error } = data;
        setRelatedDocs(prev =>
          prev.map(d =>
            d.title === title
              ? { ...d, content, status: content ? 'loaded' : 'error', errorMessage: error }
              : d
          )
        );
        setSelectedRelatedDoc(prev =>
          prev && prev.title === title
            ? { ...prev, content, status: content ? 'loaded' : 'error', errorMessage: error }
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
        setStatusMsg('선택한 본문 내용이 질의 프롬프트로 입력되었습니다.');
        setTimeout(() => setStatusMsg(''), 3000);
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
    setRefDocSummaries(prev => ({ ...prev, [title]: initialSummary }));

    // 2. Ollama AI 요약 비동기 호출
    setIsSummarizing(true);
    generateDocSummary(content, title, settings)
      .then(aiSummary => {
        if (aiSummary && aiSummary.trim()) {
          setRefDocSummaries(prev => ({ ...prev, [title]: aiSummary.trim() }));
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
    setIsFetchingRefDoc(true);
    setIsReferenceExpanded(true); // 본문 조회를 누르면 패널을 열어 진행 상황과 요약을 바로 볼 수 있게 함
    window.parent.postMessage({ type: 'DRAFT_FETCH_RELATED_DOC', doc }, '*');
    setStatusMsg(`'${doc.title}' 본문을 조회하는 중입니다...`);
  };

  // '내용' 버튼 클릭 토글 (펼칠 때 본문이 없으면 자동으로 본문 읽기 호출)
  const handleToggleExpand = (doc: RelatedDocInfo) => {
    const next = !isReferenceExpanded;
    setIsReferenceExpanded(next);
    if (next && !doc.content && !isFetchingRefDoc) {
      handleFetchRefContent(doc);
    }
  };

  // 선택된 서식의 주요 항목 골격을 입력창(prompt)에 불러오기
  const handleInsertTemplateOutline = () => {
    if (!selectedTemplate) return;
    const outline = generateTemplateOutline(selectedTemplate);
    if (!prompt.trim()) {
      setPrompt(outline);
    } else {
      setPrompt((prev) => `${prev.trim()}\n\n[지정 서식 항목 골격]\n${outline}`);
    }
    setStatusMsg(`'${selectedTemplate.title}' 서식의 주요 항목 골격이 입력창에 반영되었습니다.`);
    setTimeout(() => setStatusMsg(''), 2800);
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
    setLoading(true);
    setGeneratedDraft('');

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
      const clean = cleanAdminDraft(raw);
      setGeneratedDraft(clean);
    } catch (e: any) {
      setGeneratedDraft(`[오류 발생: 로컬 AI 모델(Ollama)과 통신하지 못했습니다]\n\n원인: ${e.message}\n설정 확인: ${settings.endpoint}`);
    } finally {
      setLoading(false);
    }
  };

  // 🎯 클릭하여 삽입 위치 지정 모드 시작 (유저 제스처 컨텍스트에서 사전 복사)
  const handleStartClickTarget = async () => {
    if (!generatedDraft) return;
    const clean = cleanAdminDraft(generatedDraft);
    await copyDraftToClipboard(clean);
    setIsTargetSelecting(true);
    window.parent.postMessage({ type: 'SAIDE_START_CLICK_TARGET', text: clean }, '*');
    setStatusMsg('🎯 기안기 화면에서 초안을 넣을 위치를 클릭하세요. (Esc: 취소)');
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

  return (
    <div className="flex flex-col h-full bg-slate-50 text-slate-800 text-xs">
      {/* 상단 헤더 */}
      <header className="flex items-center justify-between px-3 py-2 bg-white border-b border-slate-200">
        <div className="flex items-center gap-1.5 font-bold text-slate-900 text-sm">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block"></span>
          <span>온나라 sAIde</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold border border-blue-200">
            기안 도우미
          </span>
        </div>
        <button
          onClick={closeDrawer}
          className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-100 font-bold"
          title="사이드카 접기 (Esc)"
        >
          ✕
        </button>
      </header>

      {/* 🧭 사이드카 탭 메뉴 (초안 작성 / 서식관리) */}
      <nav className="flex items-center border-b border-slate-200 bg-white px-3 gap-1 pt-1.5 shrink-0" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'draft'}
          onClick={() => setActiveTab('draft')}
          className={`px-3 py-1.5 font-semibold text-xs border-b-2 transition flex items-center gap-1.5 ${
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
          className={`px-3 py-1.5 font-semibold text-xs border-b-2 transition flex items-center gap-1.5 ${
            activeTab === 'templates'
              ? 'border-blue-600 text-blue-700 bg-blue-50/60 rounded-t'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-t'
          }`}
        >
          <MaterialIcon name="description" size={16} />
          <span>서식관리</span>
          {templates.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600 font-bold border border-slate-200">
              {templates.length}
            </span>
          )}
        </button>
      </nav>

      {/* ── 탭 2: 서식관리 화면 ── */}
      {activeTab === 'templates' ? (
        <TemplateManager
          templates={templates}
          onSelectTemplateForDraft={handleSelectTemplateFromManager}
          onRefreshTemplates={() => {
            loadDraftTemplates().then(setTemplates);
          }}
        />
      ) : (
        /* ── 탭 1: 공문 초안 작성 화면 ── */
        <>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {/* 📑 공문서 서식 지정 카드 */}
            <div className="p-2.5 bg-white border border-blue-200 rounded-lg shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <label className="font-bold text-slate-800 text-[11px] flex items-center gap-1.5">
                  <span className="text-blue-600">📑</span>
                  <span>적용할 공문서 서식 선택</span>
                </label>
                <button
                  type="button"
                  onClick={() => setActiveTab('templates')}
                  className="text-[10px] text-blue-600 hover:underline font-semibold"
                >
                  서식 관리 / 추가 ⚙️
                </button>
              </div>

              {/* 서식 선택 드롭다운 */}
              <div className="flex items-center gap-1.5">
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="flex-1 px-2 py-1.5 bg-slate-50 border border-slate-300 rounded text-xs text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white"
                >
                  <option value="">-- 서식 미선택 (자유 형식 기안문) --</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      [{tpl.documentType}] {tpl.title} ({tpl.sections.length}개 항목)
                    </option>
                  ))}
                </select>
                {selectedTemplateId && (
                  <button
                    type="button"
                    onClick={() => setSelectedTemplateId('')}
                    className="px-2 py-1.5 text-slate-400 hover:text-slate-600 border border-slate-200 rounded text-[11px] bg-slate-50"
                    title="서식 선택 해제"
                  >
                    해제
                  </button>
                )}
              </div>

              {/* 선택된 서식의 간단한 정보 표시 */}
              {selectedTemplate && (
                <div className="p-2 bg-blue-50/70 border border-blue-200 rounded space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.2 bg-blue-600 text-white rounded text-[10px] font-bold">
                        {selectedTemplate.documentType}
                      </span>
                      <span className="font-bold text-blue-900">{selectedTemplate.title}</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleInsertTemplateOutline}
                      className="px-2 py-0.5 bg-white border border-blue-300 text-blue-700 hover:bg-blue-100 rounded text-[10.5px] font-semibold transition shadow-2xs"
                      title="입력창에 서식의 주요 항목 목차를 골격으로 채웁니다"
                    >
                      📝 항목 골격 입력창에 넣기
                    </button>
                  </div>

                  {selectedTemplate.description && (
                    <p className="text-[10.5px] text-slate-600 leading-tight">
                      {selectedTemplate.description}
                    </p>
                  )}

                </div>
              )}
            </div>

            {/* 📎 관련정보 참고 문서 카드 */}
            {relatedDocs.length > 0 && (
              <div className="p-2.5 bg-indigo-50/90 border border-indigo-200 rounded-md text-indigo-950 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-[11px]">
                    <span className="text-indigo-600">📎</span>
                    <span>관련정보 참고 문서 ({relatedDocs.length}건)</span>
                  </div>
                  {selectedRelatedDoc ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-100 text-indigo-800 border border-indigo-200">
                      {selectedRelatedDoc.content
                        ? `본문 준비됨 (${selectedRelatedDoc.content.length}자)`
                        : isFetchingRefDoc
                        ? '불러오는 중...'
                        : '참고 적용 중'}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400">참고 안 함</span>
                  )}
                </div>

                {/* 관련문서 목록 / 선택 칩 */}
                <div className="space-y-1">
                  {relatedDocs.map((doc, idx) => {
                    const isSelected = selectedRelatedDoc?.title === doc.title;
                    return (
                      <div
                        key={idx}
                        className={`flex items-center justify-between p-1.5 rounded text-[11px] transition ${
                          isSelected
                            ? 'bg-white border border-indigo-300 shadow-xs'
                            : 'bg-indigo-50/50 hover:bg-white/70 border border-transparent'
                        }`}
                      >
                        <label className="flex items-center gap-1.5 cursor-pointer overflow-hidden flex-1 mr-2">
                          <input
                            type="radio"
                            name="selectedRelatedDoc"
                            checked={isSelected}
                            onChange={() => setSelectedRelatedDoc(isSelected ? null : doc)}
                            className="accent-indigo-600 cursor-pointer"
                          />
                          <span className="font-semibold text-indigo-700 whitespace-nowrap text-[10px] bg-indigo-100/80 px-1 py-0.2 rounded">
                            [{doc.type || '문서'}]
                          </span>
                          <span className="truncate font-medium text-slate-800" title={doc.title}>
                            {doc.title}
                          </span>
                        </label>

                        {isSelected && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleToggleExpand(doc)}
                              className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-[10px] font-semibold transition"
                              title="참고 문서 내용 요약 보기 및 메모 첨언"
                            >
                              {isReferenceExpanded ? '접기' : '내용'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleFetchRefContent(doc)}
                              disabled={isFetchingRefDoc}
                              className="px-1.5 py-0.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 disabled:text-slate-400 rounded text-[10px] font-medium transition"
                              title="열린 탭에서 본문 새로고침/다시 읽기"
                            >
                              {isFetchingRefDoc ? '읽는 중...' : '본문읽기'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setSelectedRelatedDoc(null)}
                              className="text-slate-400 hover:text-slate-700 px-1 text-[11px]"
                              title="참고 해제"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* 펼쳐진 참고 본문 미리보기 및 추가 메모 영역 */}
                {selectedRelatedDoc && isReferenceExpanded && (
                  <div className="pt-2 border-t border-indigo-200/80 space-y-2 text-[11px]">
                    <div className="flex items-center justify-between text-slate-700">
                      <span className="font-bold text-[11px] flex items-center gap-1.5">
                        <span>📋</span>
                        <span>참고 문서 핵심 요약</span>
                        {isSummarizing && (
                          <span className="text-[10px] text-indigo-600 font-normal animate-pulse">
                            (AI 요약 중...)
                          </span>
                        )}
                      </span>
                      {selectedRelatedDoc.content && (
                        <button
                          type="button"
                          onClick={() => setShowRawContent(!showRawContent)}
                          className="text-[10px] text-indigo-600 hover:text-indigo-800 underline font-medium"
                        >
                          {showRawContent ? '요약 보기' : '원문 전체 보기'}
                        </button>
                      )}
                    </div>

                    {selectedRelatedDoc.content ? (
                      showRawContent ? (
                        <div className="p-2 bg-white border border-slate-200 rounded max-h-32 overflow-y-auto font-mono text-[10px] leading-relaxed text-slate-700 whitespace-pre-wrap select-text">
                          {selectedRelatedDoc.content}
                        </div>
                      ) : (
                        <div className="p-2.5 bg-white border border-indigo-200 rounded max-h-32 overflow-y-auto text-[11px] leading-relaxed text-slate-800 whitespace-pre-wrap select-text shadow-2xs font-sans">
                          {refDocSummaries[selectedRelatedDoc.title] || generateRuleBasedSummary(selectedRelatedDoc.content, selectedRelatedDoc.title)}
                        </div>
                      )
                    ) : isFetchingRefDoc ? (
                      <div className="p-3 bg-white border border-indigo-200 rounded text-center text-indigo-700 text-xs">
                        <span className="animate-pulse font-medium">열린 탭에서 본문을 조회하고 요약하는 중입니다...</span>
                      </div>
                    ) : (
                      <div className="p-2.5 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-800 space-y-1">
                        <p className="font-semibold">⚠️ 본문이 아직 열려 있지 않습니다.</p>
                        <p className="text-[10px] text-amber-700 leading-tight">
                          온나라 화면의 <strong>[관련정보]</strong>에서 문서를 클릭해 창을 띄워두신 후 <strong>[본문읽기]</strong>를 누르시거나, 아래 메모장에 핵심 내용을 직접 적어주세요.
                        </p>
                      </div>
                    )}

                    {/* 사용자가 첨언할 수 있는 지금 화면 유지 */}
                    <div>
                      <label className="text-[10px] text-slate-600 font-semibold block mb-0.5">
                        참고 문서 관련 추가 요구사항 또는 핵심 메모 (첨언):
                      </label>
                      <textarea
                        value={customRefNotes}
                        onChange={(e) => setCustomRefNotes(e.target.value)}
                        placeholder="위 요약 내용을 확인하고, 우리 과 상황에 맞게 반영할 변경사항이나 강조할 내용을 적어주세요. (예: 3페이지 서식에 따라 우리 부서 제출 기한은 10월 12일까지로 변경하여 반영할 것)"
                        className="w-full h-16 p-2 border border-slate-300 rounded bg-white text-xs resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500 leading-relaxed"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 본문작성 화면 안내 배너 (문서관리카드 상태일 때) */}
            {needsOpenBody && (
              <div className="p-2.5 bg-amber-50/90 border border-amber-200 rounded-md text-amber-900 space-y-1.5">
                <div className="flex items-center justify-between font-bold text-[11px]">
                  <span>💡 본문 에디터 열기 필요</span>
                  {hasWriteBodyBtn && (
                    <button
                      onClick={clickOpenBody}
                      className="px-2 py-0.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-[10px] font-semibold transition"
                    >
                      [본문작성] 열기
                    </button>
                  )}
                </div>
                <p className="text-[11px] leading-tight text-amber-800">
                  현재 화면은 문서관리카드입니다. 본문 안에 붙여넣으시려면 기안기 상단의 <strong>[본문작성]</strong> 버튼을 먼저 클릭해 본문 편집창을 열어주세요.
                </p>
              </div>
            )}

            {/* 입력 영역 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-slate-700 block">
                  작성할 공문서 개요 또는 핵심 메모
                </label>
                {selectedTemplate && (
                  <span className="text-[10px] text-blue-700 font-semibold bg-blue-50 px-1.5 py-0.2 rounded border border-blue-200">
                    [{selectedTemplate.title}] 서식 적용 중
                  </span>
                )}
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={
                  selectedTemplate
                    ? `[${selectedTemplate.title}] 서식에 맞추어 작성할 내용을 입력하세요.\n(상단의 '📝 항목 골격 입력창에 넣기'를 눌러 목차별 내용을 직접 채우거나 핵심 메모만 적어도 AI가 서식에 맞춰 완성합니다.)`
                    : selectedRelatedDoc
                    ? `예: 위 참고 문서 [${selectedRelatedDoc.title}]의 지침에 따라 우리 과 사업 안건 제출 공문 초안 작성해줘.`
                    : '예: 2026년 공공 AI 업무혁신 추진계획. 추진배경과 3대 전략을 개조식으로 작성해줘.'
                }
                className="w-full h-24 p-2 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs resize-none bg-white leading-relaxed"
              />
              <button
                onClick={handleGenerate}
                disabled={loading || !prompt.trim()}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded font-semibold transition flex items-center justify-center gap-1.5 shadow-2xs"
              >
                {loading ? (
                  <span>AI 초안 작성 중...</span>
                ) : selectedTemplate ? (
                  <span>✨ [{selectedTemplate.title}] 서식으로 초안 생성</span>
                ) : selectedRelatedDoc ? (
                  <span>✨ 관련정보 참고하여 공문서 초안 생성</span>
                ) : (
                  <span>✨ 공문서 초안 생성</span>
                )}
              </button>
            </div>

            {/* 옅은 초안 생성 중 애니메이션 인디케이터 */}
            {loading && (
              <div className="p-3 bg-blue-50/70 border border-blue-200/80 rounded-lg space-y-2.5">
                <div className="flex items-center gap-2 text-blue-700 font-semibold text-[11px]">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-600"></span>
                  </span>
                  <span>
                    {selectedTemplate
                      ? `AI가 [${selectedTemplate.title}] 서식의 ${selectedTemplate.sections.length}개 주요 항목에 맞추어 작성 중입니다...`
                      : selectedRelatedDoc
                      ? `AI가 참고 문서 [${selectedRelatedDoc.title}]를 반영하여 초안을 작성 중입니다...`
                      : 'AI가 행정 공문서 표준 서식으로 초안을 작성 중입니다...'}
                  </span>
                </div>
                {/* 옅은 스켈레톤 라인 애니메이션 */}
                <div className="animate-pulse space-y-2 pt-1">
                  <div className="h-2.5 bg-blue-200/60 rounded-full w-11/12"></div>
                  <div className="h-2.5 bg-blue-200/50 rounded-full w-4/5"></div>
                  <div className="h-2.5 bg-blue-200/60 rounded-full w-5/6"></div>
                  <div className="h-2.5 bg-blue-200/40 rounded-full w-3/5"></div>
                </div>
              </div>
            )}

            {/* 결과 표시 영역 */}
            {generatedDraft && !loading && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700 flex items-center gap-1.5 flex-wrap">
                    <span>📄 공문서 초안</span>
                    {selectedTemplate ? (
                      <span className="text-[10px] text-blue-800 bg-blue-50 border border-blue-200 px-1 py-0.2 rounded font-bold">
                        {selectedTemplate.documentType} 서식 적용됨
                      </span>
                    ) : (
                      <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1 py-0.2 rounded font-medium">
                        표준 서식
                      </span>
                    )}
                  </span>
                  <button
                    onClick={copyToClipboard}
                    className="text-[11px] text-blue-600 hover:underline font-semibold"
                  >
                    📋 서식 복사
                  </button>
                </div>
                <div className="p-3 bg-white border border-slate-300 rounded-lg shadow-sm whitespace-pre-wrap leading-[1.68] max-h-64 overflow-y-auto select-text font-sans text-slate-800 text-[11.5px] tracking-tight">
                  {generatedDraft}
                </div>
              </div>
            )}

            {statusMsg && (
              <div className="p-2 bg-blue-50 border border-blue-200 text-blue-800 rounded text-center font-medium">
                {statusMsg}
              </div>
            )}
          </div>

          {/* 하단 액션 바 */}
          <footer className="p-3 bg-white border-t border-slate-200 space-y-2 shrink-0">
            {isTargetSelecting ? (
              <div className="p-2 bg-blue-50 border border-blue-200 rounded flex items-center justify-between">
                <span className="text-blue-800 font-semibold text-[11px]">🎯 기안기 화면에서 초안을 넣을 위치를 클릭하세요</span>
                <button
                  onClick={handleCancelClickTarget}
                  className="px-2.5 py-1 bg-white border border-blue-300 text-blue-700 rounded text-[11px] font-semibold hover:bg-blue-100"
                >
                  선택 취소
                </button>
              </div>
            ) : (
              <div className="flex gap-2 items-center">
                <button
                  onClick={copyToClipboard}
                  disabled={!generatedDraft || loading}
                  className="px-4 py-2 border border-slate-300 rounded-md font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap text-xs shadow-sm transition"
                  title="정제된 초안을 클립보드에 복사"
                >
                  📋 초안 복사
                </button>
                <button
                  onClick={handleStartClickTarget}
                  disabled={!generatedDraft || loading}
                  className="flex-1 py-2 bg-blue-600 text-white rounded-md font-semibold hover:bg-blue-700 disabled:opacity-40 whitespace-nowrap px-3 shadow-sm text-xs flex items-center justify-center gap-1.5 transition"
                  title="원하는 본문이나 입력창을 클릭하여 즉시 삽입합니다."
                >
                  <span>🎯</span>
                  <span>클릭한 위치에 삽입</span>
                </button>
              </div>
            )}
          </footer>

          {/* 2단계 명시적 승인 모달 */}
          {approvalModal.open && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-3 z-50">
              <div className="bg-white rounded-lg p-4 max-w-xs w-full space-y-3 shadow-xl border border-slate-200">
                <h3 className="font-bold text-slate-900 text-sm">⚠️ 본문 삽입 사전 확인</h3>
                <p className="text-slate-600 text-xs leading-relaxed">
                  기안기 <span className="font-semibold text-blue-600">{approvalModal.targetLabel}</span>에 생성된 초안을 직접 입력합니다.
                </p>
                <div className="p-2 bg-amber-50 border border-amber-200 text-amber-800 text-[11px] rounded">
                  ※ 자동 저장이나 결재는 진행되지 않습니다. 삽입 후 기안기 본문에서 내용을 최종 검토하고 직접 저장하세요.
                </div>
                <div className="flex gap-2 justify-end pt-1">
                  <button
                    onClick={() => setApprovalModal({ open: false })}
                    className="px-3 py-1.5 rounded border border-slate-300 text-slate-600 hover:bg-slate-50 font-semibold"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleConfirmApply}
                    className="px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 font-semibold"
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
