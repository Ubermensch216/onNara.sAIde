/**
 * 사용자가 올린 파일에서 뽑은 글자 (기안 코파일럿 · 내 참고자료).
 *
 * ★ 글자만 이어 붙이지 않고 **덩어리(Block)** 로 남긴다.
 *   공문 원문은 "1. → 가. → (1)" 개조식과 표가 뼈대다. 한 줄로 이어 붙이면 모델이
 *   어느 문장이 어느 항목의 하위인지, 표의 어느 칸이 어느 열인지 잃는다.
 *   덩어리에는 쪽·표·행 위치도 붙여, 분석 결과의 근거가 원문 어디에 있는지 보여 준다.
 */

export type FileFormat = 'pdf' | 'hwpx' | 'docx' | 'xlsx' | 'text';

export type BlockKind = 'heading' | 'para' | 'list' | 'table-row';

export interface Block {
  kind: BlockKind;
  text: string;
  /** 개조식 단계(1. = 1, 가. = 2, (1) = 3 …). 제목·일반 문단은 없다. */
  level?: number;
  /** PDF 쪽 번호(1부터). */
  page?: number;
  /** 문서 안 표 순번(1부터). 엑셀은 시트 순번. */
  table?: number;
  /** 표 안 행 번호(1부터). */
  row?: number;
  /** 엑셀 시트 이름. */
  sheet?: string;
}

export interface ExtractedFile {
  format: FileFormat;
  /** 모델과 사람이 읽는 전체 글자. 덩어리를 순서대로 이은 것이다. */
  text: string;
  blocks: Block[];
  /** PDF 전체 쪽수. */
  pages?: number;
  /** 잘림·스캔 PDF 의심 등 사용자에게 알려야 할 사항. */
  warnings: string[];
}

/** 추출 실패. 사용자에게 그대로 보여 줄 문장을 담는다. */
export class FileExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileExtractError';
  }
}
