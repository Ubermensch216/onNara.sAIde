import { useEffect, useState } from 'react';
import { loadSettings, DEFAULT_SETTINGS, type Settings } from '@/lib/storage/settings';
import type { EditorCapability } from '@/lib/onnara/draft-editor';
import { cleanAdminDraft } from '@/lib/onnara/draft-cleaner';

export function DrawerApp() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [docTitle, setDocTitle] = useState<string>('');
  const [documentKey, setDocumentKey] = useState<string>('');
  const [capability, setCapability] = useState<EditorCapability>('copy-only');
  const [needsOpenBody, setNeedsOpenBody] = useState<boolean>(false);
  const [hasWriteBodyBtn, setHasWriteBodyBtn] = useState<boolean>(false);
  const [mode, setMode] = useState<'create' | 'polish'>('create');
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

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  // 부모 윈도우와 통신 리스너
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'DRAFT_CONTEXT_RESPONSE') {
        if (data.title) setDocTitle(data.title);
        if (data.documentKey) setDocumentKey(data.documentKey);
        if (data.capability) setCapability(data.capability);
        setNeedsOpenBody(Boolean(data.needsOpenBody));
        setHasWriteBodyBtn(Boolean(data.hasWriteBodyBtn));
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
    const clean = cleanAdminDraft(generatedDraft);
    try {
      await navigator.clipboard.writeText(clean);
      setStatusMsg('공문서 표준 서식으로 복사되었습니다. (Ctrl+V로 붙여넣기)');
      setTimeout(() => setStatusMsg(''), 2800);
    } catch {
      setStatusMsg('복사 실패');
    }
  };

  // 초안 생성 실행 (로컬 Ollama)
  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setGeneratedDraft('');

    const systemPrompt =
      mode === 'create'
        ? '당신은 대한민국 정부 공문서 작성 전문가 AI입니다. 마크다운 특수기호(##, **, *, _, `, > 등)를 절대 사용하지 마십시오. 대한민국 행정업무운영편람의 표준 서식(1. -> 가. -> (1) -> 1) -> 가) -> (가)) 및 개조식 기호(-, ·)만을 사용하여 정형화된 공문서 어투(~코자 함, ~바람)로 명확하고 간결하게 작성하십시오. 사실이 불확실한 날짜, 금액, 기관명은 [확인 필요: 내용]으로 표시하십시오.'
        : '당신은 대한민국 행정 공문서 어투 교정 전문가입니다. 마크다운 특수기호(##, **, *, _, ` 등)를 일체 사용하지 마십시오. 주어진 문장을 대한민국 행정업무운영편람 공문서 표준 어투로 교정하고 간결한 개조식 문장(1., 가., -, ·)으로 변환하십시오. 날짜, 금액, 고유명사는 임의로 변경하지 마십시오.';

    const requestBody = {
      model: settings.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `공문 제목: ${docTitle || '기안문'}\n요청 사항: ${prompt}` },
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

  // 1단계: 삽입 준비 요청
  const handleRequestInsert = () => {
    if (!generatedDraft) return;
    const clean = cleanAdminDraft(generatedDraft);
    setLoading(true);
    window.parent.postMessage(
      {
        type: 'DRAFT_PREPARE_INSERT',
        requestId: `req_${Date.now()}`,
        payload: {
          text: clean,
          mode: 'cursor',
        },
      },
      '*'
    );
  };

  // 🎯 클릭하여 삽입 위치 지정 모드 시작 (유저 제스처 컨텍스트에서 사전 복사)
  const handleStartClickTarget = async () => {
    if (!generatedDraft) return;
    const clean = cleanAdminDraft(generatedDraft);
    try {
      await navigator.clipboard.writeText(clean);
    } catch {
      // ignore
    }
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

  const isDirectInsertSupported = capability === 'cursor' || capability === 'selection' || capability === 'append';

  return (
    <div className="flex flex-col h-full bg-slate-50 text-slate-800 text-xs">
      {/* 상단 헤더 */}
      <header className="flex items-center justify-between px-3 py-2.5 bg-white border-b border-slate-200">
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

      {/* 상태 표시 바 */}
      <div className="px-3 py-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-1 overflow-hidden">
          <span className="font-semibold text-slate-500 whitespace-nowrap">문서:</span>
          <span className="font-medium text-slate-800 truncate" title={docTitle || '문서 제목 확인 중'}>
            {docTitle || '새 기안문 (제목 미정)'}
          </span>
        </div>
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${
            isDirectInsertSupported
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-amber-50 text-amber-700 border border-amber-200'
          }`}
        >
          {isDirectInsertSupported ? '본문 직접 삽입 가능' : '초안 복사 모드'}
        </span>
      </div>

      {/* 본문작성 화면 안내 배너 (문서관리카드 상태일 때) */}
      {needsOpenBody && (
        <div className="mx-3 mt-2.5 p-2.5 bg-amber-50/90 border border-amber-200 rounded-md text-amber-900 space-y-1.5">
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

      {/* 탭 전환 */}
      <div className="flex border-b border-slate-200 bg-white mt-1">
        <button
          onClick={() => setMode('create')}
          className={`flex-1 py-2 text-center font-semibold text-xs border-b-2 ${
            mode === 'create' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          초안 작성
        </button>
        <button
          onClick={() => setMode('polish')}
          className={`flex-1 py-2 text-center font-semibold text-xs border-b-2 ${
            mode === 'polish' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          문체 교정
        </button>
      </div>

      {/* 본문 콘텐츠 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* 입력 영역 */}
        <div className="space-y-1.5">
          <label className="font-semibold text-slate-700 block">
            {mode === 'create' ? '작성할 공문서 개요 또는 핵심 메모' : '교정할 문장 입력'}
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              mode === 'create'
                ? '예: 2026년 공공 AI 업무혁신 추진계획. 추진배경과 3대 전략을 개조식으로 작성해줘.'
                : '공문서 표준 어투로 다듬고 싶은 문장을 입력하세요.'
            }
            className="w-full h-20 p-2 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs resize-none bg-white"
          />
          <button
            onClick={handleGenerate}
            disabled={loading || !prompt.trim()}
            className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded font-semibold transition"
          >
            {loading ? 'AI 작성 중...' : mode === 'create' ? '✨ 공문서 초안 생성' : '✨ 공문서 어투 교정'}
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
              <span>AI가 행정 공문서 표준 서식으로 초안을 작성 중입니다...</span>
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
              <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                <span>📄 공문서 초안</span>
                <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1 py-0.2 rounded font-medium">표준 서식</span>
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
      <footer className="p-3 bg-white border-t border-slate-200 space-y-2">
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
    </div>
  );
}
