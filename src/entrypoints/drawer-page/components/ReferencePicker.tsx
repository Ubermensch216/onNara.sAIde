/**
 * 작성 설정 1-B '참고문서 선택' 카드.
 *
 * 세 묶음에서 합쳐 최대 3건까지 고른다.
 *   - 온나라 관련정보: 기안기에 등록된 관련 문서(본문은 백그라운드가 읽어 온다)
 *   - 내 참고자료: 사용자가 올린 파일(확장 DB에 보관, 올리면 자동 분석)
 *   - TONGDAL 서고: TONGDAL.ai 지식 공간에서 찾은 문서(연결한 사용자에게만 보인다)
 */

import { useRef, useState } from 'react';
import { MaterialIcon, type MaterialIconName } from './MaterialIcon';
import { UserRefItem } from './UserRefItem';
import { generateRuleBasedSummary, type RelatedDocInfo } from '@/lib/onnara/related-info';
import { MAX_SELECTED_REFS } from '@/lib/onnara/reference-context';
import { UPLOAD_ACCEPT } from '@/lib/extract/files';
import type { RefRole } from '@/lib/onnara/reference-analysis';
import { USER_REFS_MAX, type UserRef } from '@/lib/storage/user-refs';
import type { AnalyzingState, UploadState } from '../hooks/useUserReferences';
import { TongdalRefGroup, type TongdalRef } from './TongdalRefGroup';
import type { TongdalSearchHit } from '@/lib/tongdal/types';

export const onnaraKey = (doc: RelatedDocInfo) => `onnara:${doc.title}`;
export const uploadKey = (ref: UserRef) => `upload:${ref.id}`;

const SUPPORTED_FORMATS: { ext: string; icon: MaterialIconName; iconClass: string }[] = [
  { ext: 'HWPX', icon: 'description', iconClass: 'text-blue-600' },
  { ext: 'PDF', icon: 'pictureAsPdf', iconClass: 'text-rose-600' },
  { ext: 'DOCX', icon: 'description', iconClass: 'text-indigo-600' },
  { ext: 'XLSX', icon: 'tableChart', iconClass: 'text-emerald-600' },
  { ext: 'TXT', icon: 'textSnippet', iconClass: 'text-slate-500' },
];

export interface ReferencePickerProps {
  selectedKeys: string[];
  expandedKey: string | null;
  onToggleSelect: (key: string) => void;
  onClearAll: () => void;
  onToggleExpand: (key: string) => void;
  onRetry?: (doc: RelatedDocInfo) => void;
  // 온나라 관련정보
  relatedDocs: RelatedDocInfo[];
  fetchingTitle: string | null;
  refDocSummaries: Record<string, string>;
  summarizingTitle: string | null;
  onnaraMemos: Record<string, string>;
  onOnnaraMemo: (title: string, memo: string) => void;
  // 내 참고자료
  model: string;
  userRefs: UserRef[];
  uploads: UploadState[];
  analyzing: AnalyzingState | null;
  loadError: string | null;
  onUpload: (files: File[]) => void;
  onDismissUpload: (id: string) => void;
  onRole: (id: string, role: RefRole) => void;
  onMemo: (id: string, memo: string) => void;
  onReanalyze: (id: string) => void;
  onDelete: (id: string) => void;
  // TONGDAL 서고
  tongdalRefs: TongdalRef[];
  onToggleTongdal: (documentId: string, hit?: TongdalSearchHit) => void;
}

