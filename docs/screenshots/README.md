# 사용자 매뉴얼 화면 캡처 자산 가이드

기준일: **2026-09-29**. 이 디렉터리의 17개 스크린샷은 온나라 sAIde 사용자 매뉴얼([`README.md`](../../README.md))에 싣는 공식 문서용 UI 캡처입니다.

1. **실제 온나라 시스템 연동 캡처 (2종)**: 실제 공공기관 온나라 전자문서시스템 화면(받은문서 목록, 문서관리카드 기안기)과 우측 sAIde 사이드패널·사이드카가 나란히 연동되어 작동하는 실제 구동 환경 캡처입니다. 처음 보는 실무자도 온나라와의 실제 연동 구조를 한눈에 직관적으로 이해할 수 있습니다.
2. **독립 하네스 상세 UI 캡처 (15종)**: 실제 프런트엔드 React 컴포넌트와 행정 블루 디자인 토큰을 독립된 미리보기 환경(`docs/preview/`)에서 렌더링하고 Headless Chromium으로 캡처한 고해상도 상세 인터페이스입니다.

---

## 1. 캡처 자산 목록

### 🌟 실제 온나라 시스템 통합 연동 캡처
| 파일명 | 해상도 | 매뉴얼 설명 영역 | 화면 구성 및 주요 연동 내용 |
|---|---|---|---|
| [**00-onnara-main-sidepanel.png**](00-onnara-main-sidepanel.png) | 1024 × 526 | 시스템 소개 / AI 사이드패널 연동 | 실제 온나라 전자문서시스템 '공유/공람 > 받은문서' 목록 화면(보고일자·제목·부서·수발신자·상태)과 우측 Edge AI 사이드패널(AI 챗봇·빠른 명령 칩·로컬 모델 연동) 실제 구동 모습 (개인정보 및 공문 목록 모자이크 비식별화 완료) |
| [**00-onnara-drafter-sidecar.png**](00-onnara-drafter-sidecar.png) | 1024 × 861 | 온나라 기안 도우미 연동 | 실제 온나라 '문서관리카드' 웹기안기 본문 작성 화면(부산광역시 표준 공문 서식)과 우측 인페이지 사이드카 드로어('기안 코파일럿' 서식 선택·초안 생성·클릭 위치 삽입) 실제 구동 모습 |

### 🔍 컴포넌트별 상세 UI 캡처 (docs/preview/)
| 파일명 | 해상도 | 매뉴얼 설명 영역 | 렌더링된 주요 컴포넌트 |
|---|---|---|---|
| [**01-chat.png**](01-chat.png) | 520 × 940 | AI 탭 대화 및 공문 요약 | `App`, 5개 탭 막대(공유/공람·AI·일정·도구·내 지식)와 배지, `ModelChip`(`내 PC · gemma4:e2b`), `원문 확인` 배지, `TaskRegisterCard`, `FeedbackButtons`, `PageContextChip`, `Composer` |
| [**08-inbox.png**](08-inbox.png) | 520 × 940 | 공유/공람 탭 (아침 브리핑) | `InboxPanel`, 브리핑 머리말(확인 시각·목록 건수·새 문서), 기한 임박 / 내 업무로 보임 / 단순 공람 갈래와 분류 이유, `일정 등록`·개인화 피드백(`ThumbIcon` 엄지 척/내림 및 올바른 갈래 교정)·`넘기기`(초고속 DOM 반영), 범위 밖 접기 |
| [**02-approval.png**](02-approval.png) | 520 × 940 | 에이전트 브라우저 작업 승인 | `ApprovalCard` — 대상 셀렉터와 동작 설명, 승인/거부 |
| [**07-schedule.png**](07-schedule.png) | 520 × 940 | 일정 탭 (기한·후속조치 보드) | `SchedulePanel`, 월·주·일·목록 보기, 6주 42칸 격자, 대한민국 공휴일(추석, 개천절, 한글날 등) 자동 렌더링, D-day 칩, 기한 미정 띠, CSV/ICS 내보내기 |
| [**06-automation.png**](06-automation.png) | 520 × 940 | 도구 탭 및 공문 본문·첨부 자동화 | `AutomationPanel`, 다운로드 대상 선택(첨부파일만·본문만·본문+첨부), 작업 대상·대기열, 다운로드 실행, 실행 기록과 폴더 열기 |
| [**13-knowledge.png**](13-knowledge.png) | 520 × 940 | 내 지식 탭 (TONGDAL.ai 지식 연동) | `KnowledgePanel` — 지식 공간(`second_brain`) 연결 상태, 색인 진행 안내 칩, 검색/분류 탭, 지식 검색창 |
| [**14-knowledge-chat.png**](14-knowledge-chat.png) | 520 × 940 | AI 대화 중 지식 인용 및 조치 추천 | `App`, `MessageList` — 조치카드 내 `관련 내 자료 (TONGDAL.ai)` 추천, AI 답변 본문 및 `근거 자료 (TONGDAL.ai)` `[1]`, `[2]` 출처 카드, 하단 `내 지식 · 켜짐` 토글 |
| [**10-drafter.png**](10-drafter.png) | 520 × 940 | 온나라 공문서 기안 도우미 (초안 작성 및 제목 반영) | `DrawerApp` — 공문서 서식 선택, 내 참고자료 영역, 추천 공문 제목 자동 추출 및 [제목 반영], 표준 공문서 서식 초안 생성, 원클릭 복사 및 클릭 타깃 삽입 |
| [**12-drafter-references.png**](12-drafter-references.png) | 520 × 940 | 기안 도우미 (참고문서 연동 및 내 파일 분석) | `ReferencePicker` — 온나라 관련정보 2건 감지 및 내 참고자료(HWPX, DOCX) 2건 보관·체크, 파일 올리기 및 드래그앤드롭, 역할 지정(내용 근거/작성 예시), 3단계 정밀 분석 및 원문 대조 사실 확인 |
| [**11-template-manager.png**](11-template-manager.png) | 520 × 940 | 공문서 서식 관리자 (Template Manager) | `TemplateManager` — 4대 표준 서식 및 **`[파일에서 가져오기]`**(HWPX·ODT 서식 자동 분석 등록), 사용자 정의 서식 관리 |
| [**03-settings.png**](03-settings.png) | 1120 × 1000 | 확장 옵션 및 모델 연결 | `OptionsApp` — Ollama 연결 확인, 토큰 예산, `num_ctx`, 모델 유지 시간 |
| [**09-briefing-settings.png**](09-briefing-settings.png) | 1120 × 1000 | 공유/공람 브리핑 설정 | `InboxSettings` — 아침 브리핑·브리핑 시각, 대상 화면, 대상 범위와 포함·제외 키워드, 열람 처리(미열람 유지), 보관 기간 |
| [**04-memory.png**](04-memory.png) | 1120 × 1000 | 로컬 기억 및 지식 저장소 | `MemoryPanel` — IndexedDB 벡터 저장소 목록과 보관 기간 |
| [**05-presets.png**](05-presets.png) | 1120 × 1000 | 프롬프트 프리셋 편집기 | `PresetEditor` — 공문요약/조치사항/회신초안/공문교정 프리셋 |
| [**15-options-tongdal.png**](15-options-tongdal.png) | 1120 × 1000 | TONGDAL.ai 연동 설정 | `TongdalSettings` — 브리지 주소(포트 47821), 연결 권한(검색·읽기), 페어링 상태 확인 및 연결 해제 |

