/**
 * 서식 파일에서 가져온 본문 서식 확인·수정 (서식관리).
 *
 * ★ 분석값은 파일에 적힌 그대로다. 한 문서 안에서도 값이 흩어져 있으므로(실물 확인) 등록 전에 사람이 보고 고친다.
 * ★ 원본 예시 문장(sample)은 확인하는 동안만 보여 주고 저장할 때 지운다(stripFormatSamples). 미리보기는 일반 예시 문구를 쓴다.
 */

import type { CharStyle, LevelStyle, TemplateFormat } from '@/lib/template-format/types';
import { MaterialIcon } from './MaterialIcon';

/** 미리보기 예시 문구. 원본 문서 내용 대신 쓴다. */
const PREVIEW_TEXT: Record<string, string> = {
  title: '○○ 추진 계획 보고',
  chapter: '추진 배경',
  section: '추진 배경',
  'sym-pua': '세부 추진 내용',
  num: '관련: ○○과-1234(2026. 9. 1.)호',
  ga: '세부 사항을 기재합니다.',
  item: '주요 내용을 개조식으로 적습니다',
  circled: '세부 과제',
  sub: '세부 사항을 적습니다',
  detail: '세부 내용',
  arrow: '참고 사항',
  note: '주석 및 근거',
  attach: '○○ 계획서 1부.  끝.',
  body: '이어지는 문장',
};

function isPua(glyph: string): boolean {
  const cp = glyph.codePointAt(0) ?? 0;
  return cp >= 0xf0000 || (cp >= 0xe000 && cp <= 0xf8ff);
}

/**
 * 드로어에서 보여 줄 기호. 한컴 전용 문자(사용자 영역)는 한컴 글꼴이 없으면 깨지므로 비슷한 모양으로 바꿔 보여 준다.
 * 실제 본문에는 원래 문자를 넣는다.
 */
export function displayGlyph(level: Pick<LevelStyle, 'key' | 'glyph'>): string {
  if (!level.glyph || !isPua(level.glyph)) return level.glyph;
  return level.key === 'section' ? '□' : '①';
}

export function stripFormatSamples(format: TemplateFormat): TemplateFormat {
  return {
    ...format,
    levels: format.levels.map(level => ({ ...level, sample: '' })),
    boxes: format.boxes.map(box => ({ ...box, sample: '' })),
  };
}

function charSummary(c: CharStyle): string {
  return `${c.font || '기본 글꼴'} ${c.sizePt}pt${c.bold ? ' 진하게' : ''}`;
}

const BOX_LABEL: Record<string, string> = { title: '제목 상자', summary: '요약 상자', chapter: 'Ⅰ 대제목 막대' };

/** 서식 카드용 한 줄 요약. */
export function TemplateFormatSummary({ format }: { format: TemplateFormat }) {
  const glyphs = format.levels.filter(l => l.glyph).map(displayGlyph);
  const main = format.levels.find(l => l.key === 'item' || l.key === 'num') ?? format.levels[0];
  return (
    <div className="text-[10.5px] text-slate-600 bg-emerald-50/60 border border-emerald-200 rounded px-2 py-1.5 space-y-0.5">
      <div className="flex items-center gap-1 font-bold text-emerald-800">
        <MaterialIcon name="textSnippet" size={14} />
        본문 서식 포함 · {format.docKind === 'official' ? '시행문형' : '보고서형'}
      </div>
      {main && <div>{charSummary(main.char)} · 줄간격 {main.para.lineSpacingPct}%</div>}
      {glyphs.length > 0 && <div>단계 기호 {glyphs.join(' → ')}</div>}
      <div className="text-slate-400 truncate" title={format.source.fileName}>원본: {format.source.fileName}</div>
    </div>
  );
}

interface EditorProps {
  format: TemplateFormat;
  onChange: (format: TemplateFormat) => void;
}

const inputCls = 'w-full min-w-0 px-1 py-0.5 border border-slate-300 rounded text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500';

function NumField({ label, value, onChange, step = 1, suffix }: { label: string; value: number; onChange: (n: number) => void; step?: number; suffix?: string }) {
  return (
    <label className="flex flex-col gap-0.5 text-[10px] text-slate-500">
      <span>{label}{suffix ? ` (${suffix})` : ''}</span>
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={e => onChange(Number(e.target.value))}
        className={inputCls}
      />
    </label>
  );
}

