type Content = { content: string; title?: string; attachments?: string[]; error?: string };

/** 주소를 확인한 원문만 임시 탭에서 읽고, 이 함수가 만든 탭만 정리한다. */
export async function readTemporaryReference(
  info: { title: string; id?: string; url?: string }, callerId: number, sourceUrl: string,
  read: (tabId: number, deadline: number) => Promise<Content | null>,
): Promise<Content | null> {
  const source = new URL(sourceUrl);
  let target: URL;
  if (info.url) target = new URL(info.url, source);
  else if (/^DCT[A-F0-9]{32}$/i.test(info.id ?? '')) {
    target = new URL('/bms/dct/viewreport.do', source);
    target.searchParams.set('docid', info.id!);
  } else return null;
  if (target.origin !== source.origin || target.username || target.password ||
    !/\/(?:view|get|select|download)[^/]*\.do$|\.pdf$/i.test(target.pathname) ||
    /delete|remove|insert|update|save|add|modify|approve|sign|logout|markread/i.test(target.pathname) ||
    [...target.searchParams].some(([key, value]) => /^(action|method|cmd|mode)$/i.test(key) && /delete|remove|insert|update|save|add|modify|approve|sign|logout|markread/i.test(value)) ||
    [...target.searchParams].some(([key, value]) => /^(docid|documentid|reportid)$/i.test(key) && info.id && value !== info.id)) return null;
  if ((await chrome.tabs.get(callerId)).url !== sourceUrl) return null;
  // 온나라 뷰어 중에는 보이는 탭에서만 본문 컨트롤을 초기화하는 것이 있다.
  const tab = await chrome.tabs.create({ url: target.href, active: true, openerTabId: callerId });
  if (tab?.id === undefined) return null;
  const deadline = Date.now() + 30_000;
  // 경로가 바뀌면 사용자 이동 또는 다른 화면으로 간주하고 닫지 않는다.
  let owned = true;
  try {
    while (Date.now() < deadline) {
      const current = await chrome.tabs.get(tab.id).catch(() => null);
      if (!current) return null;
      if (current.url && current.url !== 'about:blank' && current.url !== target.href) {
        owned = false;
        return null;
      }
      if ((await chrome.tabs.get(callerId).catch(() => null))?.url !== sourceUrl) return null;
      if (current.url === target.href && current.status === 'complete') {
        const content = await read(tab.id, deadline);
        if (content?.content) return content;
      }
      await new Promise(resolve => setTimeout(resolve, 750));
    }
    throw new Error('임시 원문 탭에서 30초 동안 기다렸지만 본문을 읽지 못했습니다.');
  } finally {
    const current = await chrome.tabs.get(tab.id).catch(() => null);
    if (owned && current && (!current.url || current.url === 'about:blank' || current.url === target.href)) {
      await chrome.tabs.remove(tab.id).catch(() => undefined);
    }
  }
}
