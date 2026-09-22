# onNara.sAIde 최종 구축 계획서

작성: 2026-09-17 · 갱신: 2026-09-22 · 상태: 구축 진행 중 (0~2단계 완료, 3단계 핵심 MVP 완료, 진단 보완 B1~B5·B9, N1 공유/공람 브리핑, 데이터 백업·복원 및 본문 다운로드 완료 · 78파일 885개 테스트 통과) · 대상 브라우저: Microsoft Edge (Chromium MV3)
현재 구현 사실은 [구현 현황](../docs/IMPLEMENTATION_STATUS.md)이 기준이다. 이 계획서의 단계표는 목표를 담는다.
근거 자료: [참조 프로젝트 분석 및 서비스 제안](../docs/reference-analysis-and-ideas.md) · 현황: [구현 현황](../docs/IMPLEMENTATION_STATUS.md)

온나라 2.0 화면 오른쪽 Edge Side Panel에서 **현재 온나라 문서의 맥락을 이해하고 읽기·검색·작성·업무처리를 돕는 AI 업무 도우미**를 만든다. 추론은 **내 PC의 로컬 LLM(Ollama)** 과 **범정부 AI 공통기반 LLM(API 키)** 중 사용자가 화면에서 고른다.

---

## 0. 최종 통합 원칙

### 0.1 세 계획서에서 채택한 사항

| # | 최종 반영 내용 | 위치 |
|---|---|---|
| R1 | URL 대신 **온나라 문서 정체성**(기관·문서 ID·본문 revision)으로 저장·실행 단위를 나눔. 문서 ID 미확인 시 임시 맥락, 계정·부서 전환 시 재검증 | §4 신설, 2단계 P2-3 |
| R2 | HTML 복제 대신 typed 상태 메시지 + 프레임 로드·DOM 변경 이벤트 + 보조 폴링. 다른 출처 iframe은 별도 처리 | §4.4, P2-2 |
| R3 | **본문 획득을 단계화**: 선택·붙여넣기·텍스트 파일로 기능 품질을 먼저 확인 → 본문 DOM → HWPX·PDF → 필요 시 로컬 보조 프로세스 | §5 신설, 2·3·5단계 |
| R4 | 파일명 읽기·파일 획득·내용 추출·편집기 쓰기는 서로 다른 능력. 비전 ≠ 전체 OCR. 캡처는 "보이는 영역만" 범위 표시 | §5.2 능력 표, 디자인 `CoverageChip` |
| R5 | 개인 열람 기억과 현행 업무분장·내부 지침·확정 처리사례를 **별도 컬렉션**으로 관리. 판본·적용일·출처·삭제 정책, 검색 전 범위 필터 | §7 신설 |
| R6 | **키워드(문서번호·기관명·사업명·연도) + BGE 벡터 결합 검색**, 현행 우선, 폐지 지침 인용 금지, 점수를 확률로 표시하지 않음 | §7.3 |
| R7 | 역할 분리(Gemma = 요약·추출·초안, BGE = 검색, 코드 = ID·수치·날짜·권한·상태·DOM), 스키마에 `미확인` 허용, 형식 준수 ≠ 내용 정확 | §3.2, §6.6 |
| R8 | 대화·구조화·임베딩을 **공통 작업 큐**로 조정 | §6.7, P1-A9 |
| R9 | 배부기 28초 제한은 원격 API용. 로컬 모델 로딩·생성 지연에 맞춰 재설계 | §6.5 시간 제한 표 |
| R10 | 로컬 모델에서 배부 신뢰도 60/85 임계값 유지 가정 금지 → 감사기록으로 재보정 | S03, 6단계 P6-7 |
| R11 | 외부 fallback 여부를 코드로 관리. 로컬 저장도 공문 사본이므로 범위·보관·삭제·**내보내기** 제공 | §6.8, §8.2 |
| R12 | 읽기·초안·준비·온나라 반영·실제 완료를 **서로 다른 상태**로 표현. 전면 자동 접수는 초기 필수 아님 | §8.1, S03 범위 |
| R13 | 대표 경험을 **공문 이해 → 사례 확인 → 회신 작성**으로 설정 | §1.2, 3·4단계 순서 |
| R14 | 신규 서비스: 유사 공문·처리사례 검색, 변경 공문 비교, 주간 업무보고 초안, 업무 인수인계 노트 | §10 서비스 목록 S05·S10·S11·S12 |
| R15 | 초기 화면: 상단 기관/과·화면·대상 문서·읽은 범위, 탭 `현재 문서 / 작성 / 지식 검색 / 내 업무`, 모든 결과에 출처·읽지 못한 범위 | §9.4 |
| R16 | 확인 목록: 대상 사용자, 파일 형식·분량·문서 수·GPU, 지식자료 반입·갱신, 정확도·대기시간 목표, Edge 탭 전환 이슈 | 0단계 P0-2·P0-7, §12 |
| R17 | 이 PC 확인값: Gemma `/api/show` = completion·vision·audio·tools·thinking, BGE = embedding, 배부기 Node 테스트 34개 통과 | §2 환경 기준 |

### 0.2 유지한 기반

- `.env` 기본값 + 화면 선택 LLM 구성, Ollama·범정부 공급자 추상화, API 키 보안 규칙, 외부 전송 게이트
- 행정 블루 디자인 시스템(색 대비 실측값 포함)
- sAIde 기반 + 배부기 온나라 어댑터 이식, fail-closed·온나라 API 비호출 원칙

### 0.3 조정한 사항

| 검토 내용 | 판단 |
|---|---|
| "추론을 로컬로 제한" 방향 | 사용자 요구가 범정부 LLM 연결이므로 **로컬 전용 강제는 하지 않는다.** 대신 외부 자동 fallback 금지 + 명시 선택 + 전송 게이트로 같은 목적을 달성한다. 기관이 원하면 `.env`/정책으로 범정부 공급자를 끌 수 있다. |
| 브라우저 밖 알림은 별도 범위 | Edge 실행 중 OS 알림(`chrome.notifications`)은 포함한다. Edge 종료 상태 알림은 범위 밖으로 둔다. |
| 문서함 우선순위 브리핑 | 목록 DOM이 확인되어 구현 비용이 비교적 낮으므로 4단계에 유지한다. |

---

## 1. 제품 정의

### 1.1 목표

- 온나라 업무 화면을 떠나지 않고 공문을 **이해하고, 선례를 찾고, 답을 작성**한다.
- 온나라의 기존 절차를 대체하지 않고 보조한다. 실제 반영은 온나라의 기존 화면·버튼으로만, 사람이 확인한 뒤 수행한다.
- 모든 결과는 근거와 읽은 범위를 보여준다. 모르는 값은 `미확인`으로 남긴다.

### 1.2 대표 사용 흐름

```text
[현재 문서] 공문 핵심·조치사항 카드  →  [지식 검색] 유사 공문·처리사례  →  [작성] 회신 초안  →  온나라 기안기에 사람이 반영
      └ 제출기한·할 일은 [내 업무] 보드로 확인 후 등록
[접수대기함] 담당자 배부 추천 → 사람 확인 → 온나라 기존 일괄접수·담당지정
```

### 1.3 초기 대상 사용자(가설, 0단계에서 확정)

| 사용자 | 주 사용 서비스 | 비고 |
|---|---|---|
| 일반 실무자 | 공문 카드, 사례 검색, 회신 초안, 내 업무 | 대표 경험의 주 대상 |
| 문서배부 담당 | 배부 추천, 문서함 브리핑 | 배부기 사용자층 |
| 관리자(과장·팀장) | 결재 전 핵심 카드, 주간 보고 | 후순위 |

### 1.4 비범위(초기)

