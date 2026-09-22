# 사용자 매뉴얼 화면 캡처 자산 가이드

기준일: **2026-09-22**. 이 디렉터리의 9개 스크린샷은 온나라 sAIde 사용자 매뉴얼([`README.md`](../../README.md))에 싣는 공식 문서용 UI 캡처입니다.

실제 소스 코드의 React 컴포넌트와 행정 블루 디자인 토큰을 독립된 미리보기 환경(`docs/preview/`)에서 렌더링하고 Headless Edge/Chromium으로 캡처했습니다. **AI 생성 이미지나 외부 목업이 아니라 실제 프런트엔드 컴포넌트의 렌더링 결과**이며, 담긴 공문 자료만 샘플입니다.

---

## 1. 캡처 자산 목록

| 파일명 | 해상도 | 매뉴얼 설명 영역 | 렌더링된 주요 컴포넌트 |
|---|---|---|---|
| [**01-chat.png**](01-chat.png) | 520 × 940 | AI 탭 대화 및 공문 요약 | `App`, 4개 탭 막대(공유/공람·AI·일정·도구)와 배지, `ModelChip`(`내 PC · gemma4:e2b`), `원문 확인` 배지, `TaskRegisterCard`, `FeedbackButtons`, `PageContextChip`, `Composer` |
| [**08-inbox.png**](08-inbox.png) | 520 × 940 | 공유/공람 탭 (아침 브리핑) | `InboxPanel`, 브리핑 머리말(확인 시각·목록 건수·새 문서), 기한 임박 / 내 업무로 보임 / 단순 공람 갈래와 분류 이유, `일정 등록`·`맞음/틀림`·`넘기기`, 범위 밖 접기 |
| [**02-approval.png**](02-approval.png) | 520 × 940 | 에이전트 브라우저 작업 승인 | `ApprovalCard` — 대상 셀렉터와 동작 설명, 승인/거부 |
| [**07-schedule.png**](07-schedule.png) | 520 × 940 | 일정 탭 (기한·후속조치 보드) | `SchedulePanel`, 월·주·일·목록 보기, 6주 42칸 격자, D-day 칩, 기한 미정 띠, CSV/ICS 내보내기 |
| [**06-automation.png**](06-automation.png) | 520 × 940 | 도구 탭 및 공문 본문·첨부 자동화 | `AutomationPanel`, 다운로드 대상 선택(첨부파일만·본문만·본문+첨부), 작업 대상·대기열, 다운로드 실행, 실행 기록과 폴더 열기 |
| [**03-settings.png**](03-settings.png) | 1120 × 1000 | 확장 옵션 및 모델 연결 | `OptionsApp` — Ollama 연결 확인, 토큰 예산, `num_ctx`, 모델 유지 시간 |
| [**09-briefing-settings.png**](09-briefing-settings.png) | 1120 × 1000 | 공유/공람 브리핑 설정 | `InboxSettings` — 아침 브리핑·브리핑 시각, 대상 화면, 대상 범위와 포함·제외 키워드, 열람 처리(미열람 유지), 보관 기간 |
| [**04-memory.png**](04-memory.png) | 1120 × 1000 | 로컬 기억 및 지식 저장소 | `MemoryPanel` — IndexedDB 벡터 저장소 목록과 보관 기간 |
| [**05-presets.png**](05-presets.png) | 1120 × 1000 | 프롬프트 프리셋 편집기 | `PresetEditor` — 공문요약/조치사항/회신초안/공문교정 프리셋 |

README 상단의 [**infographic.png**](../infographic.png)(1200 × 1360)은 위의 `01-chat.png`·`06-automation.png`를 품은 소개용 포스터이며, 생성 원본은 [`scripts/generate-infographic.html`](../../scripts/generate-infographic.html)입니다.

> **안내:** 캡처에 쓰인 공문(`2026년도 인공지능 행정업무 시범사업 추진계획 알림` 등)은 문서용 샘플입니다. 실제 기관 온나라 E2E 검증 현황은 [`docs/IMPLEMENTATION_STATUS.md`](../IMPLEMENTATION_STATUS.md)를 참고하세요.

---

## 2. 화면 캡처 재생성 절차

UI를 고친 뒤에는 아래 순서대로 9장을 다시 만듭니다.

### 1단계: 미리보기 서버 실행 (첫 번째 터미널)
```powershell
node scripts/docs-preview.mjs
```
* `http://127.0.0.1:4175/`에 바인딩됩니다.
* 이 서버는 문서용 정적 하네스(`docs/preview/`)만 로드하며 확장 빌드 번들에는 포함되지 않습니다.
* 표본 데이터(공문 목록, 일정, 브리핑 원장, 설정)는 모두 [`docs/preview/main.tsx`](../preview/main.tsx)에 있습니다. 화면을 새로 추가할 때는 이 파일에 `?view=` 갈래를 더하세요.

### 2단계: 캡처 스크립트 실행 (두 번째 터미널)
```powershell
./scripts/capture-docs.ps1
```
* 시스템의 Chrome 또는 Edge를 자동 탐지합니다(`-ChromePath`로 지정 가능).
* 각 뷰(`panel`, `inbox`, `approval`, `schedule`, `automation`, `options`, `memory`, `presets`, `briefing`)를 헤드리스로 렌더링해 `docs/screenshots/`의 PNG 9장을 덮어씁니다.
* 캡처가 끝나면 첫 번째 터미널에서 `Ctrl + C`로 서버를 종료합니다.

### 3단계: 소개 인포그래픽 재생성 (UI가 크게 바뀐 경우)
`node scripts/update-infographic.mjs` 명령을 실행하면 `docs/screenshots/`의 최신 `01-chat.png`와 `06-automation.png`를 base64로 인코딩하여 `scripts/generate-infographic.html`에 반영하고, 헤드리스 브라우저로 1200 × 1360 크기의 `docs/infographic.png`를 자동으로 재생성합니다.

---

## 3. 웹스토어 등록용 자산
Microsoft Edge Add-ons / Chrome 웹스토어 제출 규격(1280 × 800 등) 자산은 [`brand/store/README.md`](../../brand/store/README.md)를 참고하세요.
