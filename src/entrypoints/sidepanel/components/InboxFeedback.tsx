import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { recordFeedback, type FeedbackVerdict } from '@/lib/feedback/store';
import { deleteInboxFeedback, saveInboxFeedback, type InboxFeedbackExample, type LearnedCategory } from '@/lib/inbox/personalize';
import { restoreInboxRuleCategory, setInboxFeedbackCategory } from '@/lib/inbox/panel';
import type { InboxDoc } from '@/lib/inbox/types';
import type { Settings } from '@/lib/storage/settings';
import { ThumbIcon } from './ThumbIcon';

interface Props {
  doc: InboxDoc;
  settings: Settings;
  initial?: FeedbackVerdict;
  example?: InboxFeedbackExample;
  onSaved: () => Promise<void>;
}

export function InboxFeedback({ doc, settings, initial, example, onSaved }: Props) {
  const t = useT();
  const [verdict, setVerdict] = useState<FeedbackVerdict | null>(initial ?? null);
  const [correcting, setCorrecting] = useState(false);
  const [correction, setCorrection] = useState<LearnedCategory>(doc.category === 'mine' ? 'notice' : 'mine');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => { setVerdict(initial ?? null); }, [initial, doc.key]);

  const save = async (next: FeedbackVerdict, category?: LearnedCategory) => {
    setBusy(true);
    setError(false);
    try {
      if (verdict === next && !correcting) {
        await deleteInboxFeedback(doc.key);
        if (example) await restoreInboxRuleCategory(doc, settings);
        setVerdict(null);
      } else {
        if (category) {
          await saveInboxFeedback(doc, category, next, settings);
          await setInboxFeedbackCategory(doc, category);
        }
        await recordFeedback({ kind: 'inbox-relevance', targetKey: doc.key, verdict: next, model: doc.classifier === 'model' ? settings.model : 'rule' });
        setVerdict(next);
      }
      setCorrecting(false);
      await onSaved();
    } catch { setError(true); }
    finally { setBusy(false); }
  };

  return (
    <span className="feedback compact" role="group" aria-label={t('fb.label')}>
      <button type="button" className={`feedback-btn ${verdict === 'good' ? 'on good' : ''}`}
        disabled={busy} aria-pressed={verdict === 'good'} aria-label={t('fb.good')} title={t('fb.goodHint')}
        onClick={() => void save('good', doc.category === 'mine' || doc.category === 'notice' ? doc.category : undefined)}><ThumbIcon direction="up" /></button>
      <button type="button" className={`feedback-btn ${verdict === 'bad' ? 'on bad' : ''}`}
        disabled={busy} aria-pressed={verdict === 'bad'} aria-label={t('fb.bad')} title={t('fb.badHint')} onClick={() => {
          if (verdict === 'bad') void save('bad');
          else setCorrecting(value => !value);
        }}><ThumbIcon direction="down" /></button>
      {correcting && (
        <span className="inbox-feedback-correction">
          <label>{t('fb.inboxCorrection')}{' '}
            <select value={correction} onChange={event => setCorrection(event.target.value as LearnedCategory)}>
              <option value="mine">{t('inbox.cat.mine')}</option>
              <option value="notice">{t('inbox.cat.notice')}</option>
            </select>
          </label>
          <button type="button" disabled={busy} onClick={() => void save('bad', correction)}>{t('fb.inboxApply')}</button>
          <button type="button" onClick={() => setCorrecting(false)}>{t('fb.inboxCancel')}</button>
        </span>
      )}
      {error && <span role="alert">{t('fb.inboxError')}</span>}
    </span>
  );
}