README 상단의 [**infographic.png**](../infographic.png)(1200 × 1360)은 위의 `01-chat.png`·`06-automation.png`를 품은 소개용 포스터이며, 생성 원본은 [`scripts/generate-infographic.html`](../../scripts/generate-infographic.html)입니다.

> **안내:** 캡처에 쓰인 공문(`2026년도 인공지능 행정업무 시범사업 추진계획 알림` 등)은 문서용 샘플입니다. 실제 기관 온나라 E2E 검증 현황은 [`docs/IMPLEMENTATION_STATUS.md`](../IMPLEMENTATION_STATUS.md)를 참고하세요.

---

## 2. 화면 캡처 재생성 절차

UI를 고친 뒤에는 아래 순서대로 15장의 기능별 상세 캡처를 다시 만듭니다. (상단의 실제 온나라 시스템 연동 캡처 2종은 실제 운영 환경 캡처 자산으로 보존됩니다.)

### 1단계: 미리보기 서버 실행 (첫 번째 터미널)
```powershell
node scripts/docs-preview.mjs
```
* `http://127.0.0.1:4175/`에 바인딩됩니다.
* 이 서버는 문서용 정적 하네스(`docs/preview/`)만 로드하며 확장 빌드 번들에는 포함되지 않습니다.
* 표본 데이터(공문 목록, 일정, 브리핑 원장, 기안 서식, 참고자료, TONGDAL 연동 표본, 설정)는 모두 [`docs/preview/main.tsx`](../preview/main.tsx)에 있습니다. 화면을 새로 추가할 때는 이 파일에 `?view=` 갈래를 더하세요.

### 2단계: 캡처 스크립트 실행 (두 번째 터미널)
```powershell
./scripts/capture-docs.ps1
```
* 시스템의 Chrome 또는 Edge를 자동 탐지합니다(`-ChromePath`로 지정 가능).
* 각 기능별 뷰 15종(`panel`, `inbox`, `approval`, `schedule`, `automation`, `options`, `memory`, `presets`, `briefing`, `drafter`, `drafter-refs`, `templates`, `knowledge`, `knowledge-chat`, `options-tongdal`)을 헤드리스로 렌더링해 `docs/screenshots/`의 PNG 15장을 덮어씁니다.
* 캡처가 끝나면 첫 번째 터미널에서 `Ctrl + C`로 서버를 종료합니다.

### 3단계: 소개 인포그래픽 재생성 (UI가 크게 바뀐 경우)
`node scripts/update-infographic.mjs` 명령을 실행하면 `docs/screenshots/`의 최신 `01-chat.png`와 `06-automation.png`를 base64로 인코딩하여 `scripts/generate-infographic.html`에 반영하고, 헤드리스 브라우저로 1200 × 1360 크기의 `docs/infographic.png`를 자동으로 재생성합니다.

---

## 3. 웹스토어 등록용 자산
Microsoft Edge Add-ons / Chrome 웹스토어 제출 규격(1280 × 800 등) 자산은 [`brand/store/README.md`](../../brand/store/README.md)를 참고하세요.
