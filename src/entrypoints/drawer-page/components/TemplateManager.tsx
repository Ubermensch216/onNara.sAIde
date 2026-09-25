import { useState } from 'react';
import {
  DOCUMENT_TYPES,
  RECOMMENDED_SECTIONS_BY_TYPE,
  type DocumentType,
  type DraftTemplate,
} from '@/lib/onnara/draft-templates';
import {
  addDraftTemplate,
  deleteDraftTemplate,
  resetToDefaultDraftTemplates,
  updateDraftTemplate,
} from '@/lib/storage/draft-templates';
import { MaterialIcon } from './MaterialIcon';

interface TemplateManagerProps {
  templates: DraftTemplate[];
  onSelectTemplateForDraft: (template: DraftTemplate) => void;
  onRefreshTemplates: () => void;
}

export function TemplateManager({
  templates,
  onSelectTemplateForDraft,
  onRefreshTemplates,
}: TemplateManagerProps) {
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(() => new Set());

  const toggleDetail = (key: string) => {
    setExpandedDetails(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // 편집/등록 모달 상태
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // null이면 신규 등록
  const [title, setTitle] = useState('');
  const [documentType, setDocumentType] = useState<string>('업무보고');
  const [customDocType, setCustomDocType] = useState('');
  const [description, setDescription] = useState('');
  const [sections, setSections] = useState<string[]>([]);
  const [newSectionInput, setNewSectionInput] = useState('');
  const [guidance, setGuidance] = useState('');

  const showToast = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(''), 2800);
  };

  // 모달 열기: 신규 등록
  const handleOpenCreate = () => {
    setEditingId(null);
    setTitle('');
    setDocumentType('업무보고');
    setCustomDocType('');
    setDescription('');
    // 업무보고의 추천 항목으로 기본 세팅
    setSections([...(RECOMMENDED_SECTIONS_BY_TYPE['업무보고'] || [])]);
    setNewSectionInput('');
    setGuidance('객관적 사실과 수치 중심의 개조식으로 기술하며, 문제점에 대한 구체적인 대응방안을 포함하십시오.');
    setIsEditorOpen(true);
  };

  // 모달 열기: 기존 서식 수정
  const handleOpenEdit = (t: DraftTemplate) => {
    setEditingId(t.id);
    setTitle(t.title);
    if (DOCUMENT_TYPES.includes(t.documentType as DocumentType)) {
      setDocumentType(t.documentType);
      setCustomDocType('');
    } else {
      setDocumentType('기타');
      setCustomDocType(t.documentType);
    }
    setDescription(t.description || '');
    setSections([...t.sections]);
    setNewSectionInput('');
    setGuidance(t.guidance || '');
    setIsEditorOpen(true);
  };

  // 문서 유형 변경 시 추천 항목 적용 안내
  const handleTypeChange = (newType: string) => {
    setDocumentType(newType);
    if (newType !== '기타' && RECOMMENDED_SECTIONS_BY_TYPE[newType]) {
      // 신규 등록 중일 때 항목이 비어있거나 기존 추천 목록과 같으면 자동 변경
      if (!editingId || sections.length === 0) {
        setSections([...RECOMMENDED_SECTIONS_BY_TYPE[newType]]);
      }
    }
  };

  // 추천 항목 세트 강제 덮어쓰기
  const handleApplyRecommendedSections = (typeKey: string) => {
    const recommended = RECOMMENDED_SECTIONS_BY_TYPE[typeKey];
    if (recommended) {
      setSections([...recommended]);
      showToast(`'${typeKey}' 추천 항목 세트가 적용되었습니다.`);
    }
  };

  // 개별 항목 추가
  const handleAddSection = () => {
    const trimmed = newSectionInput.trim();
    if (!trimmed) return;
    setSections(prev => [...prev, trimmed]);
    setNewSectionInput('');
  };

  // 개별 항목 삭제
  const handleRemoveSection = (idx: number) => {
    setSections(prev => prev.filter((_, i) => i !== idx));
  };

  // 개별 항목 수정
  const handleUpdateSection = (idx: number, val: string) => {
    setSections(prev => prev.map((s, i) => (i === idx ? val : s)));
  };

  // 항목 위로 이동
  const handleMoveUp = (idx: number) => {
    if (idx <= 0) return;
    setSections(prev => {
      const next = [...prev];
      const prevItem = next[idx - 1];
      const curItem = next[idx];
      if (typeof prevItem === 'string' && typeof curItem === 'string') {
        next[idx - 1] = curItem;
        next[idx] = prevItem;
      }
      return next;
    });
  };

  // 항목 아래로 이동
  const handleMoveDown = (idx: number) => {
    if (idx >= sections.length - 1) return;
    setSections(prev => {
      const next = [...prev];
      const nextItem = next[idx + 1];
      const curItem = next[idx];
      if (typeof nextItem === 'string' && typeof curItem === 'string') {
        next[idx + 1] = curItem;
        next[idx] = nextItem;
      }
      return next;
    });
  };

  // 저장 처리
  const handleSave = async () => {
    const finalTitle = title.trim();
    if (!finalTitle) {
      alert('서식 명칭을 입력해주세요.');
      return;
    }
    const finalType = (documentType === '기타' && customDocType.trim() ? customDocType.trim() : documentType);
    const validSections = sections.map(s => s.trim()).filter(Boolean);
    if (validSections.length === 0) {
      alert('최소 1개 이상의 주요 항목을 지정해야 합니다.');
      return;
    }

    if (editingId) {
      await updateDraftTemplate(editingId, {
        title: finalTitle,
        documentType: finalType,
        description,
        sections: validSections,
        guidance,
      });
      showToast('서식이 성공적으로 수정되었습니다.');
    } else {
      await addDraftTemplate({
        title: finalTitle,
        documentType: finalType,
        description,
        sections: validSections,
        guidance,
      });
      showToast('새 서식이 등록되었습니다.');
    }

    setIsEditorOpen(false);
    onRefreshTemplates();
  };

  // 서식 삭제
  const handleDelete = async (t: DraftTemplate) => {
    if (confirm(`'${t.title}' 서식을 삭제하시겠습니까?`)) {
      await deleteDraftTemplate(t.id);
      showToast('서식이 삭제되었습니다.');
      onRefreshTemplates();
    }
  };

  // 기본 서식 초기화 복원
  const handleResetDefaults = async () => {
    if (confirm('모든 기본 서식을 초기 상태로 복원하시겠습니까? (사용자가 직접 추가한 서식은 기본 서식 세트로 대체됩니다)')) {
      await resetToDefaultDraftTemplates();
      showToast('기본 서식으로 초기화되었습니다.');
      onRefreshTemplates();
    }
  };

  // 필터링 및 검색
  const filteredTemplates = templates.filter(t => {
    if (filterType !== 'all' && t.documentType !== filterType) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = t.title.toLowerCase().includes(q);
      const matchDesc = t.description?.toLowerCase().includes(q);
      const matchSec = t.sections.some(s => s.toLowerCase().includes(q));
      return matchTitle || matchDesc || matchSec;
    }
    return true;
  });

  return (
    <div className="flex flex-col h-full bg-slate-50 text-slate-800 text-xs">
      {/* 서식관리 상단 툴바 */}
      <div className="p-2.5 bg-white border-b border-slate-200 space-y-2">
        {/* 상단 검색 및 서식 등록/초기화 액션 */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1">
            <input
              type="text"
              placeholder="서식 검색..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full px-2.5 py-1 border border-slate-300 rounded text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleOpenCreate}
              className="w-7 h-7 bg-blue-600 hover:bg-blue-700 text-white rounded inline-flex items-center justify-center shadow-xs transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              title="새 서식 등록"
              aria-label="새 서식 등록"
            >
              <MaterialIcon name="add" size={18} />
            </button>
            <button
              type="button"
              onClick={handleResetDefaults}
              className="h-7 px-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-600 rounded font-medium text-[11px] transition inline-flex items-center gap-1"
              title="초기 4대 표준 서식(업무보고, 기본 계획서, 구축 계획서, 언론 보도)으로 복원"
            >
              <MaterialIcon name="refresh" size={14} />
              <span>초기화</span>
            </button>
          </div>
        </div>

        {/* 유형 필터 탭 */}
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none">
          <button
            type="button"
            onClick={() => setFilterType('all')}
            className={`px-2 py-0.8 rounded text-[11px] font-semibold whitespace-nowrap transition ${
              filterType === 'all'
                ? 'bg-slate-800 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            전체 ({templates.length})
          </button>
          {DOCUMENT_TYPES.filter(t => t !== '기타').map(type => {
            const count = templates.filter(t => t.documentType === type).length;
            return (
              <button
                key={type}
                type="button"
                onClick={() => setFilterType(type)}
                className={`px-2 py-0.8 rounded text-[11px] font-semibold whitespace-nowrap transition ${
                  filterType === type
                    ? 'bg-blue-700 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {type} {count > 0 && `(${count})`}
              </button>
            );
          })}
        </div>

        {statusMessage && (
          <div className="py-1 px-2 bg-blue-50 border border-blue-200 text-blue-800 text-center rounded font-medium text-[11px]">
            {statusMessage}
          </div>
        )}
      </div>

      {/* 서식 카드 목록 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {filteredTemplates.length === 0 ? (
          <div className="p-8 text-center text-slate-400 bg-white rounded-lg border border-dashed border-slate-300">
            <MaterialIcon name="description" size={30} className="mx-auto mb-1" />
            <p className="font-semibold text-slate-600">등록된 서식이 없습니다.</p>
            <p className="text-[11px] mt-1 text-slate-400">
              상단의 + 버튼으로 서식을 등록하거나 [초기화]를 눌러 표준 서식을 불러오세요.
            </p>
          </div>
        ) : (
          filteredTemplates.map(t => (
            <div
              key={t.id}
              className="p-3 bg-white border border-slate-200 hover:border-blue-300 rounded-lg shadow-2xs transition space-y-2.5"
            >
              {/* 카드 헤더 */}
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h3 className="font-bold text-slate-900 text-sm">{t.title}</h3>
                    {t.isBuiltin && (
                      <span className="text-[9px] bg-slate-100 text-slate-500 px-1 py-0.2 rounded font-medium">
                        표준
                      </span>
                    )}
                  </div>
                  {t.description && (
                    <p className="text-[11px] text-slate-500 leading-snug">{t.description}</p>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => onSelectTemplateForDraft(t)}
                    className="w-8 h-8 bg-blue-600 hover:bg-blue-700 text-white rounded inline-flex items-center justify-center shadow-2xs transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                    title="이 서식으로 작성"
                    aria-label={`${t.title} 서식으로 작성`}
                  >
                    <MaterialIcon name="playArrow" size={20} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(t)}
                    className="w-8 h-8 inline-flex items-center justify-center text-slate-500 hover:text-blue-700 hover:bg-slate-100 rounded"
                    title="서식 수정"
                    aria-label={`${t.title} 서식 수정`}
                  >
                    <MaterialIcon name="edit" size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(t)}
                    className="w-8 h-8 inline-flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-slate-100 rounded"
                    title="서식 삭제"
                    aria-label={`${t.title} 서식 삭제`}
                  >
                    <MaterialIcon name="delete" size={18} />
                  </button>
                </div>
              </div>

              {/* 필수 주요 항목: 카드별로 접고 펼칠 수 있음 */}
              <div className="bg-slate-50 border border-slate-200 rounded px-2">
                <button
                  type="button"
                  onClick={() => toggleDetail(`${t.id}:sections`)}
                  aria-expanded={expandedDetails.has(`${t.id}:sections`)}
                  aria-controls={`template-${t.id}-sections`}
                  className="w-full min-h-8 text-[10px] font-bold text-slate-600 flex items-center justify-between gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 rounded"
                >
                  <span className="inline-flex items-center gap-1">
                    <MaterialIcon name="listAlt" size={14} />
                    필수 주요 항목 ({t.sections.length}개)
                  </span>
                  <span className="inline-flex items-center gap-1 text-[9px] text-slate-400">
                    순서대로 대항목 구성
                    <MaterialIcon name={expandedDetails.has(`${t.id}:sections`) ? 'arrowUp' : 'arrowDown'} size={14} />
                  </span>
                </button>
                <div
                  id={`template-${t.id}-sections`}
                  hidden={!expandedDetails.has(`${t.id}:sections`)}
                  className="flex flex-wrap gap-1 pb-2"
                >
                  {t.sections.map((sec, idx) => (
                    <span
                      key={idx}
                      className="px-1.5 py-0.5 bg-white border border-slate-300 rounded text-[10.5px] text-slate-700 font-medium shadow-2xs"
                    >
                      {sec}
                    </span>
                  ))}
                </div>
              </div>

              {/* 작성 지침 */}
              {t.guidance && (
                <div className="text-[10px] text-slate-500 bg-blue-50/50 px-1.5 rounded border border-blue-100">
                  <button
                    type="button"
                    onClick={() => toggleDetail(`${t.id}:guidance`)}
                    aria-expanded={expandedDetails.has(`${t.id}:guidance`)}
                    aria-controls={`template-${t.id}-guidance`}
                    className="w-full min-h-8 text-left flex items-center justify-between gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 rounded"
                  >
                    <span className="text-blue-600 font-bold shrink-0 inline-flex items-center gap-0.5">
                      <MaterialIcon name="lightbulb" size={14} /> 지침
                    </span>
                    <MaterialIcon name={expandedDetails.has(`${t.id}:guidance`) ? 'arrowUp' : 'arrowDown'} size={14} className="text-blue-400" />
                  </button>
                  <p
                    id={`template-${t.id}-guidance`}
                    hidden={!expandedDetails.has(`${t.id}:guidance`)}
                    className="leading-tight pb-1.5"
                  >
                    {t.guidance}
                  </p>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* 서식 추가/수정 모달 다이얼로그 */}
      {isEditorOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3">
          <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden animate-fadeIn">
            {/* 모달 헤더 */}
            <div className="px-4 py-3 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                <MaterialIcon name={editingId ? 'edit' : 'add'} size={18} className="text-blue-600" />
                <span>{editingId ? '공문서 서식 수정' : '새 공문서 서식 등록'}</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1"
                title="닫기"
                aria-label="서식 편집창 닫기"
              >
                <MaterialIcon name="close" size={18} />
              </button>
            </div>

            {/* 모달 본문 (스크롤) */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
              {/* 문서 유형 선택 */}
              <div className="space-y-1">
                <label className="font-bold text-slate-700 text-[11px] block">
                  문서 유형 <span className="text-red-500">*</span>
                </label>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {DOCUMENT_TYPES.map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleTypeChange(type)}
                      className={`px-2 py-1 rounded text-xs font-semibold border transition ${
                        documentType === type
                          ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
                {documentType === '기타' && (
                  <input
                    type="text"
                    placeholder="문서 유형 직접 입력 (예: 협조 요청문, 규정 개정안 등)"
                    value={customDocType}
                    onChange={e => setCustomDocType(e.target.value)}
                    className="w-full mt-1.5 px-2.5 py-1.5 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  />
                )}
              </div>

              {/* 서식 명칭 */}
              <div className="space-y-1">
                <label className="font-bold text-slate-700 text-[11px] block">
                  서식 명칭 (제목) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="예: 2026 부서 주간 업무보고 서식"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              {/* 서식 설명 */}
              <div className="space-y-1">
                <label className="font-semibold text-slate-600 text-[11px] block">
                  서식 설명
                </label>
                <input
                  type="text"
                  placeholder="예: 주간 단위 부서별 중점 추진 실적 및 계획 보고용"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              {/* 주요 항목 지정 (핵심!) */}
              <div className="space-y-1.5 pt-1 border-t border-slate-200">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-800 text-[11px] block">
                    유형별 필수 주요 항목 지정 <span className="text-red-500">*</span>
                  </label>
                  {RECOMMENDED_SECTIONS_BY_TYPE[documentType] && (
                    <button
                      type="button"
                      onClick={() => handleApplyRecommendedSections(documentType)}
                      className="text-[10px] text-blue-600 hover:underline font-semibold"
                    >
                      [{documentType}] 추천 항목 세트 채우기
                    </button>
                  )}
                </div>
                <p className="text-[10.5px] text-slate-500 leading-tight">
                  공문서 작성 시 대항목(1., 2., 3. ...)으로 배치될 순서대로 지정합니다.
                </p>

                {/* 현재 항목 목록 */}
                <div className="space-y-1 max-h-48 overflow-y-auto p-1 bg-slate-50 rounded border border-slate-200">
                  {sections.length === 0 ? (
                    <div className="text-center py-4 text-slate-400 text-[11px]">
                      지정된 항목이 없습니다. 아래에서 항목을 추가하세요.
                    </div>
                  ) : (
                    sections.map((sec, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-1.5 bg-white p-1.5 rounded border border-slate-200 shadow-2xs"
                      >
                        <span className="font-bold text-blue-700 text-[11px] w-5 text-center shrink-0">
                          {idx + 1}
                        </span>
                        <input
                          type="text"
                          value={sec}
                          onChange={e => handleUpdateSection(idx, e.target.value)}
                          className="flex-1 px-1.5 py-0.5 border border-transparent hover:border-slate-300 focus:border-blue-500 rounded text-xs focus:outline-none"
                        />
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleMoveUp(idx)}
                            disabled={idx === 0}
                            className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20"
                            title="위로 이동"
                            aria-label={`${sec} 항목 위로 이동`}
                          >
                            <MaterialIcon name="arrowUp" size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveDown(idx)}
                            disabled={idx === sections.length - 1}
                            className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20"
                            title="아래로 이동"
                            aria-label={`${sec} 항목 아래로 이동`}
                          >
                            <MaterialIcon name="arrowDown" size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveSection(idx)}
                            className="p-1 text-red-400 hover:text-red-600"
                            title="항목 삭제"
                            aria-label={`${sec} 항목 삭제`}
                          >
                            <MaterialIcon name="close" size={16} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* 항목 신규 추가 인풋 */}
                <div className="flex gap-1.5 pt-1">
                  <input
                    type="text"
                    placeholder={`예: ${sections.length + 1}. 향후 기대 효과 및 소요 예산`}
                    value={newSectionInput}
                    onChange={e => setNewSectionInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddSection();
                      }
                    }}
                    className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddSection}
                    disabled={!newSectionInput.trim()}
                    className="px-3 py-1.5 bg-slate-700 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded font-semibold text-xs whitespace-nowrap inline-flex items-center gap-1"
                  >
                    <MaterialIcon name="add" size={16} />
                    추가
                  </button>
                </div>
              </div>

              {/* 작성 지침 가이드라인 */}
              <div className="space-y-1 pt-1 border-t border-slate-200">
                <label className="font-semibold text-slate-700 text-[11px] block">
                  작성 특화 지침 (선택 사항)
                </label>
                <textarea
                  placeholder="예: 각 실적은 수치와 통계 위주로 개조식 기술하며, 문제점에 대한 실효성 있는 대응방안을 포함할 것"
                  value={guidance}
                  onChange={e => setGuidance(e.target.value)}
                  className="w-full h-14 p-2 border border-slate-300 rounded text-xs resize-none focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>
            </div>

            {/* 모달 푸터 */}
            <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                className="px-3 py-1.5 rounded border border-slate-300 text-slate-600 hover:bg-slate-100 font-semibold text-xs"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-xs"
              >
                {editingId ? '수정 내용 저장' : '서식 등록 완료'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