- 온나라 접수·결재·발송 endpoint 직접 호출
- 검증 없는 무인 자동 접수(자동확인 모드는 이식하지 않음, 6단계 이후 근거 확보 시 재검토)
- 외부 모델로의 **자동** fallback
- 온나라 기안기(HWP 편집기)에 직접 쓰기 — 복사·붙여넣기로 시작
- HWP 바이너리·스캔 PDF OCR — 5단계에서 로컬 보조 프로세스 필요성만 검토

---

## 2. 기준 환경 (2026-09-21 확인값)

| 항목 | 값 | 확인 출처 |
|---|---|---|
| Ollama | 0.34.1 (현재 실행값) | CLI·`/api/version` 재확인 |
| 생성 모델 | `gemma4:e2b` · 5.1B · 7.2GB · completion·vision·audio·tools·thinking | `/api/tags`, `/api/show` |
| 임베딩 모델 | `bge-m3:latest` · 1.2GB · embedding | `/api/tags`, `/api/show` |
| `OLLAMA_ORIGINS` | 현재 프로세스 `chrome-extension://*`; 배포 시 실제 확장 ID로 한정 | 프로세스 환경 변수 |
| onnara-saide 테스트 | Vitest 73파일·831개 전체 통과, `tsc --noEmit` 통과 | 2026-09-21 자동 테스트 |
| onnara-saide 빌드 | Edge MV3 프로덕션 빌드, verify 검증, WCAG AA 13쌍 통과 | 2026-09-21 빌드 검증 |
| 배부기 (참조) | Node 테스트 34개 통과 (README 표기 28개) | 참조 프로젝트 검토 자료 |
| 과거 CPU 실측 | prefill ~131 tok/s, decode ~21 tok/s, 콜드 로드 21.5초 | sAIde 문서(이 PC 재측정 필요) |

모델 capability 표시는 메타데이터다. 한국어 공문 정확도·OCR·처리 시간은 0단계 표본으로 실측한다.

---

## 3. 핵심 결정과 역할 분리

### 3.1 핵심 결정

| # | 결정 |
|---|---|
| D1 | `sAIde`를 복사해 새 프로젝트 `onnara-saide/`에서 시작한다. 참조 폴더는 수정하지 않는다. |
| D2 | 빌드 대상은 `wxt build -b edge`(Edge 116+). Edge Side Panel 탭 전환 이슈는 0단계에서 검증한다. |
| D3 | LLM은 공급자 추상화 위에 Ollama·범정부 AI 구현을 둔다. |
| D4 | 설정 우선순위는 기관 관리 정책 → 정책이 허용한 사용자 설정 → `.env` 빌드 기본값 → 코드 안전 기본값이다. |
| D5 | 온나라 연동은 온나라 호스트 전용 정적 콘텐츠 스크립트가 맡고, 결과는 typed 메시지로만 전달한다. |
| D6 | 저장·실행 단위는 URL이 아니라 **온나라 문서 정체성**이다. |
| D7 | 본문 입력은 `선택·붙여넣기·파일 → 본문 DOM → 첨부 파서` 순으로 확장하고, 기능은 입력 경로와 분리해 만든다. |
| D8 | 구조화 결과는 JSON 스키마 + 런타임 검증 + `미확인` 허용. 수치·날짜·ID·권한·상태 전이는 코드가 판정한다. |
| D9 | 외부 모델로 본문·첨부를 보낼 때 전송 정책 게이트를 통과해야 한다. 외부 자동 fallback은 없다. |
| D10 | 임베딩은 로컬 `bge-m3` 고정. 검색은 키워드 + 벡터 결합. |
| D11 | 로컬 LLM 호출은 공통 작업 큐로 직렬·우선순위 조정한다. |
| D12 | 업무 결과는 `읽음 → 초안 → 준비 → 반영 요청 → 완료 확인` 상태를 구분하고, 클릭 성공을 완료로 취급하지 않는다. |

### 3.2 역할 분리

| 담당 | 하는 일 | 하지 않는 일 |
|---|---|---|
| 생성 모델(Gemma·HCX 등) | 요약, 조치사항 추출, 초안, 근거 설명, 분류 후보 | ID 매핑, 수치·날짜 확정, 권한 판단, DOM 동작 |
| 임베딩(BGE-M3) | 문서·질의 벡터화, 유사 자료 검색 | 답변 생성, 정답 확률 표시 |
| 코드 | ID 매핑, 날짜·금액 검산, 후보·근거 검증, 권한·범위 필터, 상태 전이, 개인정보 탐지, 형식 규칙 | 문장 생성 |
| 온나라 어댑터 | 정해진 selector로 읽기, 기존 버튼 보조, 실제 결과 확인 | 모델이 만든 selector·절차 실행 |

---

## 4. 온나라 맥락과 문서 정체성

### 4.1 두 가지 키

```ts
/** 저장 단위: 결과·기억·업무 항목이 붙는 대상 */
interface DocumentKey {
  orgKey: string;          // 기관(온나라 origin + 기관 식별 가능 값)
  docId: string;           // 온나라 문서 ID (예: chkDocId, td_result_* suffix)
  idSource: 'list' | 'popup' | 'view' | 'manual';
  bodyRevision?: string;   // 본문 정규화 텍스트 해시. 본문 미확보 시 없음
}

/** 실행 단위: 지금 이 작업이 유효한 조건 */
interface RunContext {
  tabId: number;
  frameKey: string;        // 프레임 경로(_MAIN 등)
  sessionEpoch: number;    // 로그인·부서 전환 시 증가
  deptId: string;          // SELECTED_DUP_LOGIN_ID의 부서 ID(로그인 ID는 읽지 않음)
  screen: OnnaraScreen;    // 'waiting-list' | 'multi-accept' | 'path-view' | 'approval-list' | 'circulation-list' | 'document-view' | 'draft-editor' | 'unknown'
  selectionRevision?: string; // 선택 문서 ID 집합 해시
}
```

### 4.2 규칙

- 결과는 `DocumentKey`에 저장하고, 화면 표시는 현재 `RunContext`와 맞는 경우에만 한다.
- 문서 ID를 확정하지 못한 입력(붙여넣기·선택 텍스트)은 **임시 맥락**으로 표시하고 확정 문서 기억에 합치지 않는다. 사용자가 문서를 지정하면 `idSource: 'manual'`로 연결한다.
- `bodyRevision`이 바뀌면 이전 요약·추출 결과는 `이전 판본` 표시 후 재실행을 제안한다.
- 로그인 계정·부서가 바뀌면 `sessionEpoch`를 올리고 진행 중 작업·캐시·배부 준비를 무효화한다.
- sAIde의 URL 기반 대화 분리·같은 URL 첨부 유지·URL별 기억 덮어쓰기는 온나라 탭에서 사용하지 않는다(일반 웹 탭은 기존 동작 유지).

### 4.3 `OnnaraContext` 메시지

```ts
interface OnnaraContext {
  run: RunContext;
  org: { deptName: string };
  documents: Array<{ key: DocumentKey; title: string; senderDept?: string; kind?: string; flags: { auto: boolean; encrypted: boolean; disabled: boolean } }>;
  focusDocument?: DocumentKey;           // 본문보기 등 단일 문서 화면
  coverage: { readable: 'full' | 'partial' | 'metadata-only' | 'none'; unreadableFrames: number; note?: string };
  updatedAt: number;
}
```

### 4.4 변경 감지

- 프레임 `load` 이벤트, 목록 영역 `MutationObserver`, 1.5초 보조 폴링(배부기 주기)을 함께 쓴다. 지문이 바뀔 때만 푸시한다.
- 다른 출처 iframe을 발견하면 `coverage.unreadableFrames`를 올리고 패널에 "읽을 수 없는 영역 있음"을 표시한다.
- 패널 HTML은 콘텐츠 스크립트가 만들지 않는다.

---

## 5. 입력 획득 계층

### 5.1 단계

