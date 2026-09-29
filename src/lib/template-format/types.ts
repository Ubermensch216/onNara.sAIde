/**
 * 서식 파일(.hwpx·.odt)에서 뽑은 본문 서식 (기안 코파일럿 · 서식관리).
 *
 * ★ 값은 적용 대상인 한글(웹기안기) 기준 단위로 저장한다.
 *   글자 크기·여백은 pt, 자간·장평·줄간격은 %. ODT 값은 가져올 때 환산한다.
 * ★ 원본 파일과 본문 글자는 담지 않는다. 확인 화면에 보여 줄 짧은 예시(sample)만 남긴다.
 */

export type FormatSourceKind = 'hwpx' | 'odt';

/** official = 시행문 본문형(1. → 가.), report = 보고서·업무보고형(□ → ○ → -). */
export type FormatDocKind = 'official' | 'report';

export type ParaAlign = 'left' | 'right' | 'center' | 'justify';

export interface CharStyle {
  font: string;
  sizePt: number;
  bold: boolean;
  /** 자간(%). 0이 기본, 음수는 좁게. */
  spacingPct: number;
  /** 장평(%). 100이 기본. */
  ratioPct: number;
}

export interface ParaStyle {
  /** 줄간격(%, 한글 기준). */
  lineSpacingPct: number;
  /** 문단 위·아래 간격(pt). */
  beforePt: number;
  afterPt: number;
  /** 왼쪽 여백(pt, 한글 기준). */
  leftPt: number;
  /** 첫 줄 들여쓰기(+)·내어쓰기(-)(pt, 한글 기준). */
  indentPt: number;
  align: ParaAlign;
}

export interface LevelStyle {
  /** 단계 식별자. 기호 모양이 달라도(○·❍·ㅇ) 같은 단계면 같은 값이다. */
  key: string;
  /** 사람이 읽는 단계 이름. 예: "□ 소제목". */
  label: string;
  /** 원본에 가장 많이 쓰인 기호 그대로(❍, ㅇ, 한컴 사용자 영역 문자 등). 기호가 없으면 빈 문자열. */
  glyph: string;
  /** 이 단계에 쓰인 기호 전체(최대 10개). 󰊱 󰊲 󰊳처럼 번호가 이어지는 기호를 되살리는 데 쓴다. */
  glyphs: string[];
  /** 확인 화면에 보여 줄 예시 한 줄(최대 30자). */
  sample: string;
  /** 줄 앞 공백 칸 수. 전각 공백은 2칸으로 센다. */
  leadSpaces: number;
  char: CharStyle;
  para: ParaStyle;
  /** 근거가 된 문단 수. */
  count: number;
}

export type BoxRole = 'title' | 'summary' | 'chapter';

/** 표로 만든 상자 요소(제목 상자, 요약 상자, Ⅰ 대제목 막대). */
export interface BoxStyle {
  role: BoxRole;
  sample: string;
  char: CharStyle;
  para: ParaStyle;
  /** 앞 칸 글자 서식. 대제목 막대의 번호 칸(Ⅰ), 제목 상자의 '제목:' 칸. */
  leadChar?: CharStyle;
}

export interface PageSetup {
  widthMm: number;
  heightMm: number;
  marginMm: { top: number; bottom: number; left: number; right: number };
}

export interface TemplateFormat {
  version: 1;
  source: { fileName: string; kind: FormatSourceKind; sha256: string; importedAt: number };
  docKind: FormatDocKind;
  page?: PageSetup;
  /** 위 단계부터 순서대로. */
  levels: LevelStyle[];
  boxes: BoxStyle[];
  /** 대제목·소제목 글자(기호 뺀 것). 서식의 '필수 주요 항목' 초안으로 쓴다. */
  headings: string[];
  /** 추정·환산한 값 등 사용자에게 알릴 사항. */
  notes: string[];
}
