# 웹스토어 및 마켓플레이스 등록 준비 자산

기준일: **2026-09-26**. 이 디렉터리는 Microsoft Edge Add-ons 및 Chrome 웹스토어 등록을 위해 준비된 홍보 및 메타데이터 자산이며, 확장 프로그램 빌드 번들(`.output/edge-mv3`)에는 포함되지 않습니다.

---

## 1. 현재 자산 목록

| 자산 파일 | 규격 | 용도 및 설명 |
|---|---|---|
| [**작은 홍보 이미지**](promo-small-440x280.png) | 440 × 280 px | 스토어 필수 작은 프로모션 타일 이미지 |
| [**마키 이미지**](promo-marquee-1400x560.png) | 1400 × 560 px | 스토어 상단 추천 배너(선택 자산) |
| [**확장 아이콘**](../../public/icon/128.png) | 128 × 128 px | 스토어 및 확장 관리자 대표 아이콘 |

> 💡 **참고:** 작은 홍보 이미지(440 × 280)는 마켓플레이스 등록 시 필수 규격입니다. 현재 이미지의 락업 워드마크는 SVG 패스로 처리되어 있습니다.

---

## 2. 매뉴얼 캡처와 스토어 등록 스크린샷

[`docs/screenshots/`](../../docs/screenshots/README.md)에 위치한 11장의 스크린샷은 **사용자 매뉴얼용 캡처**입니다.  
스토어 공식 제출용 스크린샷은 [스토어 이미지 가이드](https://developer.chrome.com/docs/webstore/images)에 따라 **1280 × 800 px** 또는 **640 × 400 px** 규격을 충족해야 합니다.

### 스토어 제출 전 필수 점검 목록 (Checklist):
- [ ] 깨끗한 테스트 프로필에서 최신 프로덕션 빌드(`.output/edge-mv3`) 로드 검증
- [ ] 가명/샘플 공문 화면에서의 요약, 조치사항 카드, 슬래시 명령 실행 화면 캡처
- [ ] 공유/공람 브리핑 화면 캡처 및 "문서를 열지 않아 미열람이 유지된다"는 설명 문구 검토
- [ ] 온나라 공문서 기안기 인페이지 드로어 화면 및 표준 서식 관리자 화면 캡처
- [ ] 에이전트 승인 카드(`ApprovalCard`) 및 설정 화면 캡처 (개인정보 미포함)
- [ ] 제품 설명의 동작·권한·데이터 처리 범위를 실제 코드와 대조
- [ ] 기관 및 서비스에 맞는 개인정보 처리방침(Privacy Policy) URL 및 지원 연락처 준비
- [ ] [`docs/IMPLEMENTATION_STATUS.md`](../../docs/IMPLEMENTATION_STATUS.md)의 검증 완료 상태 확인
- [ ] `npm run zip` 산출물(`onnara-saide-*.zip`) 및 manifest 권한 무결성 최종 확인 후 제출

---

## 3. 스토어 상세 설명 초안

확장 메타데이터의 다국어 기준 파일은 `public/_locales/ko/messages.json` 및 `public/_locales/en/messages.json`입니다. 아래는 스토어 상세 페이지에 기재할 소개문 초안입니다.

### 한국어 (Korean)

**온나라 sAIde — 온나라 전자문서를 위한 로컬 AI 사이드패널 어시스턴트**

온나라 sAIde는 공문서 처리 업무를 수행할 때 브라우저 우측 사이드패널에서 문서를 즉시 이해하고 조치사항을 도출할 수 있도록 지원하는 Microsoft Edge 확장 프로그램입니다.

* **핵심 기능:**
  * **공문 핵심 요약 및 조치사항 도출**: 수신된 공문의 요지, 세부 할 일, 제출물, 제출 기한을 원문과 대조하여 한눈에 정리합니다.
  * **원문 대조 검증**: AI의 환각을 방지하기 위해 추출된 기한과 근거 문장을 원문과 실시간 대조하여 표시합니다.
  * **아침 공유/공람 브리핑 (미열람 유지)**: 받은문서 목록을 훑어 기한 임박, 내 업무, 단순 공람으로 자동 분류합니다 (본문을 열지 않아 미열람 유지).
  * **공문 본문 및 첨부파일 일괄 다운로드**: 체크한 공문의 본문(HTML/PDF)과 첨부파일을 백그라운드에서 안전하게 일괄 내려받습니다.
  * **공문서 기안기 연동 (사이드카 드로어)**: 온나라 기안기 화면 진입 시 인페이지 드로어가 구동되어 4대 표준 서식 기반 초안 작성, 참고문서 자동 연동 요약, 클릭 타깃 직접 삽입을 지원합니다.
  * **일정 및 기한 관리**: 공문에서 도출된 조치사항과 마감 기한을 개인 D-day 보드로 관리하고 데스크톱 알림을 수신합니다.
  * **공문 비교 및 교정**: 여러 공문의 변경 사항과 연관성을 한 화면에서 비교 분석합니다.
  * **로컬 데이터 백업 및 복원**: 일정, 대화, 브리핑 기록, 서식/프리셋을 JSON 파일로 안전하게 보관하고 복원합니다.
  * **철저한 로컬 보안**: 내 PC의 Ollama 모델(Gemma 4 등)을 기본 활용하여 공문 본문이 외부로 유출되지 않습니다.
  * **안전한 조작 승인**: 브라우저 조작 및 본문 삽입 시 사전에 사용자 승인을 받습니다.

* **요구사항:** PC에 Ollama가 설치되어 있어야 하며, 기본 모델(`gemma4:e2b`, `bge-m3:latest`) 다운로드가 필요합니다.

### English

**onNara.sAIde — Local AI Side Panel Assistant for OnNara Electronic Document System**

onNara.sAIde is a Microsoft Edge extension designed to help administrative personnel read, summarize, and manage official documents directly from the browser side panel.

* **Key Features:**
  * **Action Cards & Summary**: Extracts summaries, to-do items, required deliverables, and deadlines from official documents.
  * **Source Verification**: Verifies extracted deadlines and sentences against the original document text to prevent hallucinations.
  * **Inbox Briefing (Unread Preservation)**: Automatically categorizes incoming documents without opening them, preserving unread status.
  * **Batch Body & Attachment Downloads**: Safely downloads document bodies (HTML/PDF) and attachments in the background.
  * **Document Drafter Sidecar**: Provides an in-page drawer inside OnNara drafter to generate administrative drafts based on standard templates and insert them directly into the editor with explicit approval.
  * **Schedule & Deadline Tracking**: Converts actions and deadlines into D-day boards with desktop notifications.
  * **Document Comparison**: Compares multiple notices or guidelines side-by-side.
  * **Local Data Backup & Restore**: Exports and imports sessions, tasks, templates, and inbox records locally.
  * **Local-First Privacy**: Runs inference locally via Ollama (e.g., Gemma 4), keeping sensitive document content on your PC.
  * **Approval-Gated Safety**: Every browser interaction and document insertion requires explicit user confirmation.

---

## 4. 권한 명세 및 사유

| 권한 (Permission) | 실제 활용 사유 |
|---|---|
| `sidePanel` | 온나라 업무와 병행할 수 있는 우측 사이드패널 인터페이스 제공 |
| `activeTab` | 사용자가 온나라 화면에서 확장을 호출할 때 현재 탭 접근 허용 |
| `scripting` | 온나라 문서 목록 및 본문 DOM 구조화를 위한 스크립트 실행 |
| `storage` | 사용자 환경설정, 프리셋, 세션 문맥 경계 정보의 로컬 보관 |
| `unlimitedStorage` | 브라우저 공용 할당량 축출로부터 대용량 일정, 대화, 브리핑 원장 및 백업 데이터 보호 |
| `downloads` | 공문 첨부파일 및 본문 파일의 백그라운드 순차 다운로드 및 상태 감시 |
| `downloads.open` | 다운로드 완료된 공문 파일/폴더를 사용자 PC 기본 프로그램으로 즉시 열람 |
| `offscreen` | PDF 뷰어로 렌더링된 공문에서 텍스트 레이어를 안전하게 파싱 (`PDF.js`) |
| `alarms` | 패널이 닫혀 있어도 하루 한 번 기한 알림 및 주기적 공유/공람 브리핑을 실행하기 위한 타이머 |
| `notifications` | 지난 기한/오늘 기한 및 브리핑 새 문서 발생 알림 제공 |
| `contextMenus` | 웹페이지 선택 텍스트 우클릭 메뉴를 통한 프리셋 프롬프트 실행 |
| `tabs` | 백그라운드 공문 수집 탭 및 옵션 탭 관리 |
| `webNavigation` | 온나라 내부 프레임 탐색 및 페이지 전환 감지 |
| `host_permissions` (`http://localhost:11434/*`, `http://127.0.0.1:11434/*`) | 로컬 Ollama AI 데몬과의 안전한 로컬 통신 |
| `optional_host_permissions` (`<all_urls>`) | 온나라 전용 뷰어 등 서로 다른 출처의 프레임에 대해 사용자가 승인한 경우에만 동적 요청 |