| 단계 | 입력 | 도입 시점 | 목적 |
|---|---|---|---|
| I1 | 선택 텍스트, 붙여넣기, `.txt`/`.md` 파일 | 2단계 | 온나라 DOM 없이 서비스 품질부터 검증 |
| I2 | 온나라 본문보기·문서관리카드 DOM | 3단계(0단계 fixture 확보 후) | 자동 본문 읽기 |
| I3 | HWPX(ZIP+XML)·텍스트 PDF 파서, 표·문단·페이지 출처 보존 | 5단계 | 첨부 읽기 |
| I4 | HWP 바이너리·스캔 PDF → 로컬 보조 프로세스(Native Messaging) 검토 | 5단계 결정 | 확장 안 처리 불가 영역 |
| 보조 | 화면 캡처 + 비전 | 3단계 | 추출 실패 시 대안. 항상 "보이는 영역만" 표시 |

모든 서비스는 입력을 `SourceText { key?: DocumentKey; origin: 'selection'|'paste'|'file'|'dom'|'attachment'|'capture'; text; anchors; coverage }`로만 받는다. 입력 경로가 늘어나도 서비스 코드는 바뀌지 않는다.

### 5.2 능력 구분표

| 능력 | 초기 | 비고 |
|---|---|---|
| 첨부 **파일명** 읽기 | 3단계 | 목록·문서관리카드 DOM |
| 첨부 **파일 획득** | 5단계 | 다운로드 경로·세션 확인 필요 |
| 첨부 **내용 추출** | 5단계 | HWPX·PDF 우선 |
| 온나라 **편집기에 쓰기** | 범위 밖(복사) | 기안기 DOM 확인 후 승인형으로만 재검토 |
| 화면 **캡처 해석** | 3단계 | 전체 OCR 아님, 범위 표시 |

---

## 6. LLM 설정 설계 (.env + 화면 선택)

### 6.1 `.env.example`

WXT(Vite)는 `WXT_`·`VITE_` 접두사만 번들에 노출한다(`node_modules/wxt/dist/core/builders/vite/index.mjs`의 `envPrefix`).

```dotenv
# ── 공통 ─────────────────────────────────────────
WXT_LLM_PROVIDERS=ollama,govai           # 사용할 공급자(순서 = 화면 표시 순서)
WXT_LLM_DEFAULT_PROVIDER=ollama
WXT_LLM_DEFAULT_MODEL=gemma4:e2b

# ── 내 PC · Ollama ──────────────────────────────
WXT_OLLAMA_ENDPOINT=http://localhost:11434
WXT_OLLAMA_MODELS=                       # 비우면 /api/tags 자동 탐색, 값이 있으면 허용 목록
WXT_OLLAMA_EMBED_MODEL=bge-m3
WXT_OLLAMA_NUM_CTX=4096
WXT_OLLAMA_KEEP_ALIVE=10m
WXT_OLLAMA_IDLE_TIMEOUT_MS=180000        # 바이트 무수신 제한
WXT_OLLAMA_FIRST_TOKEN_TIMEOUT_MS=90000  # 콜드 로드 포함 첫 토큰 제한

# ── 범정부 AI 공통기반 ───────────────────────────
WXT_GOVAI_ENABLED=true
WXT_GOVAI_CHAT_ENDPOINT=https://api.clovastudio.go.kr/api/v1/chat/completions
WXT_GOVAI_RAG_ENDPOINT=https://api.clovastudio.go.kr/v1/rag42/search
WXT_GOVAI_RAG_COLLECTIONS_ENDPOINT=https://api.clovastudio.go.kr/v1/rag42/collections
WXT_GOVAI_MODELS=HCX-GOV-THINK-V1-32B,LLM42-Gemma4,K-Exaone-236B,openai/gpt-oss-120b
WXT_GOVAI_DEFAULT_MODEL=HCX-GOV-THINK-V1-32B
WXT_GOVAI_TIMEOUT_MS=60000               # 한 요청 전체 제한(패널 문서에서 호출)
WXT_GOVAI_API_KEY=                       # 개발 PC 전용(.env.local). 배포 빌드에서 값이 있으면 빌드 실패

# ── 서비스별 기본 모델(선택) ────────────────────────
WXT_FEATURE_MODEL_DOC_CARD=ollama:gemma4:e2b
WXT_FEATURE_MODEL_DISTRIBUTION=ollama:gemma4:e2b
WXT_FEATURE_MODEL_DRAFT=ollama:gemma4:e2b
WXT_FEATURE_MODEL_REVIEW=ollama:gemma4:e2b
WXT_FEATURE_MODEL_KNOWLEDGE=ollama:gemma4:e2b

# ── 온나라 · 정책 ────────────────────────────────
WXT_ONNARA_ORIGIN=https://onnara2.saas.gcloud.go.kr
WXT_EGRESS_BODY_TO_EXTERNAL=ask          # deny | ask | allow : 외부 모델로 본문·첨부 전송
WXT_LOCAL_STORE_BODY=opt-in              # off | opt-in | on : 본문·청크 로컬 저장
WXT_LOCAL_RETENTION_DAYS=90
```

- 모델 참조 `공급자:모델`은 첫 번째 `:`까지만 공급자로 해석한다(`ollama:gemma4:e2b`).
- `wxt.config.ts`는 `loadEnv`로 같은 값을 읽어 `host_permissions`와 온나라 `content_scripts.matches`를 생성한다.
- `env.ts`는 URL 스킴·enum·범위를 검증하고, 잘못된 값은 안전 기본값 + 설정 화면 경고로 처리한다.

### 6.2 값의 우선순위

```text
① 기관 관리 정책(chrome.storage.managed · Edge 정책)
② 사용자 설정(기관 정책이 허용한 범위, chrome.storage.local)
③ .env 빌드 기본값
④ 코드 내장 안전 기본값
```

설정 항목마다 출처 배지(`환경설정 기본값` / `사용자 지정` / `기관 정책`)를 표시한다. `기본값으로 되돌리기`는 사용자 설정만 지운다. 기관 정책 항목은 잠그며 사용자가 우회할 수 없다.

#### 엔드포인트와 확장 권한

- 온나라 origin과 기관 범정부 endpoint는 빌드 manifest의 `host_permissions`에 고정한다.
- Ollama는 `localhost`와 `127.0.0.1`만 기본 허용한다.
- 초기 출시에서는 사용자가 임의의 새 endpoint를 추가하지 못한다. 추후 제공할 경우 기관 정책의 허용 목록, HTTPS 조건, 사용자의 명시적 `optional_host_permissions` 승인을 모두 요구한다.
- manifest에 없는 endpoint는 설정에 남아 있어도 호출하지 않고 필요한 권한을 안내한다.
- 외부 API가 확장 origin을 거부하면 내부 게이트웨이 또는 제공자 측 허용 정책으로 해결한다. `Origin` 헤더 제거는 요청 initiator를 바꾸지 못해 CORS 검증을 깨뜨릴 수 있으므로 배포 대안으로 사용하지 않는다.

### 6.3 API 키 보안

`.env` 값은 빌드 시 JS 번들에 평문으로 들어간다.

| 상황 | 키 입력 |
|---|---|
| 개발 PC | unpacked 개발 빌드에 한해 `.env.local`의 `WXT_GOVAI_API_KEY` 허용. 번들에 노출됨을 전제로 사용 |
| 배포 | `.env` 키는 비움. 설정 화면 입력 → `chrome.storage.local`(`TRUSTED_CONTEXTS`), 저장 후 재표시 안 함 |
| 운영 권장 | 내부 게이트웨이를 엔드포인트로 지정, 키는 게이트웨이 보관 |

