/**
 * 온나라 기안기 화면과 사이드카 드로어 간의 레이아웃 분할 및 여유 공간 관리 모듈.
 *
 * 본 화면(온나라 기안기)의 우측 끝에 위치한 버튼들([임시저장], [인쇄], [추가], [삭제] 등)과
 * 스크롤바가 사이드카에 가려지지 않도록 안전 여유 공간(Gap)을 확보하고 나란히(Side-by-Side) 배치합니다.
 */

/**
 * 온나라 기안기 화면과 사이드카 드로어 간의 기본 안전 여유 간격 (px).
 *
 * 사용자의 요청에 따라 추가로 1/4을 축소하여 9px 간격을 적용합니다.
 * 본 화면과 사이드카 간의 겹침을 방지하면서도 더욱 슬림하고 콤팩트한 뷰를 제공합니다.
 */
export const DRAWER_GAP_PX = 9;

export interface DrawerLayoutStyles {
  marginRight: string;
  width: string;
  maxWidth: string;
  boxSizing: string;
  overflowX?: string;
}

/**
 * 드로어 열림 상태 및 너비에 따른 온나라 본 화면 스타일 계산.
 * 100vw 대신 calc(100% - totalOffset)을 사용하여 윈도우 스크롤바 폭으로 인한 우측 밀림 현상을 원천 방지합니다.
 */
export function computeDrawerLayoutStyles(
  open: boolean,
  drawerWidth: number,
  gap = DRAWER_GAP_PX
): {
  docEl: DrawerLayoutStyles;
  body: DrawerLayoutStyles;
  totalOffset: number;
} {
  const totalOffset = Math.max(0, drawerWidth + gap);

  if (!open) {
    return {
      docEl: { marginRight: '', width: '', maxWidth: '', boxSizing: '', overflowX: '' },
      body: { marginRight: '', width: '', maxWidth: '', boxSizing: '', overflowX: '' },
      totalOffset: 0,
    };
  }

  return {
    docEl: {
      marginRight: `${totalOffset}px`,
      width: `calc(100% - ${totalOffset}px)`,
      maxWidth: `calc(100% - ${totalOffset}px)`,
      boxSizing: 'border-box',
      overflowX: 'auto',
    },
    body: {
      marginRight: '0px',
      width: '100%',
      maxWidth: '100%',
      boxSizing: 'border-box',
      overflowX: 'auto',
    },
    totalOffset,
  };
}

/**
 * 온나라 기안기 문서(documentElement 및 body)에 레이아웃 여백을 실시간 적용하거나 복원합니다.
 */
export function applyPageLayoutShift(
  open: boolean,
  drawerWidth: number,
  gap = DRAWER_GAP_PX,
  doc: Document = document
): number {
  try {
    const docEl = doc.documentElement;
    const body = doc.body;
    const { docEl: docStyles, body: bodyStyles, totalOffset } = computeDrawerLayoutStyles(open, drawerWidth, gap);

    if (open) {
      docEl.style.setProperty('--saide-drawer-width', `${drawerWidth}px`);
      docEl.style.setProperty('--saide-drawer-gap', `${gap}px`);
      docEl.style.setProperty('--saide-drawer-offset', `${totalOffset}px`);
      docEl.style.transition = 'margin-right 0.24s cubic-bezier(0.16, 1, 0.3, 1), width 0.24s cubic-bezier(0.16, 1, 0.3, 1), max-width 0.24s cubic-bezier(0.16, 1, 0.3, 1)';
      docEl.style.boxSizing = docStyles.boxSizing;
      docEl.style.marginRight = docStyles.marginRight;
      docEl.style.width = docStyles.width;
      docEl.style.maxWidth = docStyles.maxWidth;
      if (docStyles.overflowX) {
        docEl.style.overflowX = docStyles.overflowX;
      }

      if (body) {
        body.style.boxSizing = bodyStyles.boxSizing;
        body.style.marginRight = bodyStyles.marginRight;
        body.style.maxWidth = bodyStyles.maxWidth;
        if (bodyStyles.overflowX) {
          body.style.overflowX = bodyStyles.overflowX;
        }
      }
    } else {
      docEl.style.removeProperty('--saide-drawer-width');
      docEl.style.removeProperty('--saide-drawer-gap');
      docEl.style.removeProperty('--saide-drawer-offset');
      docEl.style.marginRight = '';
      docEl.style.width = '';
      docEl.style.maxWidth = '';
      docEl.style.boxSizing = '';
      docEl.style.transition = '';
      docEl.style.overflowX = '';

      if (body) {
        body.style.boxSizing = '';
        body.style.marginRight = '';
        body.style.maxWidth = '';
        body.style.overflowX = '';
      }
    }
    return totalOffset;
  } catch {
    return 0;
  }
}