export function TemplateFormatEditor({ format, onChange }: EditorProps) {
  const updateLevel = (index: number, patch: (level: LevelStyle) => LevelStyle) => {
    onChange({ ...format, levels: format.levels.map((l, i) => (i === index ? patch(l) : l)) });
  };
  const removeLevel = (index: number) => {
    onChange({ ...format, levels: format.levels.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-bold text-slate-800 text-[11px]">
          본문 서식 ({format.docKind === 'official' ? '시행문형' : '보고서형'})
        </span>
        <span className="text-[10px] text-slate-400 truncate max-w-[55%]" title={format.source.fileName}>{format.source.fileName}</span>
      </div>
      <p className="text-[10.5px] text-slate-500 leading-tight">
        파일에서 단계별로 가장 많이 쓰인 값을 골랐습니다. 다르게 보이는 값은 고쳐 주세요.
      </p>

      {/* 미리보기 */}
      <div className="bg-white border border-slate-300 rounded p-2 space-y-0.5 overflow-hidden" aria-label="서식 미리보기">
        {format.levels.map(level => (
          <div
            key={level.key}
            style={{
              fontFamily: `'${level.char.font}', 'Batang', serif`,
              fontSize: `${Math.max(9, level.char.sizePt * 0.72)}px`,
              fontWeight: level.char.bold ? 700 : 400,
              letterSpacing: `${level.char.spacingPct / 100}em`,
              lineHeight: level.para.lineSpacingPct / 100,
              textAlign: level.para.align === 'justify' ? 'left' : level.para.align,
              marginTop: `${Math.min(level.para.beforePt, 20) * 0.5}px`,
              whiteSpace: 'pre',
            }}
            className="text-slate-900 truncate"
          >
            {' '.repeat(level.leadSpaces)}{displayGlyph(level)}{level.glyph ? ' ' : ''}{PREVIEW_TEXT[level.key] ?? PREVIEW_TEXT.body}
          </div>
        ))}
      </div>

      {/* 단계별 값 */}
      <div className="space-y-1.5">
        {format.levels.map((level, index) => (
          <div key={level.key} className="bg-slate-50 border border-slate-200 rounded p-1.5 space-y-1">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[11px] font-bold text-blue-800">
                {displayGlyph(level) || '·'} {level.label.replace(/^\S+\s/, '') || level.label}
                <span className="font-normal text-slate-400"> · {level.count}문단</span>
              </span>
              <button
                type="button"
                onClick={() => removeLevel(index)}
                className="p-0.5 text-slate-400 hover:text-red-600"
                title="이 단계 빼기"
                aria-label={`${level.label} 단계 빼기`}
              >
                <MaterialIcon name="close" size={14} />
              </button>
            </div>
            {level.sample && (
              <div className="text-[10px] text-slate-400 truncate" title="원본 예시(저장하지 않음)">
                예: {level.glyph && isPua(level.glyph) ? level.sample.replace(level.glyph, displayGlyph(level)) : level.sample}
              </div>
            )}
            <div className="grid grid-cols-4 gap-1">
              <label className="col-span-2 flex flex-col gap-0.5 text-[10px] text-slate-500">
                <span>글꼴</span>
                <input
                  type="text"
                  value={level.char.font}
                  onChange={e => updateLevel(index, l => ({ ...l, char: { ...l.char, font: e.target.value } }))}
                  className={inputCls}
                />
              </label>
              <NumField label="크기" suffix="pt" step={0.5} value={level.char.sizePt} onChange={n => updateLevel(index, l => ({ ...l, char: { ...l.char, sizePt: n } }))} />
              <label className="flex flex-col gap-0.5 text-[10px] text-slate-500">
                <span>진하게</span>
                <input
                  type="checkbox"
                  checked={level.char.bold}
                  onChange={e => updateLevel(index, l => ({ ...l, char: { ...l.char, bold: e.target.checked } }))}
                  className="h-4 w-4 mt-0.5"
                />
              </label>
              <NumField label="앞 칸" value={level.leadSpaces} onChange={n => updateLevel(index, l => ({ ...l, leadSpaces: Math.max(0, Math.round(n)) }))} />
              <NumField label="줄간격" suffix="%" step={5} value={level.para.lineSpacingPct} onChange={n => updateLevel(index, l => ({ ...l, para: { ...l.para, lineSpacingPct: n } }))} />
              <NumField label="자간" suffix="%" value={level.char.spacingPct} onChange={n => updateLevel(index, l => ({ ...l, char: { ...l.char, spacingPct: n } }))} />
              <NumField label="장평" suffix="%" value={level.char.ratioPct} onChange={n => updateLevel(index, l => ({ ...l, char: { ...l.char, ratioPct: n } }))} />
              <NumField label="문단 위" suffix="pt" value={level.para.beforePt} onChange={n => updateLevel(index, l => ({ ...l, para: { ...l.para, beforePt: n } }))} />
              <NumField label="내어쓰기" suffix="pt" value={Math.max(0, -level.para.indentPt)} onChange={n => updateLevel(index, l => ({ ...l, para: { ...l.para, indentPt: -Math.max(0, n) } }))} />
            </div>
          </div>
        ))}
      </div>

      {format.boxes.length > 0 && (
        <div className="text-[10.5px] text-slate-600 bg-slate-50 border border-slate-200 rounded p-1.5 space-y-0.5">
          <div className="font-bold text-slate-700">상자 요소(표)</div>
          {format.boxes.map(box => (
            <div key={box.role}>
              · {BOX_LABEL[box.role] ?? box.role}: {box.leadChar ? `${charSummary(box.leadChar)} + ` : ''}{charSummary(box.char)}
            </div>
          ))}
        </div>
      )}

      {format.notes.length > 0 && (
        <ul className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-1.5 space-y-0.5 list-none">
          {format.notes.map(note => (
            <li key={note} className="flex gap-1"><MaterialIcon name="warning" size={12} className="shrink-0 mt-px" />{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