- `chrome.storage.local`의 `TRUSTED_CONTEXTS`는 content script 접근을 줄일 뿐 OS 계정·브라우저 프로필 접근으로부터 키를 보호하는 비밀 저장소가 아니다.
- `verify-build.mjs`: production 빌드 전에 노출 접두사의 키 변수가 설정되어 있으면 실패. exact 개발 키의 번들 포함 여부도 보조 확인한다. 패턴 검색만으로 키 부재를 증명했다고 주장하지 않는다.
- 키는 범정부 호스트 요청 헤더에만 싣고 로그·오류·감사기록·내보내기에서 제거한다.

### 6.4 공급자 인터페이스

```ts
type ProviderId = 'ollama' | 'govai';
type Locality = 'local' | 'external';

interface ModelDescriptor {
  ref: { provider: ProviderId; model: string };
  label: string;
  locality: Locality;
  capabilities: { streaming: boolean; jsonSchema: boolean; tools: boolean; vision: boolean; thinking: boolean };
  contextWindow?: number;
  digest?: string;                 // Ollama 모델 digest(같은 태그 교체 감지)
  source: 'env' | 'discovered' | 'user';
}

interface LlmProvider {
  id: ProviderId;
  locality: Locality;
  health(signal?: AbortSignal): Promise<ProviderHealth>;   // ok | cold | key-missing | unauthorized | down | cors-blocked
  listModels(signal?: AbortSignal): Promise<ModelDescriptor[]>;
  chat(req: LlmChatRequest, signal?: AbortSignal): AsyncIterable<ChatDelta>;
  structured<T>(req: LlmChatRequest, schema: JsonSchema, validate: (v: unknown) => T, signal?: AbortSignal): Promise<T>;
  embed?(input: string[], signal?: AbortSignal): Promise<number[][]>;
}
```

| 항목 | Ollama | 범정부 AI 공통기반 |
|---|---|---|
| 모델 목록 | `/api/tags` + `/api/show`(capability·digest) | `.env` 목록(목록 API 확인 시 자동 탐색) |
| 인증 | 없음(localhost, `OLLAMA_ORIGINS`) | `Authorization: Bearer` |
| 스트림 | NDJSON(기존 `stream.ts`) | SSE 지원 여부 0단계 확인, 미지원 시 비스트림 + 진행 표시 |
| 구조화 출력 | `format: <JSON schema>` | 지정 함수 강제 호출, 실패 시 content JSON 보조 파싱 |
| 모델별 옵션 | `think`, `keep_alive`, `num_ctx` | HCX `thinking:false`, Gemma4·K-Exaone·Nemotron `enable_thinking:false`, gpt-oss `reasoning_effort:low` |
| 성공 판정 | HTTP 2xx + NDJSON `done` | HTTP 2xx + `status.code === "20000"` |
| 재시도 | 없음 | 429·500·502·503·504·네트워크만 지수 백오프 최대 3회 |
| 응답 정리 | thinking 재투입 금지 | `reasoning`·`reasoning_content` 폐기 |

### 6.5 시간 제한 재설계

배부기의 25초/28초는 MV3 워커 응답 수명에 맞춘 원격 호출 값이다. 본 설계는 LLM을 패널 문서에서 호출하므로 공급자·단계별로 나눈다.

| 구간 | Ollama | 범정부 |
|---|---|---|
| 연결·health | 3초 | 5초 |
| 첫 토큰(콜드 로드 포함) | 90초(`FIRST_TOKEN`) | — |
| 스트림 무수신 | 180초(`IDLE`) | 60초 |
| 요청 전체 | 없음(사용자 취소) | 60초(`GOVAI_TIMEOUT`) |
| 임베딩 1배치 | 180초 | 해당 없음 |

UI는 경과 시간과 단계(모델 로드 중·읽는 중·작성 중)를 표시하고 언제든 취소할 수 있다.

### 6.6 구조화 결과 규칙

- 서비스마다 JSON 스키마와 런타임 검증 함수를 둔다. 필드는 값 또는 `{"status":"unknown"}`을 허용한다.
- 날짜·금액·문서번호는 원문 anchor와 코드로 대조해 원문에 없으면 `미확인`으로 강등한다.
- 스키마 검증 실패 시 1회 재요청, 다시 실패하면 오류 카드(원문 응답은 표시하지 않음).
- 형식 준수는 내용 정확성을 보장하지 않으므로 모든 카드에 근거 anchor를 붙인다.

### 6.7 공통 작업 큐

```text
LlmJobQueue(공급자별)
  ├ 우선순위: interactive(대화·카드) > batch(목록 분류·배부) > background(임베딩·재색인)
  ├ Ollama: 동시 1건. 임베딩은 keep_alive:"0"으로 생성 모델 상주를 방해하지 않음
  ├ 범정부: 동시 2건, 429 시 백오프
  ├ 취소: 작업 단위 AbortSignal, 늦게 온 결과는 소유권 검사 후 폐기(sAIde R05 재사용)
  └ 영속: background 작업(적재·재색인)은 IndexedDB에 기록, 패널을 다시 열면 멱등 재개
```

### 6.8 모델 선택 화면과 전송 게이트

**패널 헤더 모델 칩**

```text
┌───────────────────────────────────────────────┐
│ 온나라 sAIde                ● gemma4:e2b ▾  ⚙ │
│                               내 PC 처리      │
└───────────────────────────────────────────────┘
        ▼
┌──────────────────────────────┐
│ 내 PC · Ollama        연결됨 │
│  ◉ gemma4:e2b   상주 · 6.7GB │
│ 범정부 AI 공통기반   키 필요 │
│  ○ HCX-GOV-THINK-V1-32B ↗외부│
│  ○ LLM42-Gemma4         ↗외부│
│ ──────────────────────────── │
│  AI 연결 설정 열기           │
└──────────────────────────────┘
```

- 그룹별 상태와 `내 PC 처리` / `외부 전송` 배지. 답변마다 사용 모델·처리 위치·소요 시간 기록.
- 설정 → `AI 연결` 탭: 공급자 카드(사용 토글·허용된 엔드포인트와 출처·API 키·연결 테스트·모델 목록·capability 표), 서비스별 기본 모델. 초기 출시의 엔드포인트는 읽기 전용이며 임베딩은 로컬 고정으로 표시한다.

**전송 게이트**

```text
실행 → router.resolve(service) → 외부 모델인가?
  └ 아니오 → 큐 등록
  └ 예 → 페이로드 분류(메타데이터/본문/첨부/조직 명단) → pii.scan
       → deny: 본문·첨부 포함 시 차단 + "내 PC 모델로 실행"
       → ask : 전송 항목·개인정보 탐지 결과 확인 창(기본 포커스 = 취소)
       → allow: 개인정보 탐지 시 ask로 강등
       → 감사기록(egress: 서비스·모델·항목 종류·글자 수, 본문 미저장)
로컬 모델 실패·타임아웃 → 오류 표시만. 외부 모델로 자동 전환하지 않음.
```

온나라 실제 문서 ID·조직도 사용자 ID·로그인 ID·연락처는 어떤 공급자에게도 보내지 않는다(임시 키로 치환).

---

## 7. 업무 지식 저장소

### 7.1 컬렉션 구분

| 종류 | 예 | 범위 | 기본 보관 |
|---|---|---|---|
| `personal` | 내가 패널로 읽은 공문·메모 | 사용자 | `WXT_LOCAL_RETENTION_DAYS` |
| `duty` | 현행 업무분장 | 부서 | 판본 교체 시까지 |
| `guideline` | 내부 지침·편람·서식 | 부서/기관 | 적용 종료일까지 |
| `case` | 확정 처리사례(회신·배부 확정 결과) | 부서 | 2년(설정) |

### 7.2 스키마(Dexie)

