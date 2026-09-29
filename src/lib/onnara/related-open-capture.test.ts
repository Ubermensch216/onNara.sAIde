// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { captureRelatedOpenRequest } from './related-open-capture';

const id = 'ENF6989F09F81B3945218AD080C4645FC55';
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; delete (window as any).viewEnfDoc; delete (window as any).evilDoc; });

/** 온나라 기안기의 관련정보 링크와 같은 모양: 빈 새 창을 열고 이름 있는 창으로 폼을 제출한다. */
function installViewer(deferred = false) {
  document.body.innerHTML = `<a href="javascript:viewEnfDoc('${id}','N')" class="file_link">핑크문화데이</a>`;
  const nativeOpen = window.open;
  (window as any).viewEnfDoc = (docId: string, paper: string) => {
    const win = window.open('', 'enfView', 'width=900');
    const form = document.createElement('form');
    form.method = 'post'; form.action = '/bms/dctenf/BmsDctEnfReceiptCardDetail.do'; form.target = win!.name;
    for (const [name, value] of [['enfdocid', docId], ['paperdocflag', paper], ['setcardflag', 'Y']]) {
      const input = document.createElement('input'); input.type = 'hidden'; input.name = name!; input.value = value!; form.appendChild(input);
    }
    document.body.appendChild(form);
    if (deferred) setTimeout(() => form.submit(), 100); else form.submit();
    win!.focus();
  };
  return nativeOpen;
}

it('관련정보 열기 함수가 보내려던 요청을 창 없이 기록하고 원래 함수를 되돌린다', async () => {
  const nativeOpen = installViewer();
  const nativeSubmit = HTMLFormElement.prototype.submit;
  const result = await captureRelatedOpenRequest(id);
  expect(result).toEqual({
    method: 'POST', url: `${location.origin}/bms/dctenf/BmsDctEnfReceiptCardDetail.do`,
    fields: [['enfdocid', id], ['paperdocflag', 'N'], ['setcardflag', 'Y']],
  });
  expect(window.open).toBe(nativeOpen);
  expect(HTMLFormElement.prototype.submit).toBe(nativeSubmit);
});

it('setTimeout으로 미룬 제출도 기록한다', async () => {
  installViewer(true);
  const result = await captureRelatedOpenRequest(id);
  expect(result).toMatchObject({ method: 'POST', fields: expect.arrayContaining([['enfdocid', id]]) });
});

it('허용 목록 밖의 함수나 다른 문서 ID의 링크는 실행하지 않는다', async () => {
  const evil = vi.fn();
  (window as any).evilDoc = evil;
  document.body.innerHTML = `<a href="javascript:evilDoc('${id}')">x</a><a href="javascript:viewEnfDoc('ENF00000000000000000000000000000000','N')">y</a>`;
  (window as any).viewEnfDoc = vi.fn();
  expect(await captureRelatedOpenRequest(id)).toHaveProperty('error');
  expect(evil).not.toHaveBeenCalled();
  expect((window as any).viewEnfDoc).not.toHaveBeenCalled();
});
