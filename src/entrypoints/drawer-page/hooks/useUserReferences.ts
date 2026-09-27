/**
 * 기안 코파일럿 '내 참고자료' — 목록 구독, 파일 올리기, 순차 분석 큐.
 *
 * ★ 파일 바이트는 온나라 페이지(부모 창)를 거치지 않는다. 드로어는 확장 페이지라
 *   확장 DB에 바로 쓰고, PDF만 백그라운드(오프스크린 pdf.js)에 직접 맡긴다.
 *
 * ★ 분석은 한 번에 하나씩 돈다. 초안 생성 중(paused)에는 멈췄다가 끝나면 이어서 한다.
 *   CPU 한 대에서 도는 Ollama에 두 요청을 겹치면 둘 다 느려질 뿐이다.
 *   구간마다 진행분을 저장하므로 멈추거나 드로어를 닫아도 끝난 구간은 다시 하지 않는다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { extractFileBytes, FileExtractError, sha256Hex } from '@/lib/extract/files';
import { bytesToBase64, type PdfTextResult } from '@/lib/extract/pdf-text';
import {
  ANALYZER_VERSION,
  extractCodeFacts,
  isAnalysisComplete,
  isAnalysisCurrent,
  runAnalysis,
  type RefAnalysis,
  type RefRole,
} from '@/lib/onnara/reference-analysis';
import {
  addUserRef,
  deleteUserRef,
  getUserRef,
  onUserRefsChanged,
  updateUserRef,
  type UserRef,
} from '@/lib/storage/user-refs';

export interface UploadState {
  id: string;
  name: string;
  status: 'reading' | 'error';
  error?: string;
}

export interface AnalyzingState {
  id: string;
  done: number;
  total: number;
}

async function parsePdfInBackground(bytes: Uint8Array, hash: string): Promise<PdfTextResult> {
  const reply = (await chrome.runtime.sendMessage({
    type: 'PARSE_UPLOADED_PDF',
    base64: bytesToBase64(bytes),
    bytes: bytes.length,
    hash,
  })) as PdfTextResult | undefined;
  return reply ?? { text: '', pages: 0, error: 'PDF 해석기가 응답하지 않았습니다' };
}

/** 이 자료를 지금 설정(용도·모델)으로 분석해야 하는가. 오류가 난 것은 사용자가 [재분석]을 누를 때까지 두지 않는다. */
export function needsAnalysis(ref: UserRef, model: string): boolean {
  if (isAnalysisComplete(ref.analysis, ref.role, model)) return false;
  if (isAnalysisCurrent(ref.analysis, ref.role, model) && ref.analysis.error) return false;
  return true;
}