```text
collections(id, kind, scope:'user'|'dept', deptId, name, retentionDays, createdAt)
documents(id, collectionId, sourceOrigin, sourceRef, docKey?, title, version, effectiveFrom, effectiveTo,
          status:'current'|'superseded'|'repealed', bodyRevision, ingestedAt, deletedAt?)
chunks(id, documentId, ord, text, anchor{page?,para?,table?,row?}, tokens, keywords[])
vectors(chunkId, model, modelDigest, dim, vector:Float32Array)
keywordIndex(term, chunkId)          # 문서번호·기관명·사업명·연도·n-gram
jobs(id, kind:'ingest'|'reindex', state, cursor, error?)
```

- 배부기 `samples/`의 업무분장·배부이력 Markdown 계약(적용일·포함/제외 범위·정정 이력)을 `duty`·`case` 적재 형식으로 재사용한다.
- 모델 digest가 바뀌면 해당 벡터를 `stale`로 표시하고 재색인 작업을 만든다.

### 7.3 검색

```text
질의 → 범위 필터(scope·deptId·status=current·적용일) → ① 키워드 정확 일치(문서번호·연도·기관·사업명)
                                                 ② BGE 벡터 top-k
     → RRF 결합 → 같은 문서 중복 제거 → 현행(current) 우선 정렬 → 근거 번호·출처·적용일 표시
```

- 폐지·대체된 지침은 기본 제외, "과거 판본 포함" 토글 시에만 `과거 판본` 배지와 함께 표시한다.
- 검색 점수는 순위 용도로만 쓰고 확률·정확도로 표시하지 않는다.
- 평가: 0단계 공문 표본으로 질문 30개 정답 문서 Recall@5를 측정해 결합 방식·청크 크기를 조정한다.

---

## 8. 업무 상태와 데이터 수명

### 8.1 업무 상태

```text
read(읽음) → drafted(초안) → prepared(온나라 반영 준비) → submitted-intent(반영 요청: 사람이 온나라 버튼 실행)
          → confirmed(온나라 결과 확인) | reconcile-needed(결과 불명확, 수동 대사 필요)
```

- `내 업무` 보드 항목, 배부 배치, 회신 초안이 같은 상태 모델을 쓴다.
- `submitted-intent`는 성공이 아니다. 온나라 화면에서 결과(예: `처리완료`)를 읽어야 `confirmed`.
- 배부기의 보호 상태(`native-confirm-intent` 이후 수동 대사)를 그대로 이식한다.

### 8.2 로컬 데이터 관리

| 데이터 | 저장 | 사용자 기능 |
|---|---|---|
| 설정·키 | `chrome.storage.local` | 수정·키 삭제·기본값 복원 |
| 대화·서비스 결과 | IndexedDB(`DocumentKey` 기준) | 문서별·전체 삭제, 내보내기 |
| 본문·청크·벡터 | IndexedDB(`WXT_LOCAL_STORE_BODY`) | 컬렉션별 삭제·보관 기간·내보내기(JSON) |
| 업무 항목 | IndexedDB | 완료·삭제·내보내기(CSV) |
| 감사기록 | IndexedDB, 90일·1,000건(배부기 기준) | CSV(수식 방지) |

- 설정 → `데이터` 탭에 용량, 보관 기간, 전체 삭제, 내보내기를 둔다.
- 기관 정책으로 본문 저장을 `off`로 강제할 수 있다.

---

## 9. 디자인 시스템 — "행정 블루"

### 9.1 컨셉

- **신뢰·정돈·절제.** 온나라 화면 옆에서 튀지 않되 AI 영역임을 분명히 한다.
- 딥 네이비 헤더 + 흰 표면 + 공공 블루 액센트. 그라데이션·그림자 남용 없이 선·여백·타이포 위계로 구분한다.
- 정보 밀도가 높은 업무 도구: 카드 내부 여백은 넉넉히, 카드 사이는 8px 그리드로 촘촘히.
- 강조색은 블루 하나. 상태색은 의미가 있을 때만.
- **근거와 범위를 숨기지 않는다.** 출처·읽은 범위·`미확인`은 디자인 요소로 항상 보이게 한다.

### 9.2 색 토큰 (WCAG 대비 실측, 2026-09-17)

| 토큰 | 라이트 | 용도 | 대비 |
|---|---|---|---|
| `--navy-900` | `#0B2545` | 헤더 배경 | 흰 글자 15.39:1 |
| `--accent` (`--blue-700`) | `#1A4FA0` | 주 버튼·링크·선택 | 흰 표면 7.87:1 / 흰 글자 7.87:1 |
| `--bg` | `#F5F8FC` | 패널 배경 | — |
| `--surface` | `#FFFFFF` | 카드 | — |
| `--accent-soft` | `#E6EEFA` | 선택 행·칩 | 액센트 글자 6.73:1 |
| `--fg` | `#0F1B2D` | 본문 | 16.23:1 |
| `--fg-muted` | `#526079` | 보조 텍스트 | 표면 6.35:1 / 배경 5.96:1 |
| `--border` | `#DCE3EE` | 구분선 | 장식 |
| `--local` | `#0B7A75` | `내 PC 처리` | 5.18:1 |
| `--ok` | `#12704A` | 완료 확인 | 6.10:1 |
| `--warn` | `#9A5B00` | 주의·`외부 전송`·`미확인` | 5.43:1 |
| `--danger` | `#B42318` | 차단·오류 | 6.57:1 |

| 토큰 | 다크 | 대비 |
|---|---|---|
| `--bg` | `#0E1726` | — |
| `--surface` | `#152238` | — |
| `--fg` | `#E6EDF7` | 15.24:1 |
| `--fg-muted` | `#93A3BB` | 표면 6.22:1 |
| `--accent` | `#6AA2F5` | 배경 6.93:1 / 표면 6.15:1, 액센트 위 `#0E1726` 6.93:1 |

- sAIde `tokens.css`의 역할 토큰 이름은 유지하고 값만 교체한다. 앰버 전용 토큰은 제거한다.
- `scripts/contrast-check.mjs`로 CI에서 대비 검사(텍스트 4.5:1, UI 경계·포커스 3:1).

### 9.3 타이포·형태

| 항목 | 값 |
|---|---|
| 글꼴 | Pretendard(번들, 오프라인) → Malgun Gothic → system-ui |
| 크기 | 11 캡션 · 12 메타 · 13 본문 · 14 카드 제목 · 16 섹션 · 18 헤더 |
| 숫자 | `tabular-nums`(건수·D-day·시간) |
| 반경 | 6 칩·입력 · 10 카드 · 14 다이얼로그 |
| 그림자 | 카드 없음(선), 팝오버·다이얼로그만 1단계 |
| 아이콘 | 1.5px 선 아이콘 한 세트(번들) |
| 포커스 | 2px `--accent` 외곽선 + 2px 오프셋 |
| 폭 | 360~480px, 200% 확대에서 깨짐 없음 |

### 9.4 패널 정보 구조

```text
┌ 헤더(네이비): 워드마크 · 모델 칩 · 설정 ───────────────────┐
├ 맥락 바: 경영지원과 · 접수대기함 · 선택 3건 · [읽은 범위: 목록만] ┤
├ 탭: 현재 문서 | 작성 | 지식 검색 | 내 업무 ─────────────────┤
│  현재 문서: 공문 핵심·조치사항 카드 · 관련 사례 · (접수대기함이면) 배부 추천 │
│  작성: 회신·기안 초안 · 기안 전 검토 · 문장 다듬기             │
│  지식 검색: 과거 공문 · 현행 업무분장 · 내부 지침 · Q&A          │
│  내 업무: 기한·할 일 보드 · 주간 보고 · 인수인계               │
├ 문맥별 빠른 버튼 + 자유 질문 입력창 ─────────────────────────┤
└ 상태 줄: 처리 위치(내 PC/외부) · 단계 · 경과 시간 · 취소 ──────┘
```

