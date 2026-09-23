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