export function useUserReferences(options: { endpoint: string; model: string; paused: boolean }) {
  const { endpoint, model, paused } = options;
  const [refs, setRefs] = useState<UserRef[]>([]);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [analyzing, setAnalyzing] = useState<AnalyzingState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => onUserRefsChanged(setRefs, (error) => {
    setLoadError(error instanceof Error ? error.message : '내 참고자료를 불러오지 못했습니다.');
  }), []);

  /** 파일을 읽어 자료함에 넣는다. 새로 넣었거나 이미 있던 자료의 id를 돌려준다. */
  const upload = useCallback(async (files: File[]): Promise<string[]> => {
    const ids: string[] = [];
    for (const file of files) {
      const uploadId = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setUploads((prev) => [...prev, { id: uploadId, name: file.name, status: 'reading' }]);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const hash = await sha256Hex(bytes);
        const extracted = await extractFileBytes(file.name, bytes, { parsePdf: (data) => parsePdfInBackground(data, hash) });
        const { ref } = await addUserRef({
          name: file.name,
          format: extracted.format,
          size: bytes.length,
          contentHash: hash,
          role: 'fact',
          text: extracted.text,
          pages: extracted.pages,
          warnings: extracted.warnings,
          codeFacts: extractCodeFacts(extracted.text),
        });
        ids.push(ref.id);
        setUploads((prev) => prev.filter((item) => item.id !== uploadId));
      } catch (error) {
        const message = error instanceof FileExtractError || error instanceof Error ? error.message : String(error);
        setUploads((prev) => prev.map((item) => (item.id === uploadId ? { ...item, status: 'error', error: message } : item)));
      }
    }
    return ids;
  }, []);

  const dismissUpload = useCallback((id: string) => {
    setUploads((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const stopIfRunning = useCallback((id: string) => {
    if (analyzing?.id === id) controller.current?.abort();
  }, [analyzing]);

  const setRole = useCallback(async (id: string, role: RefRole) => {
    stopIfRunning(id);
    await updateUserRef(id, { role });
  }, [stopIfRunning]);

  const setMemo = useCallback(async (id: string, memo: string) => {
    await updateUserRef(id, { memo });
  }, []);

  const reanalyze = useCallback(async (id: string) => {
    stopIfRunning(id);
    await updateUserRef(id, { analysis: undefined });
  }, [stopIfRunning]);

  const remove = useCallback(async (id: string) => {
    stopIfRunning(id);
    await deleteUserRef(id);
  }, [stopIfRunning]);

  const touch = useCallback(async (ids: string[]) => {
    const now = Date.now();
    await Promise.all(ids.map((id) => updateUserRef(id, { lastUsedAt: now })));
  }, []);

  // 초안 생성이 시작되면 돌던 분석을 멈춘다(끝난 구간은 저장돼 있다).
  useEffect(() => {
    if (paused) controller.current?.abort();
  }, [paused]);

  // 분석 큐: 분석이 필요한 자료를 하나씩 처리한다.
  useEffect(() => {
    if (paused || analyzing || !model || !endpoint) return;
    const candidate = refs.find((ref) => needsAnalysis(ref, model));
    if (!candidate) return;

    const abort = new AbortController();
    controller.current = abort;
    setAnalyzing({ id: candidate.id, done: 0, total: 0 });
    let last: RefAnalysis | undefined;

    void (async () => {
      // ★ 목록(liveQuery)은 저장보다 한 박자 늦게 온다. 방금 끝낸 자료를 옛 목록으로 다시 돌리지 않도록 DB에서 새로 읽는다.
      const next = await getUserRef(candidate.id);
      if (!next || !needsAnalysis(next, model)) {
        if (controller.current === abort) controller.current = null;
        setAnalyzing(null);
        return;
      }
      last = isAnalysisCurrent(next.analysis, next.role, model) ? next.analysis : undefined;
      setAnalyzing({ id: next.id, done: last?.partials.length ?? 0, total: last?.chunks ?? 0 });
      try {
        const result = await runAnalysis({
          text: next.text,
          title: next.name,
          role: next.role,
          target: { endpoint, model },
          codeFacts: next.codeFacts,
          previous: last,
          signal: abort.signal,
          onProgress: async (progress) => {
            last = progress;
            setAnalyzing({ id: next.id, done: progress.partials.length, total: progress.chunks });
            // 사용자가 도중에 용도를 바꿨거나 지웠으면 옛 진행분을 쓰지 않는다.
            const current = await getUserRef(next.id);
            if (current && current.role === next.role) await updateUserRef(next.id, { analysis: progress });
          },
        });
        const current = await getUserRef(next.id);
        if (current && current.role === next.role) await updateUserRef(next.id, { analysis: result });
      } catch (error) {
        if (!abort.signal.aborted) {
          const message = error instanceof Error ? error.message : String(error);
          const current = await getUserRef(next.id);
          if (current && current.role === next.role) {
            await updateUserRef(next.id, {
              analysis: last
                ? { ...last, error: message }
                : { role: next.role, model, analyzerVersion: ANALYZER_VERSION, chunks: 0, partials: [], error: message },
            });
          }
        }
      } finally {
        if (controller.current === abort) controller.current = null;
        setAnalyzing(null);
      }
    })();
  }, [refs, paused, analyzing, model, endpoint]);

  // 드로어를 닫으면 멈춘다.
  useEffect(() => () => controller.current?.abort(), []);

  return { refs, uploads, analyzing, loadError, upload, dismissUpload, setRole, setMemo, reanalyze, remove, touch };
}