function OnnaraRefItem({
  doc, index, selected, selectDisabled, expanded, fetching, summary, summarizing, memo,
  onToggleSelect, onToggleExpand, onMemo, onRetry, retryDisabled,
}: {
  doc: RelatedDocInfo;
  index: number;
  selected: boolean;
  selectDisabled: boolean;
  expanded: boolean;
  fetching: boolean;
  summary?: string;
  summarizing: boolean;
  memo: string;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onMemo: (memo: string) => void;
  onRetry?: () => void;
  retryDisabled: boolean;
}) {
  const [showRaw, setShowRaw] = useState(false);
  return (
    <div className={`p-2 rounded-lg border transition ${selected ? 'bg-blue-50/40 border-blue-300 shadow-2xs' : 'bg-white border-slate-200 hover:border-slate-300'}`}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`refdoc-${index}`} className="flex-1 min-w-0 cursor-pointer flex items-center gap-1.5" title={selectDisabled ? '참고문서는 최대 3건까지 선택할 수 있습니다' : undefined}>
          <input
            type="checkbox"
            id={`refdoc-${index}`}
            checked={selected}
            disabled={selectDisabled}
            onChange={onToggleSelect}
            className="accent-blue-600 h-4 w-4 cursor-pointer shrink-0 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-blue-500"
          />
          <span className="text-[11px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 shrink-0">{doc.type || '문서'}</span>
          <span className="text-xs sm:text-[13px] font-medium text-slate-900 truncate flex-1" title={doc.title}>{doc.title}</span>
        </label>
        {selected && (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-blue-600 flex items-center" title="참고문서 선택됨"><MaterialIcon name="checkCircle" size={16} /></span>
            <button
              type="button"
              onClick={onToggleExpand}
              className="px-2 py-0.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded text-xs font-medium transition flex items-center gap-1 cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500"
              title="참고문서 내용 요약 보기"
            >
              <MaterialIcon name={expanded ? 'arrowUp' : 'arrowDown'} size={13} />
              <span>{expanded ? '접기' : '내용'}</span>
            </button>
          </div>
        )}
      </div>

      {selected && expanded && (
        <div className="mt-2 pt-2 border-t border-slate-200 space-y-2 text-xs bg-slate-50/70 p-2.5 rounded-lg">
          <div className="flex items-center justify-between text-slate-700">
            <span className="font-bold text-xs flex items-center gap-1.5">
              <MaterialIcon name="assignment" size={14} className="text-blue-600" />
              <span>참고문서 핵심 요약</span>
              {summarizing && <span className="text-[11px] text-blue-600 font-normal animate-pulse">(AI 요약 정리 중...)</span>}
            </span>
            {doc.content && (
              <button type="button" onClick={() => setShowRaw(!showRaw)} className="text-xs text-blue-600 hover:text-blue-800 underline font-medium cursor-pointer">
                {showRaw ? '요약 보기' : '원문 전체 보기'}
              </button>
            )}
          </div>

          {doc.content ? (
            showRaw ? (
              <div className="p-2.5 bg-white border border-slate-200 rounded max-h-36 overflow-y-auto font-mono text-[11px] leading-relaxed text-slate-700 whitespace-pre-wrap select-text">{doc.content}</div>
            ) : (
              <div className="p-2.5 bg-white border border-slate-200 rounded max-h-36 overflow-y-auto text-xs leading-relaxed text-slate-800 whitespace-pre-wrap select-text shadow-2xs font-sans">
                {summary || generateRuleBasedSummary(doc.content, doc.title)}
              </div>
            )
          ) : fetching ? (
            <div className="p-3 bg-white border border-slate-200 rounded text-center text-blue-700 text-xs">
              <span className="animate-pulse font-medium">원문을 읽는 중입니다. 필요하면 임시 탭이 열리고 자동으로 닫힙니다.</span>
            </div>
          ) : (
            <div className="p-2.5 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 space-y-1">
              <p className="flex items-center gap-1.5 leading-normal">
                <MaterialIcon name="warning" size={13} className="text-amber-600" />
                <span>문서 내용을 확인하려면 '관련정보'에서 해당 문서를 연 후, '다시 읽기'를 눌러 주세요.</span>
              </p>
              {onRetry && <button type="button" onClick={onRetry} disabled={retryDisabled} className="underline font-medium cursor-pointer disabled:opacity-50">다시 읽기</button>}
            </div>
          )}

          {doc.attachments?.length ? (
            <div className="p-2.5 bg-white border border-slate-200 rounded text-xs text-slate-800">
              <div className="font-semibold mb-1">원문 붙임 파일명</div>
              {doc.attachments.map((name) => <div key={name}>{name}</div>)}
            </div>
          ) : null}

          <div>
            <label htmlFor={`ref-doc-custom-notes-${index}`} className="text-xs text-slate-700 font-semibold block mb-1">
              참고문서 관련 추가 요구사항 또는 핵심 메모 (선택사항):
            </label>
            <textarea
              id={`ref-doc-custom-notes-${index}`}
              value={memo}
              onChange={(e) => onMemo(e.target.value)}
              placeholder="위 내용을 확인하고, 우리 과 상황에 맞게 반영할 변경사항이나 강조할 내용을 적어주세요. (예: 우리 부서 제출 기한은 10월 12일까지로 변경하여 반영할 것)"
              className="w-full h-18 p-2 border border-slate-300 rounded bg-white text-xs resize-none focus:outline-none focus:ring-1 focus:ring-blue-500 leading-relaxed"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function ReferencePicker(props: ReferencePickerProps) {
  const { selectedKeys, expandedKey, relatedDocs, userRefs, uploads } = props;
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const full = selectedKeys.length >= MAX_SELECTED_REFS;

  const takeFiles = (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (files.length) props.onUpload(files);
  };

  return (
    <div className="p-3 bg-white border border-slate-200 rounded-lg shadow-2xs space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-bold text-slate-900 text-xs sm:text-[13px]">
          <MaterialIcon name="attachFile" size={15} className="text-blue-600" />
          <span>참고문서 선택</span>
          <span className={`text-xs font-normal ${full ? 'text-blue-700 font-semibold' : 'text-slate-500'}`}>
            ({selectedKeys.length}/{MAX_SELECTED_REFS}건 선택)
          </span>
        </div>
        {selectedKeys.length > 0 && (
          <button type="button" onClick={props.onClearAll} className="text-xs text-slate-500 hover:text-slate-800 underline transition cursor-pointer" title="선택된 참고문서 모두 해제">
            참고 해제
          </button>
        )}
      </div>

      {/* 온나라 관련정보 */}
      <div className="space-y-1.5">
        <div className="text-[11.5px] font-semibold text-slate-600">
          온나라 관련정보{relatedDocs.length > 0 && <span className="font-normal text-slate-500"> ({relatedDocs.length}건 감지됨)</span>}
        </div>
        {relatedDocs.length === 0 ? (
          <div className="p-2.5 bg-slate-50 border border-dashed border-slate-200 rounded-lg text-center text-xs text-slate-500 leading-relaxed">
            현재 화면에서 감지된 관련정보 참고문서가 없습니다.
          </div>
        ) : (
          relatedDocs.map((doc, index) => {
            const key = onnaraKey(doc);
            const selected = selectedKeys.includes(key);
            return (
              <OnnaraRefItem
                key={key}
                doc={doc}
                index={index}
                selected={selected}
                selectDisabled={!selected && full}
                expanded={expandedKey === key}
                fetching={props.fetchingTitle === doc.title}
                summary={props.refDocSummaries[doc.title]}
                summarizing={props.summarizingTitle === doc.title}
                memo={props.onnaraMemos[doc.title] ?? ''}
                onToggleSelect={() => props.onToggleSelect(key)}
                onToggleExpand={() => props.onToggleExpand(key)}
                onRetry={props.onRetry ? () => props.onRetry!(doc) : undefined}
                retryDisabled={Boolean(props.fetchingTitle)}
                onMemo={(memo) => props.onOnnaraMemo(doc.title, memo)}
              />
            );
          })
        )}
      </div>

      {/* TONGDAL 서고 (TONGDAL.ai와 연결한 경우에만) */}
      <TongdalRefGroup selectedKeys={selectedKeys} full={full} refs={props.tongdalRefs} onToggle={props.onToggleTongdal} />

      {/* 내 참고자료 */}
      <div
        className={`space-y-1.5 rounded-lg transition ${dragging ? 'ring-2 ring-blue-400 bg-blue-50/40' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); takeFiles(e.dataTransfer.files); }}
      >
        <div className="flex items-center justify-between">
          <div className="text-[11.5px] font-semibold text-slate-600">
            내 참고자료{userRefs.length > 0 && <span className="font-normal text-slate-500"> ({userRefs.length}건 보관)</span>}
          </div>
          <input
            ref={picker}
            type="file"
            multiple
            accept={UPLOAD_ACCEPT}
            className="hidden"
            data-testid="user-ref-file-input"
            onChange={(e) => { takeFiles(e.target.files); e.target.value = ''; }}
          />
        </div>

        {props.loadError && <p className="text-[11px] text-rose-700">{props.loadError}</p>}

        {uploads.map((upload) => (
          <div key={upload.id} className={`p-2 rounded-lg border text-xs flex items-start justify-between gap-2 ${upload.status === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-blue-50/50 border-blue-200 text-blue-800'}`} role={upload.status === 'error' ? 'alert' : 'status'}>
            <span className="min-w-0 break-words">
              <strong className="font-semibold">{upload.name}</strong>
              {upload.status === 'reading' ? <span className="animate-pulse"> — 글자를 읽는 중...</span> : <> — {upload.error}</>}
            </span>
            {upload.status === 'error' && (
              <button type="button" onClick={() => props.onDismissUpload(upload.id)} className="shrink-0 text-rose-500 hover:text-rose-700 cursor-pointer" title="닫기">
                <MaterialIcon name="close" size={14} />
              </button>
            )}
          </div>
        ))}

        {userRefs.map((item) => {
          const key = uploadKey(item);
          const selected = selectedKeys.includes(key);
          return (
            <UserRefItem
              key={item.id}
              item={item}
              model={props.model}
              selected={selected}
              selectDisabled={!selected && full}
              expanded={expandedKey === key}
              analyzing={props.analyzing}
              onToggleSelect={() => props.onToggleSelect(key)}
              onToggleExpand={() => props.onToggleExpand(key)}
              onRole={(role) => props.onRole(item.id, role)}
              onMemo={(memo) => props.onMemo(item.id, memo)}
              onReanalyze={() => props.onReanalyze(item.id)}
              onDelete={() => props.onDelete(item.id)}
            />
          );
        })}

        {userRefs.length < USER_REFS_MAX && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => picker.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                picker.current?.click();
              }
            }}
            className={`py-3 px-3 border border-dashed rounded-lg text-center cursor-pointer transition flex flex-col items-center justify-center gap-2 group ${
              dragging
                ? 'bg-blue-50/80 border-blue-500'
                : 'bg-slate-50/80 hover:bg-blue-50/40 border-slate-300 hover:border-blue-400'
            }`}
            title="파일을 끌어다 놓거나 클릭하여 올리기"
          >
            <div
              className={`w-8 h-8 rounded-full border flex items-center justify-center transition shadow-2xs ${
                dragging
                  ? 'bg-blue-100 border-blue-400 text-blue-600'
                  : 'bg-white group-hover:bg-blue-100/60 border-slate-200 group-hover:border-blue-300 text-slate-400 group-hover:text-blue-600'
              }`}
            >
              <MaterialIcon name="cloudUpload" size={18} />
            </div>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {SUPPORTED_FORMATS.map(({ ext, icon, iconClass }) => (
                <span
                  key={ext}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[11px] font-semibold text-slate-700 shadow-2xs"
                >
                  <MaterialIcon name={icon} size={12} className={iconClass} />
                  <span>{ext}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