- 결과 카드는 항상 `결론 → 근거(번호·출처·anchor) → 읽지 못한 범위 → 다음 행동` 순서다.
- 문서가 바뀌면 이전 문서의 결과는 흐리게 표시하고 "다른 문서의 결과" 라벨을 붙인다.
- 온나라 반영 전에는 `변경 대상 · 변경 내용` 미리보기를 보여준다.

### 9.5 컴포넌트

`AppHeader` · `ModelChip`/`ModelPopover` · `ContextBar` · `CoverageChip` · `FeatureTabs` · `QuickActions` · `ResultCard` · `SourceList` · `UnknownField` · `ConfidenceNote` · `StaleResultBanner` · `EgressConfirmDialog` · `ApprovalDialog` · `ApplyPreview` · `WorkItemBoard` · `StatusRail`(단계·경과·취소) · `EmptyState` · `Toast` · 설정용 `ProviderCard`·`SourceBadge`·`SecretInput`·`DataUsagePanel`.

---

## 10. 서비스 목록 (통합)

| ID | 서비스 | 입력 | 핵심 처리 | 단계 |
|---|---|---|---|---|
| S01 | 공문 핵심·조치사항 카드 | I1 → I2 | 요지·우리 과 할 일·제출물·기한·문의처·근거 문장, 날짜 코드 대조, 결재대기함이면 쟁점 모드 | 3 |
| S02 | 회신·기안 초안 | S01 결과 + 메모 | `관련:` 문장, 공문 골격, 모르는 수치·일자는 빈칸, 복사 | 3 |
| S03 | 담당자 배부 추천 | 접수대기함 목록 | 배부기 이식(사람 확인만), 로컬 RAG(duty·case), 후보 enum, 확정 결과 → `case` | 3 |
| S04 | 개인정보·공개구분 점검 | 모든 입력 | 코드 탐지(체크섬 포함), 정보공개법 제9조 비공개 사유 후보, 전송 게이트 공용 | 3 |
| S05 | 유사 공문·처리사례 검색 | 현재 문서/질의 | 키워드+벡터, 원문·확정 답변 표시 | 4 |
| S06 | 내부 지침·업무 Q&A | 질의 | `guideline`·`duty` 검색, 판본·적용일·출처 인용, 근거 없으면 거절 | 4 |
| S07 | 기한·후속조치 보드(일정 탭) | S01 결과 | 사용자 확인 후 등록, 공문식 날짜 파서, D-day, Edge 실행 중 알림 | 4 — [완료] |
| S08 | 기안 전 검토·공문 교정 | 초안 + 수신문서 + 첨부 목록 | 요청 항목 누락, 본문/붙임 불일치, 합계·날짜 코드 검산, 편람 형식 린터, 행정용어 순화, 수정 전후 | 4 |
| S09 | 문서함 우선순위 브리핑 | 목록 메타 | 긴급·기한 임박·내 업무·단순 공람 분류 | 4 |
| S10 | 첨부 읽기·변경 공문 비교·신구대비표 | I3 | HWPX·PDF 추출, 최초/정정 공문 코드 diff + 변경 의미 설명, 조문 정렬 대비표 | 5 |
| S11 | 주간 업무보고 초안 | 확정 처리기록·업무 항목 | 수집 범위·기준 시각 표시, 집계는 코드, 열람을 완료로 보지 않음 | 5 |
| S12 | 업무 인수인계 노트 | 업무 항목·관련 공문·사례 | 진행 중 업무·기한·처리 방법 묶음, 내보내기 | 5 |
| S13 | 온나라 자연어 길찾기 | 질의 | 온나라 전용 도구 3~4개, 승인 토큰 | 5 |

---

## 11. 단계별 작업 계획

1인 개발 추정 약 20주. 각 단계는 완료 기준을 모두 충족해야 다음 단계로 넘어간다.

### 0단계 · 준비와 사실 확인 (1.5주) — [완료]

| ID | 작업 | 완료 기준 | 상태 |
|---|---|---|:---:|
| P0-1 | `sAIde` 복사 → `onnara-saide/`, `git init`, 이름·manifest·로케일 변경, `npm ci` | `compile`·`test`·`build` 통과 | ✅ 완료 |
| P0-2 | Edge 빌드·설치, **Side Panel 탭 전환 알려진 이슈 재현 확인** | Side Panel·단축키·탭 전환 동작 기록 | ✅ 완료 |
| P0-3 | Ollama 0.34.1 호환: live 테스트, `/api/show` capability·digest, `format` 스키마 출력, 이 PC prefill·decode·콜드 로드 실측, GPU 유무 | 실측표 → 입력 예산·배치 크기 결정 | ✅ 완료 |
| P0-4 | 범정부 AI 시험 키 계약 확인: 확장 페이지 직접 HTTPS 호출과 host 권한, 인증, 업무 오류, SSE, 모델 목록 API, 이미지 입력, 함수 강제 호출. 확장 origin을 거부하면 내부 게이트웨이 또는 제공자 허용 정책 확인 | API 계약 메모와 배포 가능한 연결 방식 확정 | 진행 중 |
| P0-5 | 온나라 시험계정 화면 HTML 저장·비식별화: 접수대기함·결재대기함·공람함·본문보기·문서관리카드·기안기·첨부 다운로드·문서 검색·처리이력 | `fixtures/onnara/*.html`, `docs/onnara-selectors.md`, 본문 뷰어 종류 판정 | fixture 기반 완료 (실제 계정 연계 대기) |
| P0-6 | 기관 확인: 설치 정책, Edge 버전, 외부 전송 범위, 본문 로컬 저장 허용, 감사기록 보관 | ADR 문서 | 검토 완료 |
| P0-7 | **사용자·지표 정의**: 초기 대상 사용자 확정, 공문 표본 20~50건(비식별), 서비스별 목표(정확도·대기시간), 현재 수작업 기준 처리 시간 | `docs/eval/baseline.md` | 진행 중 |

### 1단계 · 기반: LLM 계층 + 디자인 시스템 (3주, 두 트랙) — [완료]

**트랙 A — LLM**

| ID | 작업 | 완료 기준 | 상태 |
|---|---|---|:---:|
| P1-A1 | `.env.example`, `env.ts` 검증, `wxt.config.ts` `loadEnv` → 권한·matches 생성 | 잘못된 값 테스트, 엔드포인트 변경 시 manifest 반영 | ✅ 완료 |
| P1-A2 | `types.ts`·`registry.ts`(env + 발견 + 사용자 병합, 우선순위) | 우선순위 4단계 테스트 | ✅ 완료 |
| P1-A3 | `OllamaProvider`(기존 client·stream 이관, `format`, digest) | 기존 Ollama 테스트 유지 | ✅ 완료 |
| P1-A4 | `GovAiProvider`(배부기 요청·재시도·업무 코드·모델 옵션 TS 이식, 스트림 분기) | 모의 서버: 업무오류·401·403·429·5xx·타임아웃·깨진 JSON·SSE | ✅ 완료 |
| P1-A5 | 설정 스키마 v2 + sAIde v1 migration, API 키 분리 보관 | 공개 설정에 키 없음, migration 테스트 | ✅ 완료 |
| P1-A6 | `router.ts` + `policy/egress.ts` + `policy/pii.ts` 1차 | deny/ask/allow × 로컬/외부 × 본문 유무, 외부 자동 fallback 없음 테스트 | ✅ 완료 |
| P1-A7 | `verify-build.mjs` 확장(키 차단·권한 검사) | 키 포함 배포 빌드 실패 확인 | ✅ 완료 |
| P1-A8 | 시간 제한 표(§6.5) 적용, 단계별 진행 이벤트 | 콜드 로드·무수신·취소 테스트 | ✅ 완료 |
| P1-A9 | `LlmJobQueue`(우선순위·동시성·취소·소유권·background 영속 재개) | 대화 중 임베딩 대기, 패널 재오픈 재개 테스트 | ✅ 완료 |
| P1-A10 | 구조화 결과 공통부(`structured()` + 검증 + `미확인` + 1회 재요청) | 스키마 위반·원문 없는 날짜 강등 테스트 | ✅ 완료 |
| P1-A11 | 기존 대화를 router·큐 경유로 전환, 답변 메타 기록 | 로컬↔범정부 전환 수동 확인 | ✅ 완료 |

