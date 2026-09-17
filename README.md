# 온나라 sAIde

온나라 시스템 오른쪽에서 문서 이해, 배부 판단, 기안·교정, 업무 지식 검색을 지원하는 Microsoft Edge 확장 프로그램입니다. 로컬 Ollama와 범정부 AI 공통기반을 같은 공급자 인터페이스로 연결하는 것을 목표로 합니다.

현재 코드는 검증된 `sAIde` 사이드패널을 기반으로 독립시킨 구축 초기 버전입니다. 로컬 Ollama 연결과 일반 웹페이지 보조 기능은 기준선으로 유지하고, 온나라 화면 연결부와 업무 기능을 단계적으로 추가합니다.

현재 온나라 받은문서 화면에서 다음과 같이 요청하면, 접근 가능한 iframe의 문서 표를 다시 읽어 현재 화면에 표시된 모든 제목을 Markdown 표로 반환합니다.

> 받은문서 메뉴에 리스트업된 모든 문서의 제목을 읽어서 테이블로 만들어줘.

이 기능은 이미지 인식이 아니라 DOM의 `제목` 열과 각 행을 읽습니다. 페이지를 넘겨야 보이는 문서는 자동으로 포함하지 않으며, 답변에 현재 렌더링된 목록 기준임을 표시합니다.

## 개발 환경

- Microsoft Edge / Manifest V3
- Node.js 24.x, npm 11.x
- WXT, React, TypeScript
- Ollama 0.34.1
- 기본 대화 모델 `gemma4:e2b`
- 기본 임베딩 모델 `bge-m3:latest`

## 시작하기

```powershell
npm ci
Copy-Item .env.example .env.local
npm run compile
npm test
npm run build
npm run verify
```

빌드 결과는 `.output/edge-mv3`에 생성됩니다. Edge의 `edge://extensions`에서 개발자 모드를 켜고 **압축 풀린 확장 로드**로 이 폴더를 선택합니다.

`.env`의 `WXT_` 변수는 빌드 결과에 포함됩니다. API 키나 토큰은 `.env`에 넣지 않습니다. 운영 인증은 사용자 설정 또는 기관 내부 게이트웨이를 사용합니다.

## 문서

- 최종 구축 계획: [`plan/onnara-saide-final-workplan.md`](plan/onnara-saide-final-workplan.md)
- 참조 프로젝트 분석: [`docs/reference-analysis-and-ideas.md`](docs/reference-analysis-and-ideas.md)
- 구현 현황: [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md)

## 검증 명령

| 명령 | 내용 |
|---|---|
| `npm run compile` | TypeScript 정적 검사 |
| `npm test` | 자동 테스트 |
| `npm run build` | Edge MV3 프로덕션 빌드 |
| `npm run verify` | manifest와 필수 산출물 검증 |
| `npm run zip` | 배포용 ZIP 생성 |

## 보안 원칙

- 온나라 페이지 읽기는 사용자가 호출한 시점에 필요한 권한만 요청합니다.
- 외부 공급자 전송 전에는 기관 정책과 민감정보 검사를 적용합니다.
- 문서 배부와 시스템 입력은 추천과 초안까지만 자동화하고 최종 실행은 사용자가 확인합니다.
- 확장 저장소를 비밀 저장소로 간주하지 않습니다.
