/**
 * 서식 적용 초안 미리보기 (기안 코파일럿 · 생성 결과).
 *
 * 등록한 서식(글꼴·크기·굵게·줄간격·앞 칸)을 입혀 본문에 들어갈 모양에 가깝게 보여 준다.
 * ★ 한컴 전용 기호(사용자 영역 문자)는 드로어에서 깨지므로 비슷한 모양으로 바꿔 보여 준다(실제 삽입은 원래 문자).
 * ★ 드로어 폭에 맞춰 글자 크기를 줄여 그린다. 상대 크기(제목 > 소제목 > 항목)는 유지한다.
 */

import type { StyledParagraph } from '@/lib/template-format/apply';
import { displayGlyph } from './TemplateFormatEditor';

const SCALE = 0.78;

function visibleText(p: StyledParagraph): string {
  // 앞 공백 뒤 첫 글자가 사용자 영역 기호면 바꿔 보여 준다.
  return p.text.replace(/^( *)(\S)/u, (_m, lead: string, ch: string) => `${lead}${displayGlyph({ key: p.levelKey, glyph: ch })}`);
}

export function StyledDraftPreview({ paras, templateTitle }: { paras: StyledParagraph[]; templateTitle: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[10.5px] text-emerald-700 font-semibold">[{templateTitle}] 서식 적용 미리보기 · 본문에 넣을 때 이 서식으로 들어갑니다</p>
      <div className="space-y-0">
        {paras.map((p, index) => {
          const style = {
            fontFamily: p.char.font ? `'${p.char.font}', 'Batang', serif` : undefined,
            fontSize: `${Math.max(10, p.char.sizePt * SCALE)}px`,
            fontWeight: p.char.bold ? 700 : 400,
            letterSpacing: `${p.char.spacingPct / 100}em`,
            lineHeight: p.para.lineSpacingPct / 100,
            textAlign: p.para.align === 'justify' ? ('left' as const) : p.para.align,
            marginTop: `${Math.min(p.para.beforePt, 24) * SCALE}px`,
          };
          if (p.role === 'chapter') {
            return (
              <div key={index} className="flex items-stretch border border-blue-900 my-1" style={{ marginTop: style.marginTop }}>
                <span className="bg-blue-900 text-white px-2 flex items-center" style={{ ...style, fontFamily: p.leadChar?.font ? `'${p.leadChar.font}', sans-serif` : style.fontFamily, fontWeight: p.leadChar?.bold ? 700 : style.fontWeight, marginTop: 0 }}>{p.lead}</span>
                <span className="px-2" style={{ ...style, marginTop: 0 }}>{p.text}</span>
              </div>
            );
          }
          if (p.role === 'title') {
            return <div key={index} className="text-center border-y border-slate-400 py-1 mb-1" style={{ ...style, textAlign: 'center' }}>{p.text}</div>;
          }
          return (
            <div key={index} className="whitespace-pre-wrap break-keep text-slate-900" style={style}>
              {p.text ? visibleText(p) : ' '}
            </div>
          );
        })}
      </div>
    </div>
  );
}
