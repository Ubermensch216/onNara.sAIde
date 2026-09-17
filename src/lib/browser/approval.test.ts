// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { createApprovalRegistry } from './approval';
const control = () => ({ id: 'request', deadline: Date.now() + 15000, expectedUrl: location.href });
beforeEach(() => { document.body.innerHTML = '<form action="/safe"><button id="go">Go</button></form>'; });
function registry() { return createApprovalRegistry(s => document.querySelector(s), e => e.textContent ?? ''); }
const action = { kind: 'click' as const, selector: '#go' };
it('allows the same element once and rejects a replay', () => {
  const r = registry(); const ticket = r.prepare(action, control());
  const c = { ...control(), approvalToken: ticket.token };
  expect(r.consume(action, c)).toBe(document.querySelector('#go'));
  expect(() => r.consume(action, c)).toThrow();
});
it('rejects an identical replacement node', () => {
  const r = registry(); const ticket = r.prepare(action, control());
  document.querySelector('#go')!.outerHTML = '<button id="go">Go</button>';
  expect(() => r.consume(action, { ...control(), approvalToken: ticket.token })).toThrow();
});
it('rejects changed labels, form destinations and action arguments', () => {
  const r = registry(); const ticket = r.prepare(action, control());
  document.querySelector('form')!.setAttribute('action', '/changed');
  expect(() => r.consume(action, { ...control(), approvalToken: ticket.token })).toThrow();
  const next = r.prepare(action, control());
  expect(() => r.consume({ kind: 'type_text', selector: '#go', text: 'changed' }, { ...control(), approvalToken: next.token })).toThrow();
});
