# 사용자 매뉴얼 화면 캡처 자산 가이드

기준일: **2026-09-18**. 이 디렉터리의 6개 스크린샷은 온나라 sAIde의 사용자 매뉴얼([`README.md`](../../README.md))과 기능 안내를 위해 준비된 공식 문서용 UI 캡처 자산입니다.

실제 온나라 sAIde 소스 코드의 React 컴포넌트와 행정 블루 디자인 토큰을 독립된 미리보기 환경(`docs/preview/`)에서 렌더링하고, Headless Chromium을 통해 고해상도로 캡처했습니다. AI 생성 이미지나 외부 목업이 아니며 실제 프론트엔드 컴포넌트의 렌더링 결과입니다.

---

## 1. 캡처 이미지 목록 및 역할

| 파일명 | 해상도 | 매뉴얼 설명 영역 | 렌더링된 주요 컴포넌트 및 내용 |
|---|---|---|---|
| [**01-chat.png**](01-chat.png) | 520 × 940 | 사이드패널 AI 대화 및 공문 요약 화면 | `App`, `AppHeader`, `ModelChip`(`내 PC · gemma4:e2b`), 공문 요약 및 원문 확인 배지, `PageContextChip`, `Composer` |
| [**02-approval.png**](02-approval.png) | 520 × 940 | 에이전트 브라우저 작업 승인 카드 | `ApprovalCard`, 온나라 접수대기함 문서 열기 동작 및 사람 승인 인터페이스 |
| [**03-settings.png**](03-settings.png) | 1120 × 1000 | 확장 옵션 및 AI 모델 연결 설정 | `OptionsApp`, Ollama 0.34.1 연결 및 GPU 가속, 토큰 예산, 컨텍스트 길이(num_ctx) 설정 |
| [**04-memory.png**](04-memory.png) | 1120 × 1000 | 로컬 기억 및 공문 지식 저장소 관리 | `MemoryPanel`, IndexedDB 기반 공문 벡터 저장소(4개 페이지·4조각) 및 보관 기간 설정 |
| [**05-presets.png**](05-presets.png) | 1120 × 1000 | 온나라 전용 프롬프트 프리셋 편집기 | `PresetEditor`, 공문요약/조치사항/회신초안/공문교정 맞춤형 프리셋 목록 및 등록 양식 |
| [**06-automation.png**](06-automation.png) | 520 × 940 | 도구 탭 및 첨부파일 일괄 자동화 화면 | `AutomationPanel`, 접수대기함 3건 선택 상태, 첨부 받기 카드, 다운로드 완료 실행 기록 및 폴더 열기 |

> **안내 사항:**  
> 본 캡처는 문서 안내를 위해 온나라 2.0 전자문서 시스템의 샘플 데이터(`2026년도 인공지능 행정업무 시범사업 추진계획 알림` 등)를 바탕으로 생성되었습니다. 실제 기관 온나라 E2E 검증 현황은 [`docs/IMPLEMENTATION_STATUS.md`](../IMPLEMENTATION_STATUS.md)를 참고하세요.

---

## 2. 화면 캡처 재생성 방법 (재현 절차)

최신 UI 컴포넌트 수정 사항을 반영하여 스크린샷 6종을 다시 생성하려면 아래 순서대로 실행합니다.

### 1단계: 미리보기 서버 실행 (첫 번째 터미널)
```powershell
# 프로젝트 루트에서 실행
node scripts/docs-preview.mjs
```
* 서버가 `http://127.0.0.1:4175/`에 바인딩됩니다.
* 이 미리보기 서버는 문서용 정적 하네스(`docs/preview/`)만 로드하며 실제 확장의 빌드 번들에는 포함되지 않습니다.

### 2단계: 캡처 스크립트 실행 (두 번째 터미널)
```powershell
# 프로젝트 루트에서 PowerShell로 실행
./scripts/capture-docs.ps1
```
* 스크립트가 시스템에 설치된 Chrome 또는 Edge를 자동 탐지하여 실행합니다. (필요 시 `-ChromePath` 인수로 브라우저 실행 경로 지정 가능)
* 스크립트가 각 뷰(`panel`, `approval`, `options`, `memory`, `presets`, `automation`)를 헤드리스 모드로 렌더링하고 `docs/screenshots/` 내의 PNG 6장을 덮어씁니다.
* 캡처 완료 후 첫 번째 터미널에서 `Ctrl + C`를 눌러 미리보기 서버를 종료합니다.

---

## 3. 웹스토어 및 마켓플레이스 등록용 자산
공식 Microsoft Edge Add-ons 또는 Chrome 웹스토어 제출용 규격(1280 × 800, 작은 홍보 배너 등) 자산은 [`brand/store/README.md`](../../brand/store/README.md)를 참고하세요.