**트랙 B — 디자인**

| ID | 작업 | 완료 기준 | 상태 |
|---|---|---|:---:|
| P1-B1 | `tokens.css` 블루 교체, 다크, `contrast-check.mjs` | 텍스트 쌍 4.5:1 이상 | ✅ 완료 |
| P1-B2 | 워드마크·아이콘·브랜드 시트 `온나라 sAIde` | Edge 툴바·관리 화면 확인 | ✅ 완료 |
| P1-B3 | `AppHeader`·`ModelChip`·`ModelPopover`·`StatusRail`·`EmptyState`·`ContextBar`·`CoverageChip` 골격 | 360/480px·다크·200% 캡처 | ✅ 완료 |
| P1-B4 | 설정 화면: `AI 연결`·`서비스`·`데이터`·`정보` 탭, `ProviderCard`·`SourceBadge`·`SecretInput`·`DataUsagePanel` | 키 입력→연결 테스트→모델 선택 점검 | ✅ 완료 |
| P1-B5 | `ResultCard`·`SourceList`·`UnknownField`·`StaleResultBanner` 공통 결과 카드 | 샘플 데이터 캡처 | ✅ 완료 |
| P1-B6 | 문서용 캡처 harness 갱신 | 샘플 화면 재생성 | ✅ 완료 |

**완료 기준:** 화면에서 Ollama·범정부 모델을 골라 대화, `.env` 기본값·재정의·복원 동작, 키가 설정 조회·로그·산출물에 없음, 대화와 임베딩이 큐로 충돌 없이 동작. (검증 완료)

### 2단계 · 온나라 어댑터 + 맥락 모델 + 입력 I1 (2주) — [완료]

| ID | 작업 | 완료 기준 | 상태 |
|---|---|---|:---:|
| P2-1 | `onnara.content.ts`(env origin, `document_start`, top frame) + `frames.ts` | `_MAIN` 로드·검색·이동 후 재탐색 fixture 테스트 | ✅ 완료 |
| P2-2 | 변경 감지(load·MutationObserver·보조 폴링), 다른 출처 iframe 탐지 → `coverage` | 지문 변경 시에만 푸시, 읽기 불가 영역 표시 | ✅ 완료 |
| P2-3 | `DocumentKey`·`RunContext`·`sessionEpoch`, 계정·부서 전환 무효화 | 전환 시 작업·캐시 폐기 테스트 | ✅ 완료 |
| P2-4 | `pages.ts` 화면 판별(확인된 3개 + 0단계 fixture 화면), 실패 시 `unknown` | 화면별 판별 테스트 | ✅ 완료 |
| P2-5 | `readers/`: 목록 행(머리글 기준), 로그인 과(로그인 ID 미사용), 조직도 명단(2회 지문) | 배부기 selector 계약과 동일 결과 | ✅ 완료 |
| P2-6 | 온나라 프로토콜 `ONNARA_CONTEXT`·`ONNARA_COMMAND`(허용 목록·발신자 검증) | 비허용 명령·발신자 거부 | ✅ 완료 |
| P2-7 | 입력 I1: 선택 텍스트·붙여넣기·`.txt`/`.md` → `SourceText`, 임시 맥락·수동 문서 연결 | 임시 맥락이 확정 기억에 합쳐지지 않음 | ✅ 완료 |
| P2-8 | 패널 `ContextBar`·`CoverageChip`·탭 분리(AI/도구), 슬래시 명령 체계 및 문맥 경계(`contextFrom`) | 탭 전환·새로고침·팝업에서 갱신 및 격리 완료 | ✅ 완료 |

### 3단계 · MVP: 공문 이해·회신·배부·개인정보 (4주) — [읽기 축 완료 · 쓰기 축 미착수]

| ID | 서비스 | 작업 | 완료 기준 | 상태 |
|---|---|---|---|:---:|
| P3-1 | S04 개인정보·공개구분 | `pii.ts` 확장(주민·외국인·여권·운전면허·카드·계좌·전화·주소, 체크섬), 제9조 사유 후보, 게이트 연동 | 합성 데이터 정밀도·재현율 기록 | 미착수 — 판정 함수(`transfer-policy.ts`)만 있고 탐지기 없음 |
| P3-2 | S01 공문 카드(I1) | 스키마(요지·할 일·제출물·기한·제출처·문의처·근거 anchor), 1,500토큰 분할→통합, 날짜·금액 코드 대조 | 표본 20건 필드별 정확도, 원문에 없는 날짜 0건 | ✅ 완료 (`ActionCard`) |
| P3-3 | S01 본문 자동 읽기(I2) | 0단계 fixture로 본문 reader, `bodyRevision`, 결재대기함 쟁점 모드, PDF 뷰어 오프스크린 CMap 추출 | fixture 계약 테스트, PDF 추출 완료 | ✅ 완료 |
| P3-4 | S02 회신·기안 초안 | 수신문서 메타 → `관련:` 문장, 공문 골격, 빈칸 규칙, 복사 | 표본 10건 사용자 수정량 기록 | 미착수 |
| P3-5 | S03 배부 추천 | 배부기 상태기계·팝업 관문·수동 대사·감사기록 TS 이식(**사람 확인만**), 후보 enum, `duty`·`case` 적재 UI, 범정부 RAG 선택형, 확정 결과 → `case` | 배부기 테스트 34개 대응 이식 통과, 시험계정 사람 확인 1건 E2E | 미착수 (우선순위 유보) |
| P3-6 | 내 업무 상태 모델 | §8.1 상태, 자동화 대기열, 첨부파일 순차 다운로드 및 실행 기록 | 클릭 성공을 완료로 기록하지 않음 테스트 | ✅ 완료 |

> **3단계 재평가 (2026-09-20).** MVP 완료 기준 중 "회신 초안 복사"(P3-4)와 "배부 추천"(P3-5), "외부 전송 전 개인정보 점검"(P3-1)은 아직 코드에 없다. 지금까지 완성된 것은 **읽기·이해(S01)와 기한 관리(S07), 첨부 자동화**의 세 축이다. 따라서 3단계의 상태는 **[읽기 축 완료 · 쓰기 축 미착수]**로 읽어야 한다.

**MVP 완료 기준:** 실무자가 공문을 열거나 선택해 핵심 카드를 보고 회신 초안을 복사할 수 있고, 배부 담당이 사람 확인 방식으로 추천을 쓸 수 있으며, 외부 모델 전송 시 개인정보 점검이 반드시 거친다.

### 4단계 · 지식과 업무 관리 (3.5주)

| ID | 서비스 | 작업 | 완료 기준 |
|---|---|---|---|
| P4-1 | 지식 저장소 | §7 스키마·적재 작업·digest 재색인·범위 필터·키워드 색인·RRF | 질문 30개 Recall@5 기록 |
| P4-2 | S05 유사 공문·처리사례 | 현재 문서 기반 자동 질의, 확정 답변 연결, S02와 연동 | 표본 검색 품질 기록 |
| P4-3 | S06 지침·업무 Q&A | 현행 우선·과거 판본 토글·근거 없으면 거절 | 근거 없는 답변 0건 |
| P4-4 | S07 기한·후속조치 보드 — [완료] | 공문식 날짜 파서, 사용자 확인 등록, D-day·알림, CSV·ICS 내보내기, 자연어 `@일정`(의도 분류 5종 + 결정적 날짜 해석 + 확인 카드) | 날짜 파서 테스트 통과, `alarms`·`notifications` 권한과 설정 항목 제공 |
| P4-5 | S08 기안 전 검토·교정 | 누락·붙임 불일치·합계·날짜 코드 검산, 편람 린터, 행정용어 순화, 전후 비교 | 린터 규칙별 테스트 |
| P4-6 | S09 문서함 브리핑 | 목록 메타 배치 분류, 목록 revision 캐시 | 50건 수동 평가·처리 시간 |
| P4-7 | 데이터 관리 | 설정 `데이터` 탭: 용량·보관 기간·삭제·내보내기 | 삭제 후 검색 결과 0건 |

