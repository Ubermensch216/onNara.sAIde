// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DraftTransactionController } from './draft-controller';
import { captureDraftContext } from './draft-context';

describe('DraftTransactionController', () => {
  const dummyTab = {
    tabId: 1,
    frameId: 0,
    origin: 'http://99.1.2.134',
  };

  it('PREPARE 단계에서 일회용 승인 토큰을 발급한다', async () => {
    const doc = document.implementation.createHTMLDocument();
    const ta = doc.createElement('textarea');
    ta.name = 'body';
    doc.body.appendChild(ta);

    const ctx = captureDraftContext(doc, dummyTab);
    const controller = new DraftTransactionController();

    const plan = await controller.prepare(ctx, '공문서 초안 내용', 'cursor', doc);
    expect(plan.approvalToken).toMatch(/^draft_tok_/);
    expect(plan.capability).toBe('cursor');
    expect(plan.expiresAt).toBeGreaterThan(Date.now());
  });

  it('유효한 토큰으로 COMMIT 하면 단 1회 삽입되고 토큰이 소모된다', async () => {
    const doc = document.implementation.createHTMLDocument();
    const ta = doc.createElement('textarea');
    ta.name = 'body';
    doc.body.appendChild(ta);

    const ctx = captureDraftContext(doc, dummyTab);
    const controller = new DraftTransactionController();

    const plan = await controller.prepare(ctx, '초안 텍스트', 'cursor', doc);
    const res = await controller.commit(ctx, plan.approvalToken, '초안 텍스트', doc);

    expect(res.ok).toBe(true);
    expect(res.status).toBe('applied');
    expect(ta.value).toContain('초안 텍스트');

    // 같은 토큰으로 2회째 시도 시 거부
    const retry = await controller.commit(ctx, plan.approvalToken, '초안 텍스트', doc);
    expect(retry.ok).toBe(false);
  });

  function setup(value: string) {
    const doc = document.implementation.createHTMLDocument();
    const ta = doc.createElement('textarea');
    ta.name = 'body';
    ta.value = value;
    doc.body.appendChild(ta);
    return { doc, ta, ctx: captureDraftContext(doc, dummyTab), controller: new DraftTransactionController() };
  }

  it('승인 뒤 커서가 옮겨져도 승인 당시 위치에 넣는다', async () => {
    const { doc, ta, ctx, controller } = setup('가나다\n라마바');
    ta.setSelectionRange(3, 3); // "가나다" 뒤
    const plan = await controller.prepare(ctx, '초안', 'cursor', doc);
    expect(plan.preview).toBe('가나다\n초안\n라마바');

    ta.setSelectionRange(0, 0); // 승인 버튼을 누르는 사이 커서가 맨 앞으로 옮겨짐
    const res = await controller.commit(ctx, plan.approvalToken, '초안', doc);

    expect(res.ok).toBe(true);
    expect(ta.value).toBe('가나다\n초안\n라마바');
  });

  it('승인 뒤 본문이 바뀌면 넣지 않고 거부한다', async () => {
    const { doc, ta, ctx, controller } = setup('가나다');
    ta.setSelectionRange(3, 3);
    const plan = await controller.prepare(ctx, '초안', 'cursor', doc);

    ta.value = '가나다 추가 입력';
    const res = await controller.commit(ctx, plan.approvalToken, '초안', doc);

    expect(res.ok).toBe(false);
    expect(res.message).toContain('다시 준비');
    expect(ta.value).toBe('가나다 추가 입력');
  });

  it('승인한 입력창이 다른 요소로 바뀌면 거부한다', async () => {
    const { doc, ta, ctx, controller } = setup('가나다');
    const plan = await controller.prepare(ctx, '초안', 'cursor', doc);

    const replacement = doc.createElement('textarea');
    replacement.name = 'body';
    replacement.value = '가나다';
    ta.replaceWith(replacement);
    const res = await controller.commit(ctx, plan.approvalToken, '초안', doc);

    expect(res.ok).toBe(false);
    expect(replacement.value).toBe('가나다');
  });

  it('텍스트 내용이 변경되면 COMMIT이 거부된다', async () => {
    const doc = document.implementation.createHTMLDocument();
    const ta = doc.createElement('textarea');
    ta.name = 'body';
    doc.body.appendChild(ta);

    const ctx = captureDraftContext(doc, dummyTab);
    const controller = new DraftTransactionController();

    const plan = await controller.prepare(ctx, '원래 텍스트', 'cursor', doc);
    const res = await controller.commit(ctx, plan.approvalToken, '위조된 텍스트', doc);

    expect(res.ok).toBe(false);
    expect(res.message).toContain('변경');
  });
});
