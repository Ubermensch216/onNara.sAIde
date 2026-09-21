/**
 * 데이터 백업 · 복원 화면.
 *
 * ★ 이 화면이 막는 것은 버그가 아니라 **저장소가 사라지는 길**이다. 확장의 저장소는
 *   확장 ID에 묶여 있고, 제거·재설치나 다른 폴더에서의 재적재는 ID를 바꾼다. 코드가
 *   잘 동작해도 데이터는 그렇게 사라진다. 그래서 안내 문구를 접어 두지 않고 맨 위에 둔다 —
 *   "언제 받아야 하는지"를 모르면 백업 기능은 아무도 누르지 않는 버튼이다.
 *
 * ★ 복원은 덮어쓰기다. 확인 대화상자에 **무엇이 지워지는지**까지 적는다.
 */

import { useEffect, useRef, useState } from 'react';
import { useRichT, useT } from '@/lib/i18n';
import { downloadText } from '@/lib/schedule/export';
import {
  backupFileName,
  collectBackup,
  lastBackupAt,
  markBackedUp,
  parseBackup,
  restoreBackup,
  serializeBackup,
  summarize,
} from '@/lib/storage/backup';

export function BackupPanel() {
  const t = useT();
  const rt = useRichT();
  const [includeMemory, setIncludeMemory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [lastAt, setLastAt] = useState<number | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => { void lastBackupAt().then(setLastAt); }, []);

  const exportNow = async () => {
    setBusy(true); setError(''); setNote('');
    try {
      const backup = await collectBackup({ includeMemory });
      const name = backupFileName();
      downloadText(name, serializeBackup(backup), 'application/json');
      await markBackedUp(backup.createdAt);
      setLastAt(backup.createdAt);
      setNote(t('opt.backup.exported', { name, n: summarize(backup).total }));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * 고른 파일로 되돌린다.
   *
   * ★ 확인을 받기 전에 파일을 먼저 읽고 검증한다. 손상된 파일을 고른 사용자에게
   *   "지웁니다, 계속할까요?"부터 묻고 나서 실패하면, 아무것도 지우지 않았어도
   *   사용자는 자기 데이터가 어떻게 됐는지 알 수 없다.
   */
  const restoreFrom = async (file: File) => {
    setBusy(true); setError(''); setNote('');
    // 복원에 성공하면 확장이 곧 다시 시작된다. 그동안 버튼을 되살리지 않는다.
    let restarting = false;
    try {
      const backup = parseBackup(await file.text());
      const { total } = summarize(backup);
      const date = backup.createdAt ? new Date(backup.createdAt).toLocaleString() : '—';
      if (!window.confirm(t('opt.backup.confirm', { date, n: total }))) return;

      await restoreBackup(backup);
      setNote(t('opt.backup.restored', { n: total }));
      restarting = true;
      // ★ 확장을 다시 시작한다. 서비스 워커와 열려 있는 사이드패널이 복원 전의 값을
      //   메모리에 들고 있어, 그대로 두면 화면마다 다른 내용이 보인다.
      setTimeout(() => chrome.runtime.reload(), 1200);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      if (!restarting) setBusy(false);
    }
  };

  return (
    <section>
      <h2>{t('opt.backup.h')}</h2>
      {error && <p className="warn" role="alert">{error}</p>}

      <div className="field">
        <p className="desc">{rt('opt.backup.intro')}</p>
        <p className="desc">
          {lastAt ? t('opt.backup.lastAt', { date: new Date(lastAt).toLocaleString() }) : t('opt.backup.never')}
        </p>
      </div>

      <div className="field">
        <div className="row">
          <label htmlFor="backup-memory">{t('opt.backup.includeMemory')}</label>
          <input
            id="backup-memory"
            type="checkbox"
            checked={includeMemory}
            onChange={(e) => setIncludeMemory(e.target.checked)}
          />
        </div>
        <p className="desc">{t('opt.backup.includeMemoryDesc')}</p>
      </div>

      <div className="field">
        <button className="btn" disabled={busy} onClick={() => void exportNow()}>
          {busy ? t('opt.backup.working') : t('opt.backup.export')}
        </button>
        <p className="desc" style={{ marginTop: 8 }}>{t('opt.backup.exportDesc')}</p>
      </div>

      <div className="field">
        <button className="btn" disabled={busy} onClick={() => picker.current?.click()}>
          {t('opt.backup.restore')}
        </button>
        <input
          ref={picker}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            // 같은 파일을 두 번 고를 수 있어야 한다. 값을 비우지 않으면 change가 다시 오지 않는다.
            e.target.value = '';
            if (file) void restoreFrom(file);
          }}
        />
        <p className="desc" style={{ marginTop: 8 }}>{rt('opt.backup.restoreDesc')}</p>
      </div>

      {note && <p className="desc" role="status">{note}</p>}
    </section>
  );
}
