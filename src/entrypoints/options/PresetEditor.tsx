/**
 * 사용자 정의 프리셋 편집. 계획서 §5 Phase 4-4
 *
 * 슬래시 커맨드로 바로 쓸 수 있는 자기만의 프롬프트를 만든다.
 * `{{selection}}`을 쓰면 커맨드 뒤에 입력한 내용이 그 자리에 들어간다.
 */

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import type { CustomPreset, PresetNeeds } from '@/lib/prompts/presets';
import {
  addCustomPreset,
  deleteCustomPreset,
  loadCustomPresets,
  normalizeSlash,
} from '@/lib/storage/presets';

/** 표시 이름은 카탈로그에서 온다. 여기는 순서만 정한다. */
const NEEDS_ORDER: PresetNeeds[] = ['none', 'page', 'screen', 'selection'];

export function PresetEditor() {
  const t = useT();
  const [list, setList] = useState<CustomPreset[]>([]);
  const [label, setLabel] = useState('');
  const [slash, setSlash] = useState('');
  const [template, setTemplate] = useState('');
  const [needs, setNeeds] = useState<PresetNeeds>('none');

  useEffect(() => {
    loadCustomPresets().then(setList);
  }, []);

  const normalized = normalizeSlash(slash);
  const conflict = list.some((p) => p.slash === normalized);
  const canAdd = Boolean(label.trim() && normalized && template.trim());

  const add = async () => {
    if (!canAdd) return;
    setList(await addCustomPreset({ label, slash, template, needs }));
    setLabel('');
    setSlash('');
    setTemplate('');
    setNeeds('none');
  };

  return (
    <section>
      <h2>{t('preset.h')}</h2>

      <div className="field">
        <p className="desc">
          {t('preset.intro', { selection: '{{selection}}' })}
        </p>
      </div>

      {list.length > 0 && (
        <div className="field">
          <ul className="preset-list">
            {list.map((p) => (
              <li key={p.id}>
                <div className="preset-main">
                  <div className="preset-head">
                    <code>/{p.slash}</code>
                    <strong>{p.label}</strong>
                    <span className="preset-needs">{t(`preset.needs.${p.needs}`)}</span>
                  </div>
                  <div className="preset-body">{p.template}</div>
                </div>
                <button
                  className="btn-sm"
                  onClick={async () => setList(await deleteCustomPreset(p.id))}
                >
                  {t('preset.delete')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="field">
        <div className="row">
          <label htmlFor="p-label">{t('preset.label')}</label>
          <input
            id="p-label"
            type="text"
            value={label}
            placeholder={t('preset.labelPlaceholder')}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>

        <div className="row">
          <label htmlFor="p-slash">{t('preset.slash')}</label>
          <input
            id="p-slash"
            type="text"
            value={slash}
            placeholder="minutes"
            onChange={(e) => setSlash(e.target.value)}
          />
        </div>
        {normalized && (
          <p className={conflict ? 'warn' : 'desc'}>
            <code>/{normalized}</code>
            {conflict ? t('preset.conflict') : t('preset.willSave')}
          </p>
        )}

        <div className="row">
          <label htmlFor="p-needs">{t('preset.needs')}</label>
          <select
            id="p-needs"
            value={needs}
            onChange={(e) => setNeeds(e.target.value as PresetNeeds)}
          >
            {NEEDS_ORDER.map((k) => (
              <option key={k} value={k}>
                {t(`preset.needs.${k}`)}
              </option>
            ))}
          </select>
        </div>
        <p className="desc">
          {t('preset.needsDesc')}
        </p>

        <div className="row" style={{ alignItems: 'flex-start' }}>
          <label htmlFor="p-template">{t('preset.body')}</label>
          <textarea
            id="p-template"
            rows={4}
            value={template}
            placeholder={t('preset.bodyPlaceholder', { selection: '{{selection}}' })}
            onChange={(e) => setTemplate(e.target.value)}
          />
        </div>

        <button className="btn btn-primary" disabled={!canAdd} onClick={add}>
          {t('preset.add')}
        </button>
      </div>
    </section>
  );
}
