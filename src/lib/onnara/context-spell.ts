/**
 * 문맥 혼동어 교정 모듈 (규칙 기반, LLM 없음).
 *
 * "효율성 재고"처럼 낱말 자체는 맞지만 문맥에 맞지 않는 말(동음·유사어 오용)은
 * 소형 로컬 LLM이 "틀리지 않은 낱말"로 보고 자주 놓친다. 이런 오류는 앞뒤 말을 보면
 * 거의 확실하게 판정되므로, 문맥 단서가 분명한 경우만 규칙으로 고친다.
 *
 *  - 정밀도 우선: 오탐이 날 수 있는 쌍은 넣지 않거나 단서를 좁힌다.
 *  - 고친 결과는 기존 교정 diff에 그대로 나타나므로 사용자가 × 버튼으로 제외할 수 있다.
 *  - 규칙은 멱등이다(고친 글에 다시 적용해도 바뀌지 않는다).
 *
 * 새 혼동어는 CONTEXT_RULES에 한 항목씩 추가하고 context-spell.test.ts에 예문을 붙인다.
 */

export interface ContextRule {
  id: string;
  /** g 플래그 필수. 고칠 낱말만 매치하고, 문맥 단서는 앞뒤 둘러보기((?<=…) (?=…) (?!…))로 건다. */
  pattern: RegExp;
  /** 바꿀 말. 함수면 매치 문자열을 받아 바꿀 말을 돌려준다(같으면 고치지 않음). */
  to: string | ((match: string) => string);
  /** 사용자·개발자용 설명 */
  reason: string;
}

export interface ContextFix {
  ruleId: string;
  index: number;
  from: string;
  to: string;
  reason: string;
}

/** 한글 음절의 받침 번호(0: 받침 없음, 4: ㄴ). 한글 음절이 아니면 -1. */
function jongseong(ch: string): number {
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return -1;
  return code % 28;
}

/** "효율성 제고"의 앞말: 높이거나 끌어올리는 대상이 되는 명사 */
const RAISE_TARGETS =
  '효율성|효율|생산성|경쟁력|만족도|인지도|신뢰도|신뢰성|전문성|품질|위상|사기|역량|가치|이미지|효과성|효과|청렴도|청렴성|투명성|접근성|편의성|실효성|공정성|능률|수준|참여율|참여도|활용도|인식|이해도|안전성|책임성|대응력|경쟁성|자긍심|업무능력|행정능력';

