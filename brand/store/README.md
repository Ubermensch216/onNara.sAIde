# Chrome 웹스토어 등록 자산

갱신: **2026-09-12**. 이 폴더는 제출 준비 자산이며 확장 번들에 포함되지 않는다. 실제 스토어 등록·공개 배포는 이번 작업에서 수행하지 않았다.

## 현재 파일

| 파일 | 규격 | 용도 |
|---|---|---|
| [작은 홍보 이미지](promo-small-440x280.png) | 440 × 280 | 스토어 필수 작은 홍보 이미지 |
| [마키 이미지](promo-marquee-1400x560.png) | 1400 × 560 | 선택 홍보 배너 |
| [확장 아이콘](../../public/icon/128.png) | 128 × 128 | 확장/스토어 아이콘 |
| [브랜드 시트](../saide-brand-sheet.html) | HTML | 로고·색상·사용 규칙 |

작은 홍보 이미지는 필수다. 과거 문서의 선택 자산이라는 설명을 정정했다. 로고 워드마크는 SVG 패스로 되어 있고 락업의 한글 태그라인은 라이브 텍스트이므로 폰트에 따라 달라질 수 있다. 기존 홍보 PNG의 생성 스크립트와 폰트 원본은 저장소에 없다.

## 스크린샷과 등록 전 남은 작업

[공식 이미지 안내](https://developer.chrome.com/docs/webstore/images)에 따르면 1280 × 800 또는 640 × 400 스크린샷을 최소 1장, 최대 5장 제공한다. 실제 사용자 경험을 보여주는 장면을 사용한다. 아이콘의 투명 여백과 작은 홍보 이미지 규격도 제출 시 재확인한다.

[사용자 매뉴얼의 5장](../../docs/screenshots/README.md)은 실제 UI 컴포넌트와 샘플 데이터를 이용한 **문서용 캡처**다. 확장 설치·브라우저 권한·모델 응답을 증명하는 실확장 화면이 아니며 스토어 규격도 다르므로 그대로 제출용으로 간주하지 않는다.

제출 전 체크:

- [ ] 별도 Chrome 테스트 프로필에 최신 production 빌드 설치.
- [ ] 개인정보 없는 테스트 페이지의 요약과 후속 질문 실제 실행 캡처.
- [ ] 승인 카드·실제 동작 결과, 설정, 선택 문장 기능 캡처.
- [ ] 확장 ID/버전/모델/날짜와 원본 이미지 기록.
- [ ] 제품 설명의 동작·권한·데이터 저장 범위를 실제 구현과 대조.
- [ ] 공개 개인정보 처리방침 URL, 지원 연락처, 라이선스 준비.
- [ ] [P1 개선 과제](../../docs/PROJECT_REVIEW.md)와 [브라우저 QA](../../plan/phase5-tool-checklist.md) 처리.
- [ ] `npm run zip` 산출물 및 manifest 확인 후 제출.

## 등록용 설명 초안

manifest 이름과 설명은 `public/_locales/ko/messages.json`, `public/_locales/en/messages.json`이 기준이다. 아래는 스토어 상세 설명 초안이며 공개 제출 전에 검토해야 한다.

### 한국어

sAIde는 내 컴퓨터의 Ollama 모델을 이용해 웹페이지 요약·번역·질문을 돕는 사이드패널 확장입니다. 선택한 문장을 설명하거나 다듬고, 지원 모델에서는 현재 화면을 설명할 수 있습니다.

에이전트는 페이지를 읽고 요소를 찾으며, 클릭·입력·이동은 사용자 승인을 거칩니다. 기억 기능을 켜면 sAIde에 읽힌 페이지의 일부를 로컬에 저장하고 나중에 검색할 수 있습니다.

별도의 Ollama 설치와 모델 다운로드가 필요합니다. 기본 설정은 로컬 서버를 사용합니다. 원격 서버 주소를 설정하면 요청 데이터는 해당 서버로 전송됩니다. 웹페이지 탐색과 자막 수집에는 인터넷이 필요할 수 있습니다. 화면 캡처는 모든 사이트 접근 권한을 요청하며, 일반 본문 읽기는 사이트별로 허용할 수 있습니다.

### English

sAIde is a Chrome side panel that uses an Ollama model to summarize and translate pages, answer questions, and help explain or polish selected text. Models with vision support can also explain the visible page screenshot.

The agent can read pages and find elements. Clicking, typing, and navigation require your approval. Optional memory stores excerpts from pages you have shown to sAIde and lets you search them later.

Ollama and downloaded models are required. The default endpoint is local; configuring a remote endpoint sends request data to that server. Browsing and caption retrieval may require internet access. Screenshot capture requests access to all sites; text extraction can use per-site permission.

## 권한 사유

| 권한 | 실제 사용 |
|---|---|
| sidePanel | 주 사용자 인터페이스 |
| activeTab | 사용자 확장 호출로 부여되는 임시 탭 접근. 상주 패널에서는 이것만을 전제로 하지 않음 |
| scripting | 요청 시 본문/DOM 처리 코드를 주입 |
| storage | 설정과 사용자 프리셋을 로컬에 저장 |
| contextMenus | 선택한 문장 번역·설명·다듬기·보내기 |
| tabs | 현재 창 탭 제목·URL 확인 및 에이전트 탭 목록 |
| localhost/127.0.0.1:11434 host_permissions | 기본 로컬 Ollama 연결 |
| optional_host_permissions: all_urls | 사이트별 접근 요청, 캡처의 전체 사이트 권한, 설정의 선택적 전체 허용 |

단일 목적은 사용자가 보고 있는 페이지를 이해하고 승인하에 작업하도록 보조하는 것이다. 페이지 본문·선택 문장·화면·탭 정보 중 작업에 쓰이는 데이터는 설정된 모델 서버로 전달될 수 있다. 대화·추론·행동 기록 및 opt-in 기억은 로컬에 저장한다. 앱 수준 암호화는 없다.

소스에서 추적/분석 서비스와 원격 실행 코드 다운로드는 확인되지 않았다. 이것을 실제 네트워크 감사 완료 또는 모든 외부 통신 0건으로 표현하지 않는다. YouTube 자막 요청과 일반 페이지 이동, 원격 endpoint 가능성을 포함해 개인정보 고지를 작성한다.
