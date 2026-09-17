# 사용자 매뉴얼 화면 캡처

촬영일: **2026-09-12**. sAIde 0.1.0 소스의 React 컴포넌트와 원래 CSS를 별도 localhost 환경에서 렌더링하고 headless Chrome으로 캡처했다. 이미지 생성 모델이나 화면을 다시 그린 목업은 사용하지 않았다.

시스템 보완 후 10:13 KST부터 5장을 다시 생성했다. 승인 포커스·설정 동기화·원격 서버 데이터 전송 안내 등 최신 컴포넌트를 사용한다. 실제 동작 검증은 [검증 기록](../VALIDATION.md)에 별도로 구분한다.

**단, 실제 Chrome 확장으로 실행한 화면은 아니다.** 브라우저 연결 도구가 `app-server` 실행 경로 오류로 동작하지 않아 문서용 별도 환경을 사용했다. Chrome API·연결 상태·대화는 샘플로 대체했고, 이미지 아래에 “사용 설명용 예시 · 실제 UI / 샘플 데이터”를 표시했다. 모델 응답·권한 획득·도구 실행 성공의 증거로 사용하지 않는다.

| 파일 | 크기 | 보여주는 UI |
|---|---|---|
| [01-chat.png](01-chat.png) | 520 × 940 | App, MessageList, 본문 첨부, 입력창 |
| [02-approval.png](02-approval.png) | 520 × 940 | 같은 패널에 실제 ApprovalCard 컴포넌트 표시 |
| [03-settings.png](03-settings.png) | 1120 × 1000 | 실제 OptionsApp의 연결·성능 설정 |
| [04-memory.png](04-memory.png) | 1120 × 1000 | 실제 MemoryPanel 단독 표시 |
| [05-presets.png](05-presets.png) | 1120 × 1000 | 실제 PresetEditor 단독 표시 |

샘플 페이지는 `example.com/guide`, 대화는 매뉴얼용으로 작성했다. 개인 방문 기록이나 사용자 대화는 사용하지 않았다. 기억/프리셋 단독 화면은 설정 페이지 안의 해당 섹션이며 별도 제품 페이지가 아니다. 운영 환경과 달리 문서 예시에는 외부 요청·실제 브라우저 조작 기능이 없다.

## 재현

프로젝트 루트에서 의존성을 설치한 후 첫 터미널에서 실행한다.

```powershell
node scripts/docs-preview.mjs
```

두 번째 PowerShell 터미널에서 캡처한다.

```powershell
./scripts/capture-docs.ps1
```

Chrome 위치가 다르면 `-ChromePath '실제 chrome.exe 경로'`를 전달한다. 스크립트는 `.output/docs-captures-날짜/`에 격리된 프로필과 로그를 만들고 기존 PNG를 갱신한다. 사용자의 기존 Chrome 프로필을 열지 않으며 프로필을 재귀 삭제하지 않는다. 캡처 후 다섯 PNG를 열어 빈 화면·텍스트 잘림·샘플 표시 유무를 확인한다. 오류 페이지도 이미지로 저장될 수 있으므로 파일 존재만으로 성공 판정하지 않는다.

주소는 `http://127.0.0.1:4175/?view=panel`, `approval`, `options`, `memory`, `presets`다. 서버는 loopback에만 바인딩된다. 작업 후 첫 터미널에서 Ctrl+C로 종료한다.

문서 예시 소스는 `docs/preview`에 있고 `src` entrypoint 밖이므로 WXT 확장 번들에 들어가지 않는다. Vite와 React plugin은 현재 lockfile의 전이 의존성을 사용한다. 재현 환경은 [검증 기록](../VALIDATION.md)을 참고한다.

## 실제 확장 캡처 추가 시

테스트용 Chrome 프로필에서 production 빌드를 로드하고, Ollama 연결·페이지 요약·승인·실제 동작 결과를 확인한 뒤 원본 캡처를 추가한다. 이미지별 모델/버전/날짜와 데이터 출처를 기록한다. 스토어 제출에는 [별도 규격과 점검](../../brand/store/README.md)을 적용한다.