### 5단계 · 첨부와 확장 서비스 (4주)

| ID | 서비스 | 작업 | 완료 기준 |
|---|---|---|---|
| P5-1 | 입력 I3 | 첨부 파일명·획득 경로 확인, HWPX·텍스트 PDF 추출, anchor 보존 | 샘플 파일 추출 정확도 |
| P5-2 | S10 변경 공문 비교·신구대비 | 코드 diff + 변경 의미 설명, 조문 정렬 대비표 | 샘플 5쌍 검수 |
| P5-3 | I4 결정 | HWP·스캔 PDF 수요와 Native Messaging 보조 프로세스 비용·보안 검토 | ADR(도입/보류) |
| P5-4 | S11 주간 업무보고 초안 | 기간·범위 선택, 코드 집계, 기준 시각 표시 | 표본 주간 데이터 검수 |
| P5-5 | S12 인수인계 노트 | 업무 항목·공문·사례 묶음, 내보내기 | 표본 검수 |
| P5-6 | S13 자연어 길찾기 | 온나라 전용 도구 3~4개 + 승인 토큰 | 시나리오 10개, 승인 없는 실행 0건 |

### 6단계 · 안정화·배포 (2주)

| ID | 작업 | 완료 기준 |
|---|---|---|
| P6-1 | 시험계정 E2E 체크리스트(배부기 운영 전 검증 7단계 포함) | 모의 검증과 실제 검증 구분 기록 |
| P6-2 | 성능 조정: 입력 예산·배치·워밍업·큐 우선순위 | 0단계 목표 대비 결과표 |
| P6-3 | 보안 점검: 키·전송 감사·저장·삭제·CSV·의존성 감사 | 점검표 |
| P6-4 | 접근성: 키보드 전 흐름·스크린리더·고대비·200% | 점검표 |
| P6-5 | 배포: Edge ZIP, 설치 정책·`storage.managed` 안내, `OLLAMA_ORIGINS` 확장 ID 한정 설치 스크립트 | 새 PC 30분 내 설치 |
| P6-6 | 매뉴얼·관리자 가이드·파일럿 | 피드백 반영 목록 |
| P6-7 | **배부 신뢰도 재보정**: 감사기록(추천 vs 최종 담당자)으로 점수 구간별 일치율 산출, 표본 100건 전까지 `보정 전` 표시 | 임계값 결정 기록 |

---

## 12. 평가 계획

| 서비스 | 지표 | 표본 |
|---|---|---|
| S01 | 필드별 정확도(기한·제출처·제출물), 원문 없는 값 비율, 처리 시간 | 공문 20~50건 |
| S02·S08 | 사용자 수정 글자 비율, 린터 위반 수 | 10건 |
| S03 | 최종 담당자 일치율(점수 구간별), 수동 검토 비율 | 파일럿 감사기록 |
| S04 | 정밀도·재현율 | 합성 개인정보 세트 |
| S05·S06 | Recall@5, 근거 없는 답변 비율 | 질문 30개 |
| 공통 | 첫 토큰·완료 시간(로컬/범정부), 취소 성공률 | 실측 |

결과는 `docs/eval/YYYY-MM-DD-*.md`에 모델·digest·설정과 함께 기록한다. 모의 검증과 실제 확장 검증을 구분한다.

---

## 13. 위험과 대응

| 위험 | 대응 |
|---|---|
| 범정부 API가 확장 origin을 거부 | 제공자 허용 정책 또는 내부 게이트웨이. header 조작과 `--disable-web-security`는 배포 대안으로 사용하지 않음 |
| 범정부 스트리밍 미지원 | 비스트림 + 단계 진행 표시 |
| 본문 DOM이 뷰어·다른 출처 iframe·캔버스 | I1 입력으로 서비스는 먼저 완성, 캡처 대안(범위 표시), I3 첨부 경로 |
| 온나라 화면 구조 변경 | fixture 계약 테스트, 판별 실패 시 fail-closed, 화면 버전 표시 |
| 소형 모델 품질 | 스키마·코드 검증·`미확인`·근거 anchor, 서비스별 모델 선택(게이트 통과 시 범정부) |
| CPU 추론 속도·메모리 경합 | 실측 기반 예산, 작업 큐, 임베딩 `keep_alive:0` |
| 신뢰도 점수 과신 | 확률 표시 금지, 감사기록 재보정 전 `보정 전` 표시 |
| `.env` 키 번들 포함 | 배포 빌드 차단, 설정 입력, 게이트웨이 |
| 로컬 저장 공문 사본 | opt-in·보관 기간·삭제·내보내기·기관 정책 강제 |
| 판본이 지난 지침 인용 | `status`·적용일 필터, 과거 판본 배지 |
| Edge Side Panel 탭 전환 이슈 | 0단계 재현, 활성 탭 재연결 로직·수동 새로고침 제공 |

---

## 14. 확인할 사실 (0단계 체크리스트)

- 문서 상세·기안·발송/처리이력 화면의 실제 DOM과 본문 뷰어 종류
- 설치 대상 Edge 버전, 확장 배포 정책, 온나라 호스트·버전 차이
- 초기 대상 사용자(배부 담당·실무자·관리자)
- 주요 파일 형식, 문서 분량, 로컬 문서 수, 메모리·GPU
- 지식자료 반입·갱신 방식, 개인/부서 저장 범위
- 서비스별 정확도·대기시간 목표
- 범정부 AI 공통기반: 확장 호출 403, SSE, 모델 목록 API, 이미지 입력

---

## 15. 다음 행동 (2026-09-20 갱신)

0단계 중 코드로 할 수 있는 항목(P0-1~P0-3)은 끝났고, **기관 협조가 필요한 항목이 그대로 남아 병목**이다. 아래 1~3은 코드 진척과 무관하게 지금 착수해야 한다.

1. **P0-5(최우선): 온나라 시험계정 화면 HTML 저장.** 현재 어댑터는 추정 셀렉터 위에 서 있어, 실 화면 표본 없이는 어떤 기능도 기관에서 동작을 보장할 수 없다.
2. **P0-7: 비식별 공문 표본 20~50건과 초기 대상 사용자 확정.** S01 정확도 수치를 낼 수 없어 평가 계획(§12)이 통째로 멈춰 있다.
3. **P0-4: 범정부 AI 공통기반 시험 API 키.** 공급자 어댑터 착수 조건이다.
4. **P3-1 재착수: 개인정보 탐지기.** 외부 공급자를 붙이기 전에 반드시 선행한다(§13 위험 대응).
5. 서비스 우선순위 재검토 결과는 [서비스 진단 및 개선 제안](../docs/service-review-2026-09-20.md) 참조.

---

## 16. 근거 문서

- [참조 프로젝트 분석 및 서비스 제안](../docs/reference-analysis-and-ideas.md)
- 참조 프로젝트 문서 (이 저장소 밖 · 작업 폴더의 사본을 본다)
  - `sAIde/docs/ARCHITECTURE.md` · `sAIde/docs/VALIDATION.md`
  - `onnara-ai-document-distributor/.../docs/설계및검증.md` · `.../docs/RAG_자료작성_가이드.md`
- Microsoft Edge Side Panel: https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/sidebar
- Chrome 확장 네트워크 요청: https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
- Chrome storage 접근 수준: https://developer.chrome.com/docs/extensions/reference/api/storage
