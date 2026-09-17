import type { EgressPolicy } from './config';
import type { ProcessingLocation } from './provider';

export type TransferDecision = 'allow' | 'confirm' | 'block';

export interface TransferAssessment {
  decision: TransferDecision;
  reasons: Array<'local-processing' | 'institution-block' | 'external-processing' | 'sensitive-content'>;
}

/** 본문·첨부를 공급자에게 넘기기 직전에 호출하는 단일 외부 전송 판정점이다. */
export function assessTransfer(
  location: ProcessingLocation,
  policy: EgressPolicy,
  containsSensitiveContent: boolean,
): TransferAssessment {
  if (location === 'local') return { decision: 'allow', reasons: ['local-processing'] };
  if (policy === 'block') return { decision: 'block', reasons: ['institution-block', 'external-processing'] };

  const reasons: TransferAssessment['reasons'] = ['external-processing'];
  if (containsSensitiveContent) reasons.push('sensitive-content');
  if (policy === 'confirm' || containsSensitiveContent) return { decision: 'confirm', reasons };
  return { decision: 'allow', reasons };
}
