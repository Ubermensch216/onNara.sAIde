// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  ContenteditableEditorAdapter,
  resolveEditorAdapter,
  SafeFallbackEditorAdapter,
  TextareaEditorAdapter,
} from './draft-editor';
import { captureDraftContext } from './draft-context';

describe('draft-editor adapter system', () => {
  const dummyTab = {
    tabId: 1,
    frameId: 0,
    origin: 'http://99.1.2.134',
  };

  it('textarea가 있는 경우 TextareaEditorAdapter를 선택하고 삽입한다', async () => {
    const doc = document.implementation.createHTMLDocument();
    const ta = doc.createElement('textarea');
    ta.name = 'body';
    ta.value = '기존 보고 내용';
    doc.body.appendChild(ta);

    const ctx = captureDraftContext(doc, dummyTab);
    const { adapter, capability } = await resolveEditorAdapter(ctx, doc);

    expect(adapter.id).toBe('textarea-adapter');
    expect(capability).toBe('cursor');

    const op = { text: '1. 추진배경\n테스트', mode: 'cursor' as const, approvalToken: 'tok-1' };
    const res = await adapter.apply(ctx, op, doc);

    expect(res.status).toBe('applied');
    expect(ta.value).toContain('1. 추진배경');
  });

  it('contenteditable 요소가 있는 경우 ContenteditableEditorAdapter를 선택한다', async () => {
    const doc = document.implementation.createHTMLDocument();
    const div = doc.createElement('div');
    div.setAttribute('contenteditable', 'true');
    doc.body.appendChild(div);

    const ctx = captureDraftContext(doc, dummyTab);
    const { adapter, capability } = await resolveEditorAdapter(ctx, doc);

    expect(adapter.id).toBe('contenteditable-adapter');
    expect(capability).toBe('cursor');
  });

  it('contenteditable도 승인 당시 선택 위치에 넣고, 본문이 바뀌었으면 거부한다', async () => {
    // createHTMLDocument()에는 Selection이 없어 전역 document를 쓴다.
    const doc = document;
    doc.body.innerHTML = '';
    const div = doc.createElement('div');
    div.setAttribute('contenteditable', 'true');
    div.textContent = '앞부분뒷부분';
    doc.body.appendChild(div);
    const ctx = captureDraftContext(doc, dummyTab);
    const adapter = new ContenteditableEditorAdapter();

    const range = doc.createRange();
    range.setStart(div.firstChild!, 3);
    range.collapse(true);
    doc.getSelection()!.removeAllRanges();
    doc.getSelection()!.addRange(range);
    const prepared = await adapter.prepare(ctx, '[초안]', 'cursor', doc);

    doc.getSelection()!.removeAllRanges(); // 승인하는 사이 선택이 사라짐
    const op = { text: '[초안]', mode: 'cursor' as const, approvalToken: 't', target: prepared.target };
    expect((await adapter.apply(ctx, op, doc)).status).toBe('applied');
    expect(div.textContent).toBe('앞부분[초안]뒷부분');

    // 같은 승인으로 한 번 더: 본문이 이미 바뀌었으므로 거부
    const again = await adapter.apply(ctx, op, doc);
    expect(again.status).toBe('rejected');
    expect(div.textContent).toBe('앞부분[초안]뒷부분');
    doc.body.innerHTML = '';
  });

  it('에디터가 없고 [본문작성] 버튼이 있으면 needsOpenBody=true를 알린다', async () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = `
      <input name="docTitle" value="2026 기안" />
      <button type="button">본문작성</button>
    `;

    const ctx = captureDraftContext(doc, dummyTab);
    const res = await resolveEditorAdapter(ctx, doc);

    expect(res.capability).toBe('copy-only');
    expect(res.needsOpenBody).toBe(true);
    expect(res.reason).toContain('본문작성');
  });
});
