import { assertCurrent } from './guards';
import { requiresApproval, type PageAction, type RequestControl } from '@/lib/messaging/protocol';

/** Tickets live in the isolated content-script document, never in the page's DOM. */
export function createApprovalRegistry(resolve: (selector: string) => HTMLElement | null, describe: (el: HTMLElement) => string) {
  const tickets = new Map<string, { action: string; element: HTMLElement | null; fingerprint: string; url: string; until: number }>();
  const fingerprint = (el: HTMLElement | null) => el ? JSON.stringify([
    el.outerHTML, el.closest('form')?.getAttribute('action'), el.closest('form')?.getAttribute('method'),
    el instanceof HTMLAnchorElement ? el.href : '',
  ]) : '';
  return {
    prepare(action: PageAction, control: RequestControl) {
      assertCurrent(control, location.href);
      if (!requiresApproval(action)) throw new Error('승인 대상 동작이 아닙니다.');
      const element = 'selector' in action ? resolve(action.selector) : null;
      if ('selector' in action && !element) throw new Error('대상을 명확히 확인할 수 없습니다.');
      const token = crypto.randomUUID();
      for (const [id, ticket] of tickets) if (ticket.until <= Date.now()) tickets.delete(id);
      if (tickets.size >= 32) tickets.delete(tickets.keys().next().value!);
      tickets.set(token, { action: JSON.stringify(action), element, fingerprint: fingerprint(element), url: location.href, until: Date.now() + 120_000 });
      return { token, label: element ? describe(element) : undefined };
    },
    consume(action: PageAction, control: RequestControl) {
      assertCurrent(control, location.href);
      const token = control.approvalToken ?? '';
      const ticket = tickets.get(token);
      tickets.delete(token);
      const element = 'selector' in action ? resolve(action.selector) : null;
      if (!ticket || ticket.until <= Date.now() || ticket.url !== location.href || ticket.action !== JSON.stringify(action) ||
          ticket.element !== element || (element && !element.isConnected) || ticket.fingerprint !== fingerprint(element)) {
        throw new Error('승인한 페이지 또는 요소가 바뀌었거나 승인이 만료되었습니다. 다시 요청하세요.');
      }
      return element;
    },
  };
}
