# 사용자 매뉴얼 화면 캡처 자산 가이드

기준일: **2026-09-18**. 이 디렉터리의 5개 스크린샷은 온나라 sAIde의 사용자 매뉴얼([`README.md`](../../README.md))과 기능 안내를 위해 준비된 공식 문서용 UI 캡처 자산입니다.

실제 온나라 sAIde 소스 코드의 React 컴포넌트와 Tailwind CSS 디자인 시스템을 독립된 미리보기 환경(`docs/preview/`)에서 렌더링하고, Headless Chromium을 통해 고해상도로 캡처했습니다. AI 생성 이미지나 임의의 목업이 아니며 실제 프론트엔드 컴포넌트의 렌더링 결과입니다.

---

## 1. 캡처 이미지 목록 및 역할

| 파일명 | 해상도 | 매뉴얼 설명 영역 | 렌더링된 주요 컴포넌트 |
|---|---|---|---|
| [**01-chat.png**](01-chat.png) | 520 × 940 | 사이드패널 AI 대화 및 문서 요약 화면 | `App`, `AppHeader`, `ModelChip`, `PageContextChip`, `MessageList`, `Composer` |
| [**02-approval.png**](02-approval.png) | 520 × 940 | 에이전트 브라우저 작업 승인 카드 | `ApprovalCard`, 대상 셀렉터 및 사람 확인 인터페이스 |
| [**03-settings.png**](03-settings.png) | 1120 × 1000 | 확장 옵션 및 AI 모델 연결 설정 | `OptionsApp`, Ollama/범정부 AI 연결 설정, 성능/VRAM 설정 |
| [**04-memory.png**](04-memory.png) | 1120 × 1000 | 로컬 기억 및 지식 저장소 관리 | `MemoryPanel`, IndexedDB 기반 공문 벡터 저장소 관리 |
| [**05-presets.png**](05-presets.png) | 1120 × 1000 | 프롬프트 프리셋 편집기 | `PresetEditor`, 공문 검토/교정 업무 프리셋 생성 및 편집 |

> **안내 사항:**  
> 본 캡처는 문서 안내를 위한 정적 예시 데이터(`example.com/guide`)를 기반으로 생성되었습니다. 브라우저 확장 권한 획득, 실제 온나라 전자문서 사이트 접속 화면, 실제 모델 응답의 증거로 사용하지 않습니다. 실제 기관 온나라 E2E 검증 현황은 [`docs/IMPLEMENTATION_STATUS.md`](../IMPLEMENTATION_STATUS.md)를 참고하세요.

---

## 2. 화면 캡처 재생성 방법 (재현 절차)

최신 UI 컴포넌트 수정 사항을 반영하여 스크린샷 5종을 다시 생성하려면 아래 순서대로 실행합니다.

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
* Chrome 경로가 기본 위치(`C:\Program Files\Google\Chrome\Application\chrome.exe`)와 다를 경우 `-ChromePath` 인수를 지정합니다:
  ```powershell
  ./scripts/capture-docs.ps1 -ChromePath 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
  ```
* 스크립트가 각 뷰(`panel`, `approval`, `options`, `memory`, `presets`)를 헤드리스 모드로 렌더링하고 `docs/screenshots/` 내의 PNG 5장을 덮어씁니다.
* 캡처 완료 후 첫 번째 터미널에서 `Ctrl + C`를 눌러 미리보기 서버를 종료합니다.

---

## 3. 웹스토어 및 마켓플레이스 등록용 자산
공식 Microsoft Edge Add-ons 또는 Chrome 웹스토어 제출용 규격(1280 × 800, 작은 홍보 배너 등) 자산은 [`brand/store/README.md`](../../brand/store/README.md)를 참고하세요.
