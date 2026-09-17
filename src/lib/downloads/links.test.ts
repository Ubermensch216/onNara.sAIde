// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { downloadLink, parseDownloadLink, runDownloadLink } from './links';
import { describeResult } from '@/lib/onnara/download';
import { renderMarkdown } from '@/lib/markdown';

afterEach(() => vi.unstubAllGlobals());

it('다운로드 결과의 경로를 그대로 보여 주고, 열기·폴더 열기 링크가 정화 후에도 남는다', () => {
  const path = 'C:\Users\kim_01\Downloads\붙임_주요결과(최종).hwpx';
  const md = describeResult({ name: '붙임_주요결과(최종).hwpx', status: 'complete', downloadId: 42, path });
  const html = document.createElement('div');
  html.innerHTML = renderMarkdown(md);
  const [open, show] = [...html.querySelectorAll('a')];
  expect(open!.textContent).toBe(path);
  expect(open!.getAttribute('href')).toBe(downloadLink('open', 42));
  expect(show!.textContent).toBe('폴더 열기');
  expect(parseDownloadLink(show!.getAttribute('href'))).toEqual({ action: 'show', downloadId: 42 });
});

it('모델이나 페이지가 만든 다른 조각·스크립트 링크는 다운로드 동작으로 해석하지 않는다', () => {
  expect(parseDownloadLink('#saide-download=delete:1')).toBeNull();
  expect(parseDownloadLink('#saide-download=open:1x')).toBeNull();
  expect(renderMarkdown('[x](javascript:alert(1)) [y](#saide-download=open:1)')).not.toContain('javascript:');
});

it('경로 링크는 파일을 열고 폴더 링크는 탐색기에서 위치를 보여 준다', async () => {
  const open = vi.fn(async () => undefined);
  const show = vi.fn();
  vi.stubGlobal('chrome', { downloads: { open, show, search: vi.fn() } });
  await runDownloadLink('open', 7);
  await runDownloadLink('show', 7);
  expect(open).toHaveBeenCalledWith(7);
  expect(show).toHaveBeenCalledWith(7);
});

it('파일이 옮겨졌거나 기록이 지워졌으면 이유를 알린다', async () => {
  const search = vi.fn(async ({ id }: { id: number }) => id === 1 ? [{ id: 1, exists: false, state: 'complete', filename: 'C:\a.hwpx' }] : []);
  vi.stubGlobal('chrome', { downloads: { open: vi.fn(async () => { throw new Error('Download file is removed'); }), show: vi.fn(), search } });
  await expect(runDownloadLink('open', 1)).rejects.toThrow('옮겨졌거나 삭제되었습니다: C:\a.hwpx');
  await expect(runDownloadLink('open', 2)).rejects.toThrow('다운로드 기록에서 이 파일을 찾지 못했습니다');
});