export const CONTEXT_RULES: ContextRule[] = [
  {
    id: 'jego',
    pattern: new RegExp(`(?<=(?:${RAISE_TARGETS})(?:의|을|를)?\\s?)재고(?!\\s?(?:관리|조사|량|품|자산|현황|파악|물품|정리|실사|확인))`, 'g'),
    to: '제고',
    reason: "'높인다'는 뜻은 제고(提高)입니다. 재고(再考)는 '다시 생각함', 재고(在庫)는 '창고에 쌓인 물건'입니다.",
  },
  {
    id: 'jego-inventory',
    pattern: /제고(?=\s?(?:관리|조사|량|품|자산|현황|파악|물품|실사))/g,
    to: '재고',
    reason: "창고에 쌓인 물건은 재고(在庫)입니다.",
  },
  {
    id: 'gyeoljae',
    pattern: /(?<=(?:기안|문서|부서장|기관장|과장|국장|팀장|실장|부장|상급자|상사|대표|위임|전자문서)(?:의|을|를)?\s?)결제|결제(?=권자|라인|선(?:을|에|이|\s|$)|\s?(?:를|을)?\s?(?:받|올리|올려|득하))/g,
    to: '결재',
    reason: "문서를 승인하는 것은 결재(決裁)입니다. 결제(決濟)는 대금을 치르는 것입니다.",
  },
  {
    id: 'gyeolje',
    pattern: /(?<=(?:카드|대금|요금|비용|현금|계좌|간편|신용카드|금액|물품대금|공과금)(?:의|을|를)?\s?)결재/g,
    to: '결제',
    reason: "대금을 치르는 것은 결제(決濟)입니다. 결재(決裁)는 문서를 승인하는 것입니다.",
  },
  {
    id: 'roseo',
    pattern: /(?<=(?:담당자|책임자|관리자|공무원|위원|기관|부처|주무부처|단체|부서|주체|대표|입장|일원|당사자|기관장|지자체)(?:으)?)로써/g,
    to: '로서',
    reason: "자격·지위를 나타낼 때는 '로서'입니다. '로써'는 수단·도구를 나타냅니다.",
  },
  {
    id: 'rosseo',
    pattern: /(?<=(?:수단|도구)으)로서/g,
    to: '로써',
    reason: "수단·도구를 나타낼 때는 '로써'입니다.",
  },
  {
    id: 'iljeol',
    pattern: /일체(?=\s?(?:금지|불허|허용하지|하지\s?않|없|않|불가|금함))/g,
    to: '일절',
    reason: "'전혀, 아주'의 뜻으로 부정·금지와 어울릴 때는 일절입니다. 일체는 '모든 것'입니다.",
  },
  {
    id: 'bugwa',
    pattern: /(?<=(?:과태료|세금|벌금|가산세|부담금|과징금|이행강제금|변상금|가산금)(?:을|를|이|가)?\s?)부가(?=하|된|되|할|함|\s|$|[,.)])/g,
    to: '부과',
    reason: "세금·과태료 등을 매기는 것은 부과(賦課)입니다.",
  },
  {
    id: 'jejeong',
    pattern: /(?<=(?:법률|법령|조례|규칙|지침|훈령|예규|고시|규정)(?:을|를|이|의)?\s?)재정(?=하|된|되|안(?:을|이|\s|$)|·|\s?(?:및|과)\s?개정)/g,
    to: '제정',
    reason: "법령·규정을 새로 만드는 것은 제정(制定)입니다.",
  },
  {
    id: 'jechul',
    pattern: /재출(?=하|해|된|되|할|함|기한|서류|요청|자료|기간|일|\s?바랍)/g,
    to: '제출',
    reason: "서류·의견을 내는 것은 제출(提出)입니다.",
  },
  {
    id: 'jesi',
    pattern: /(?<=(?:의견|방안|대안|기준|근거|자료|방향|대책|해결책|개선안)(?:을|를|이|가)?\s?)재시(?=하|해|된|되|할|함|\s|$|[,.)])/g,
    to: '제시',
    reason: "의견·방안을 내보이는 것은 제시(提示)입니다.",
  },
  {
    id: 'jegong',
    pattern: /재공(?=하|해|된|되|할|함|받)/g,
    to: '제공',
    reason: "주는 것은 제공(提供)입니다.",
  },
  {
    id: 'gejae',
    pattern: /개제(?=하|해|된|되|할|함|를|를\s?요청|\s?요청|\s?예정)/g,
    to: '게재',
    reason: "홈페이지·신문 등에 싣는 것은 게재(揭載)입니다.",
  },
  // ── 문맥과 관계없이 늘 틀린 표기 ──
  { id: 'geumse', pattern: /금새/g, to: '금세', reason: "'금시에'의 준말은 금세입니다." },
  { id: 'myeochil', pattern: /몇\s?일(?=간|동안|후|전|째|까지|부터|만|씩|이나|이면|이|은|에|로|\s|$|[,.)?])/g, to: '며칠', reason: "날짜를 묻는 말은 며칠입니다." },
  { id: 'yeokhal', pattern: /역활/g, to: '역할', reason: '역할(役割)이 맞습니다.' },
  { id: 'chujin', pattern: /추친/g, to: '추진', reason: '추진(推進)이 맞습니다.' },
  { id: 'dwaet', pattern: /됬/g, to: '됐', reason: "'되었'의 준말은 됐입니다." },
  { id: 'wenman', pattern: /왠만/g, to: '웬만', reason: '웬만하다가 맞습니다.' },
  { id: 'waenji', pattern: /웬지/g, to: '왠지', reason: "'왜인지'의 준말은 왠지입니다." },
  { id: 'huihan', pattern: /희안/g, to: '희한', reason: '희한(稀罕)이 맞습니다.' },
  { id: 'gonhok', pattern: /곤욕스러/g, to: '곤혹스러', reason: "'난처하다'는 곤혹스럽다입니다." },
  // ── 율/률: 모음·ㄴ 받침 뒤는 '율', 그 밖의 받침 뒤는 '률' ──
  {
    id: 'yul-ryul',
    pattern: /[가-힣](?:율|률)/g,
    to: (m) => {
      const j = jongseong(m[0]!);
      const want = j === 0 || j === 4 ? '율' : '률';
      return m[0] + want;
    },
    reason: "모음이나 ㄴ 받침 뒤에서는 '율'(참여율·할인율), 그 밖의 받침 뒤에서는 '률'(합격률·사망률)로 적습니다.",
  },
];

/** 원문에서 문맥 혼동어를 찾는다(겹치는 매치는 먼저 나온 것만). */
export function findContextFixes(text: string, rules: ContextRule[] = CONTEXT_RULES): ContextFix[] {
  const fixes: ContextFix[] = [];
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    for (const m of text.matchAll(rule.pattern)) {
      const from = m[0];
      const to = typeof rule.to === 'function' ? rule.to(from) : rule.to;
      if (to === from) continue;
      fixes.push({ ruleId: rule.id, index: m.index!, from, to, reason: rule.reason });
    }
  }
  fixes.sort((a, b) => a.index - b.index);
  const result: ContextFix[] = [];
  let end = -1;
  for (const f of fixes) {
    if (f.index < end) continue;
    result.push(f);
    end = f.index + f.from.length;
  }
  return result;
}

/** 문맥 혼동어를 고친 글을 돌려준다. */
export function applyContextFixes(text: string, rules: ContextRule[] = CONTEXT_RULES): string {
  const fixes = findContextFixes(text, rules);
  if (fixes.length === 0) return text;
  let out = '';
  let pos = 0;
  for (const f of fixes) {
    out += text.slice(pos, f.index) + f.to;
    pos = f.index + f.from.length;
  }
  return out + text.slice(pos);
}
