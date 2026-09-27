import { useEffect, useState } from 'react';
import { MaterialIcon } from './MaterialIcon';
import type { UserRef } from '@/lib/storage/user-refs';
import {
  isAnalysisComplete,
  isAnalysisCurrent,
  SECONDS_PER_CHUNK,
  type RefRole,
} from '@/lib/onnara/reference-analysis';
import type { AnalyzingState } from '../hooks/useUserReferences';

const FORMAT_LABEL: Record<UserRef['format'], string> = { pdf: 'PDF', hwpx: 'HWPX', docx: 'DOCX', xlsx: 'XLSX', text: 'TXT' };
const ROLE_LABEL: Record<RefRole, string> = { fact: '내용 근거', example: '작성 예시' };

function Verified({ ok, supplemented }: { ok: boolean; supplemented?: boolean }) {
  if (supplemented) {
    return <span className="shrink-0 text-[10.5px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-1 rounded" title="모델이 빠뜨려 코드가 원문에서 채운 기한">코드 보완</span>;
  }
  return ok ? (
    <span className="shrink-0 text-[10.5px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1 rounded">원문 확인</span>
  ) : (
    <span className="shrink-0 text-[10.5px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-1 rounded" title="초안 작성에는 쓰지 않습니다">원문에서 찾지 못함</span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="font-bold text-[11.5px] text-slate-700">{title}</div>
      <div className="space-y-0.5 text-[11.5px] leading-relaxed text-slate-800">{children}</div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-1.5"><span className="min-w-0 break-words">{children}</span></div>;
}

export interface UserRefItemProps {
  item: UserRef;
  model: string;
  selected: boolean;
  selectDisabled: boolean;
  expanded: boolean;
  analyzing: AnalyzingState | null;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onRole: (role: RefRole) => void;
  onMemo: (memo: string) => void;
  onReanalyze: () => void;
  onDelete: () => void;
}

export function UserRefItem({
  item, model, selected, selectDisabled, expanded, analyzing,
  onToggleSelect, onToggleExpand, onRole, onMemo, onReanalyze, onDelete,
}: UserRefItemProps) {
  const [memo, setMemo] = useState(item.memo);
  const [showRaw, setShowRaw] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setMemo(item.memo), [item.memo]);

  const analysis = item.analysis;
  const complete = isAnalysisComplete(analysis, item.role, model);
  const current = isAnalysisCurrent(analysis, item.role, model);
  const running = analyzing?.id === item.id;
  const error = current && analysis?.error;

  let status: { label: string; className: string; title?: string };
  if (running) {
    const done = analyzing.done;
    const total = analyzing.total;
    const minutes = total ? Math.max(1, Math.ceil(((total - done) * SECONDS_PER_CHUNK) / 60)) : 0;
    status = {
      label: total ? `분석 중 ${done}/${total} · 약 ${minutes}분` : '분석 준비 중',
      className: 'bg-blue-50 text-blue-700 border-blue-200 animate-pulse',
    };
  } else if (complete) {
    status = { label: '분석 완료', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  } else if (error) {
    status = { label: '분석 오류', className: 'bg-rose-50 text-rose-700 border-rose-200', title: analysis?.error };
  } else {
    status = { label: '분석 대기', className: 'bg-slate-100 text-slate-600 border-slate-200' };
  }

  const facts = item.codeFacts;
  const fact = complete ? analysis?.fact : undefined;
  const example = complete ? analysis?.example : undefined;
  const at = (page?: number) => (page ? ` (${page}쪽)` : '');

  return (
    <div className={`p-2 rounded-lg border transition ${selected ? 'bg-blue-50/40 border-blue-300 shadow-2xs' : 'bg-white border-slate-200 hover:border-slate-300'}`}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`userref-${item.id}`} className="flex-1 min-w-0 cursor-pointer flex items-center gap-1.5" title={selectDisabled ? '참고문서는 최대 3건까지 선택할 수 있습니다' : undefined}>
          <input
            type="checkbox"
            id={`userref-${item.id}`}
            checked={selected}
            disabled={selectDisabled}
            onChange={onToggleSelect}
            className="accent-blue-600 h-4 w-4 cursor-pointer shrink-0 disabled:cursor-not-allowed"
          />
          <span className="text-[11px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 shrink-0">{FORMAT_LABEL[item.format]}</span>
          <span className="text-xs sm:text-[13px] font-medium text-slate-900 truncate flex-1" title={item.name}>{item.name}</span>
        </label>
        <div className="flex items-center gap-1.5 shrink-0">
          {selected && (
            <span className="text-blue-600 flex items-center" title="참고문서 선택됨"><MaterialIcon name="checkCircle" size={16} /></span>
          )}
          <button
            type="button"
            onClick={onToggleExpand}
            aria-expanded={expanded}
            className="px-2 py-0.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded text-xs font-medium transition flex items-center gap-1 cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500"
            title="분석 결과 보기"
          >
            <MaterialIcon name={expanded ? 'arrowUp' : 'arrowDown'} size={13} />
            <span>{expanded ? '접기' : '분석'}</span>
          </button>
        </div>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2 pl-5.5">
        <div className="inline-flex rounded-md border border-slate-300 overflow-hidden text-[11px] font-semibold" role="group" aria-label="활용 방식">
          {(['fact', 'example'] as const).map((role) => (
            <button
              key={role}
              type="button"
              aria-pressed={item.role === role}
              onClick={() => item.role !== role && onRole(role)}
              className={`px-2 py-0.5 transition cursor-pointer ${item.role === role ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              title={role === 'fact' ? '지침·계획서의 사실·기한·요구사항을 초안에 인용합니다' : '예전 공문의 구성·번호 체계·문체만 본뜹니다'}
            >
              {ROLE_LABEL[role]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 min-w-0">
          {item.warnings.length > 0 && (
            <span className="text-[10.5px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1 rounded shrink-0" title={item.warnings.join('\n')}>주의 {item.warnings.length}</span>
          )}
          <span className={`text-[10.5px] font-semibold border px-1.5 py-0.5 rounded truncate ${status.className}`} title={status.title}>{status.label}</span>
        </div>
      </div>

      {expanded && (
        <div className="mt-2 pt-2 border-t border-slate-200 space-y-2.5 text-xs bg-slate-50/70 p-2.5 rounded-lg">
          {item.warnings.length > 0 && (
            <div className="p-2 bg-amber-50 border border-amber-200 rounded text-[11.5px] text-amber-800 space-y-0.5">
              {item.warnings.map((warning) => <p key={warning}>· {warning}</p>)}
            </div>
          )}
          {error && (
            <div className="p-2 bg-rose-50 border border-rose-200 rounded text-[11.5px] text-rose-800">
              분석 중 오류: {analysis?.error} — 로컬 AI(Ollama) 상태를 확인한 뒤 [재분석]을 눌러 주세요. 아래 코드 추출 사실은 초안에 그대로 쓰입니다.
            </div>
          )}

          {fact && (
            <>
              {(fact.summary || fact.purpose) && (
                <Section title="요지">
                  {fact.summary && <p>{fact.summary}</p>}
                  {fact.purpose && <p className="text-slate-600">목적·배경: {fact.purpose}</p>}
                </Section>
              )}
              {fact.requirements.length > 0 && (
                <Section title="요구사항">
                  {fact.requirements.map((r) => (
                    <div key={r.item} className="flex items-start justify-between gap-1.5" title={r.evidence}>
                      <span className="min-w-0 break-words">· {r.item}</span>
                      <Verified ok={r.verified} />
                    </div>
                  ))}
                </Section>
              )}
              {fact.schedule.length > 0 && (
                <Section title="일정·기한">
                  {fact.schedule.map((s) => (
                    <div key={`${s.date}|${s.what}`} className="flex items-start justify-between gap-1.5" title={s.evidence}>
                      <span className="min-w-0 break-words">· <strong>{s.date}</strong> {s.what}</span>
                      <Verified ok={s.verified} supplemented={s.supplemented} />
                    </div>
                  ))}
                </Section>
              )}
              {fact.legalBasis.length > 0 && (
                <Section title="근거 법령·지침">
                  {fact.legalBasis.map((l) => (
                    <div key={l.name} className="flex items-start justify-between gap-1.5" title={l.evidence}>
                      <span className="min-w-0 break-words">· {l.name}</span>
                      <Verified ok={l.verified} />
                    </div>
                  ))}
                </Section>
              )}
              {(fact.targets.length > 0 || fact.submissions.length > 0 || fact.contacts.length > 0) && (
                <Section title="대상·제출·문의">
                  {fact.targets.length > 0 && <Row>대상: {fact.targets.join(', ')}</Row>}
                  {fact.submissions.length > 0 && <Row>제출 자료: {fact.submissions.join(', ')}</Row>}
                  {fact.contacts.length > 0 && <Row>문의처: {fact.contacts.join(', ')}</Row>}
                </Section>
              )}
            </>
          )}

          {example && (
            <>
              {example.docType && <Section title="문서 유형"><p>{example.docType}</p></Section>}
              {example.structure.length > 0 && <Section title="구성(대항목 순서)"><p>{example.structure.join(' → ')}</p></Section>}
              {example.numbering && <Section title="번호 체계"><p>{example.numbering}</p></Section>}
              {example.toneFeatures.length > 0 && <Section title="문체 특징"><p>{example.toneFeatures.join(', ')}</p></Section>}
              {example.sampleSentences.length > 0 && (
                <Section title="예문">
                  {example.sampleSentences.map((s) => (
                    <div key={s.text} className="flex items-start justify-between gap-1.5">
                      <span className="min-w-0 break-words">· {s.text}</span>
                      <Verified ok={s.verified} />
                    </div>
                  ))}
                </Section>
              )}
            </>
          )}

          <Section title="원문에서 코드로 찾은 사실">
            {facts.dates.filter((d) => d.due).length > 0 && (
              <Row>기한: {facts.dates.filter((d) => d.due).map((d) => `${d.text}${at(d.page)}`).join(', ')}</Row>
            )}
            {facts.amounts.length > 0 && <Row>금액: {[...new Set(facts.amounts.map((a) => a.text))].join(', ')}</Row>}
            {facts.laws.length > 0 && <Row>법령·지침: {facts.laws.map((l) => l.text).join(', ')}</Row>}
            {facts.docNumbers.length > 0 && <Row>문서번호: {facts.docNumbers.join(', ')}</Row>}
            {facts.attachments.length > 0 && <Row>붙임: {facts.attachments.join(' / ')}</Row>}
            {item.role === 'example' && facts.outline.length > 0 && <Row>대항목: {facts.outline.join(' → ')}</Row>}
            {!facts.dates.some((d) => d.due) && !facts.amounts.length && !facts.laws.length && !facts.attachments.length && (
              <p className="text-slate-500">기한·금액·법령·붙임 표기를 찾지 못했습니다.</p>
            )}
          </Section>

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-500">
              {item.text.length.toLocaleString()}자{item.pages ? ` · ${item.pages}쪽` : ''}
            </span>
            <button type="button" onClick={() => setShowRaw(!showRaw)} className="text-xs text-blue-600 hover:text-blue-800 underline font-medium cursor-pointer">
              {showRaw ? '원문 닫기' : '원문 보기'}
            </button>
          </div>
          {showRaw && (
            <div className="p-2.5 bg-white border border-slate-200 rounded max-h-36 overflow-y-auto font-mono text-[11px] leading-relaxed text-slate-700 whitespace-pre-wrap select-text">
              {item.text}
            </div>
          )}

          <div>
            <label htmlFor={`userref-memo-${item.id}`} className="text-xs text-slate-700 font-semibold block mb-1">
              이 자료 관련 추가 요구사항 또는 메모 (선택사항):
            </label>
            <textarea
              id={`userref-memo-${item.id}`}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              onBlur={() => memo !== item.memo && onMemo(memo)}
              placeholder={item.role === 'fact' ? '예: 우리 과 제출 기한은 10월 12일로 반영할 것' : '예: 구성은 따르되 붙임 목록은 생략할 것'}
              className="w-full h-16 p-2 border border-slate-300 rounded bg-white text-xs resize-none focus:outline-none focus:ring-1 focus:ring-blue-500 leading-relaxed"
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            {confirmDelete ? (
              <>
                <span className="text-[11px] text-rose-700 mr-auto">내 참고자료에서 지울까요? 되돌릴 수 없습니다.</span>
                <button type="button" onClick={() => setConfirmDelete(false)} className="px-2 py-1 border border-slate-300 rounded text-xs text-slate-700 hover:bg-white cursor-pointer">취소</button>
                <button type="button" onClick={onDelete} className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-semibold cursor-pointer">지우기</button>
              </>
            ) : (
              <>
                <button type="button" onClick={onReanalyze} disabled={running} className="px-2 py-1 border border-slate-300 rounded text-xs text-slate-700 hover:bg-white flex items-center gap-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                  <MaterialIcon name="refresh" size={13} />
                  <span>재분석</span>
                </button>
                <button type="button" onClick={() => setConfirmDelete(true)} className="px-2 py-1 border border-slate-300 rounded text-xs text-rose-700 hover:bg-white flex items-center gap-1 cursor-pointer">
                  <MaterialIcon name="delete" size={13} />
                  <span>삭제</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
