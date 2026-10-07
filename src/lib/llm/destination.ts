import { loadInstitutionAiPolicy, readBuildAiConfig } from './config';
import { assessTransfer } from './transfer-policy';

export const AI_DESTINATION_APPROVAL_KEY = 'saide.aiDestinationApproval';

export function normalizeAiEndpoint(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('올바른 HTTP/HTTPS Ollama 주소를 입력하세요.');
  }
  return url.href.replace(/\/+$/, '');
}

export function isLoopbackEndpoint(value: string): boolean {
  try {
    const host = new URL(normalizeAiEndpoint(value)).hostname;
    return host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host);
  } catch { return false; }
}

export function processingLabel(endpoint: string): string {
  if (isLoopbackEndpoint(endpoint)) return '내 PC';
  try { return '원격 서버 · ' + new URL(endpoint).host; } catch { return '주소 확인 필요'; }
}

/** 승인은 대상 주소 하나에만 묶이며, 백업 파일에 실리지 않는다. */
export async function approveAiDestination(endpoint: string): Promise<void> {
  await chrome.storage.local.set({ [AI_DESTINATION_APPROVAL_KEY]: { endpoint: normalizeAiEndpoint(endpoint), approvedAt: Date.now() } });
}

export class AiDestinationError extends Error {
  readonly code = 'ACTION_DENIED' as const;
  constructor(message: string) { super(message); this.name = 'AiDestinationError'; }
}

/** 개인정보 가능성을 보수적으로 탐지한다. 정밀 개인정보 점검기를 대체하지 않는다. */
export function mayContainSensitiveContent(body: unknown): boolean {
  if (typeof body !== 'string') return false;
  return /\b\d{6}[- ]?[1-8]\d{6}\b|\b01[016789][- ]?\d{3,4}[- ]?\d{4}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|"images"\s*:/i.test(body);
}

export async function assertAiDestination(endpoint: string, signal?: AbortSignal, containsSensitiveContent = false): Promise<string> {
  signal?.throwIfAborted();
  const normalized = normalizeAiEndpoint(endpoint);
  const policy = await loadInstitutionAiPolicy(true);
  signal?.throwIfAborted();
  const required = policy.providers?.ollama?.endpoint;
  if (required && normalizeAiEndpoint(required) !== normalized) {
    throw new AiDestinationError('기관 정책이 지정한 AI 서버 주소와 다릅니다. 설정 화면을 다시 열어 주세요.');
  }
  const assessment = assessTransfer(isLoopbackEndpoint(normalized) ? 'local' : 'external',
    policy.externalEgressPolicy ?? readBuildAiConfig().externalEgressPolicy ?? 'confirm', containsSensitiveContent);
  if (assessment.decision === 'block') throw new AiDestinationError('기관 정책이 원격 AI 서버로의 전송을 차단했습니다.');
  if (assessment.decision === 'confirm') {
    const stored = await chrome.storage.local.get(AI_DESTINATION_APPROVAL_KEY);
    if ((stored[AI_DESTINATION_APPROVAL_KEY] as { endpoint?: string } | undefined)?.endpoint !== normalized) {
      throw new AiDestinationError('원격 AI 서버로 문서를 보내려면 설정에서 해당 주소를 확인하고 승인해 주세요.');
    }
  }
  signal?.throwIfAborted();
  return normalized;
}

/** 리다이렉트로 승인한 서버를 벗어나는 요청을 막는다. */
export async function aiFetch(endpoint: string, apiPath: string, init: RequestInit = {}, transport: typeof fetch = fetch): Promise<Response> {
  if (!/^\/api\/(?:chat|generate|embed|show|version|tags|ps)$/.test(apiPath)) throw new AiDestinationError('허용되지 않은 AI API 경로입니다.');
  const normalized = await assertAiDestination(endpoint, init.signal ?? undefined, mayContainSensitiveContent(init.body));
  return transport(normalized + apiPath, { ...init, credentials: 'omit', redirect: 'error' });
}
