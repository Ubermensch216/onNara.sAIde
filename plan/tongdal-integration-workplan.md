# onNara.sAIde × TONGDAL.ai 연동 작업계획서

작성: 2026-09-28 · 상태: TG1(TONGDAL 브리지 기반)·TG2(onNara 읽기 연동) 구현 — 종단 확인 전 · TG3 이후 미착수 · 작업은 두 저장소 모두 `main`에서 한다 · 대상 저장소: `D:\Dev\onNara.sAIde`(확장) · `D:\Dev\TONGDAL.ai`(데스크톱 앱)
상위 계획: [최종 구축 계획서](onnara-saide-final-workplan.md) — 이 문서는 §7 업무 지식 저장소와 4·5단계 일부(P4-1~P4-3, P5-1, P5-3)에 영향을 준다(§11).

온나라 업무 중에 **TONGDAL.ai에 쌓아 둔 개인 자료를 찾아 쓰고(읽기), 온나라 문서·첨부·작성 결과를 TONGDAL에 등록하고(쓰기), 필요 없는 자료를 치우는(삭제)** 기능을 onNara.sAIde 사이드패널과 기안 서랍에서 제공한다.

---

## 0. 요약

```text
┌ Edge ─────────────────────────────┐        ┌ TONGDAL.ai (Electron) ───────────────────────────┐
│ onNara.sAIde                      │        │ 메인 프로세스                                     │
│  사이드패널: 내 지식 탭 · AI 채팅   │ HTTP   │  ┌ 브리지 서버 127.0.0.1:<고정 포트> ┐            │
│  기안 서랍: 참고자료 'TONGDAL 서고' ├───────►│  │ 인증 · Origin/Host 검사 · 권한 단계 │── IPC ──► 렌더러(화면 갱신·알림)
│  lib/tongdal/client.ts            │ Bearer │  │ 경로 검사(isPathAllowed) · 감사기록 │            │
└───────────────────────────────────┘ 토큰   │  └───────┬────────────────┬─────────┘            │
                                              │          │ 파일 쓰기·이동     │ sidecarFetch(내부 토큰) │
                                              │     raw/ · .myexplorer/trash   ▼                   │
                                              │          └─► RawWatcher ─► FastAPI 사이드카(무작위 포트) │
                                              └────────────────────────────────────────────────────┘
```

- **연결 방식**: TONGDAL 메인 프로세스에 로컬 브리지 서버를 둔다. 사이드카(FastAPI)는 지금처럼 메인 프로세스만 호출한다.
- **쓰기 원칙**: 브리지는 DB를 직접 고치지 않는다. **파일을 `raw/`에 놓고, 보관함으로 옮기는 일만 한다.** 색인·중복 감지·분류 제안은 기존 파이프라인이 처리한다.
- **화면 원칙**: 탭은 가벼운 허브로 둔다. 가치는 AI 채팅·기안 서랍·조치카드에 끼워 넣는 연결 지점에서 나온다. 지식 정리(분류 승인·카테고리·그래프·위키)는 TONGDAL에서만 한다.
- **추정 기간**: 1인 약 7주(§8). 선행 결정 D1(확장 ID 고정)이 끝나야 페어링을 시작할 수 있다.

---

## 1. 설계 원칙

| # | 원칙 | 이유 |
|---|---|---|
| G1 | **정본은 TONGDAL의 파일**이다. 확장은 캐시 외에 문서 지식을 따로 쌓지 않는다 | 지식 저장소가 둘이 되면 내용이 어긋난다 |
| G2 | **모든 쓰기는 TONGDAL 메인 프로세스 한 곳**에서 한다. 사이드카 DB 직접 수정 금지 | 감시기·되돌리기 스택·렌더러 상태와 어긋나지 않게 한다 |
| G3 | 브리지는 **읽기 → 등록 → 삭제** 순서로 연다. 권한 단계도 같은 순서로 나눈다 | 위험이 낮은 것부터 검증한다 |
| G4 | 확장에서 **영구 삭제는 없다.** 삭제 = 지식 공간 안 보관함으로 이동, 30일 안에 복원 | 되돌릴 수 없는 동작을 브라우저 쪽에 두지 않는다 |
| G5 | AI 에이전트는 **검색만 자율 실행**, 등록은 승인 토큰, **삭제는 도구로 노출하지 않는다** | 기존 에이전트 승인 원칙과 같다 |
| G6 | TONGDAL이 꺼져 있거나 페어링이 끊기면 **fail-closed**: 기능을 숨기거나 "TONGDAL 실행 필요"를 표시한다. 조용히 빈 결과를 돌려주지 않는다 | 근거 없는 답변 방지 |
| G7 | 검색은 TONGDAL, **답변 생성은 onNara 파이프라인**이 맡는다 | 컨텍스트 예산(numCtx 4096)·프롬프트·전송 게이트를 onNara가 통제한다 |
| G8 | API는 `/bridge/v1`로 버전을 붙이고, `status`에서 `apiVersion`을 확인해 호환되지 않으면 연동을 끈다 | 두 저장소가 따로 배포된다 |

---

## 2. 선행 결정 사항

| ID | 결정할 내용 | 권장 | 시점 |
|---|---|---|---|
| D1 | **확장 ID 고정**(manifest `key`) — 기존 미결 대책 A | 적용. 브리지가 Origin의 확장 ID로 호출자를 확인하므로 쓰기·삭제를 열려면 필수다. 적용 전 전체 백업 → key 적용 → 복원 순서. `.pem`은 커밋 금지, 별도 보관 | TG0 |
| D2 | **배포·업데이트 절차** — 기존 미결 대책 B | 고정 경로 + 덮어쓰기 후 새로고침을 기본으로 하고, 기관 배포는 CRX + `ExtensionInstallForcelist` | TG0 (D1과 함께) |
| D3 | 브리지 포트 | 고정 기본값 `47821`(가칭), 두 앱 설정에서 변경 가능. TONGDAL은 단일 인스턴스로 제한 | TG0 |
| D4 | P4-1(확장 내부 지식 저장소)의 범위 | 문서 지식(`duty`·`guideline`·`case`)은 **TONGDAL 연동으로 대체**하고, 확장 내부에는 대화 기억(`personal`)만 남긴다. TONGDAL을 쓰지 않는 사용자를 위한 내부 저장소는 수요를 확인한 뒤 결정 | TG0 |
| D5 | 확장에서 삭제할 수 있는 범위 | `raw/` 아래 **모든 문서**(권한 단계 `delete`를 켠 경우만, 기본은 꺼짐). `wiki/`는 대상에서 제외 | TG4 전 |
| D6 | TONGDAL이 받지 못하는 형식(`.hwp`·`.xlsx`·스캔 PDF) | 1차: 확장이 추출한 텍스트를 `.md`로 등록하고, 원본은 숨김 원본 보관소(`.myexplorer/originals/`)에 함께 보관. 2차: TONGDAL에 XLSX 파서 추가. `.hwp` 추출은 P5-3 결정을 따른다 | TG3 전 |

---

## 3. 연동에 영향을 주는 현재 코드 사실 (2026-09-28 확인)

| 구분 | 사실 | 위치 | 계획에 주는 영향 |
|---|---|---|---|
| TONGDAL | 사이드카 포트는 실행마다 무작위, 인증 토큰도 실행마다 새로 생성해 메모리에만 둔다 | `electron/sidecarManager.ts:37, :103` | 외부에서 사이드카에 직접 붙지 않는다 → 브리지 필요 |
| TONGDAL | 사이드카 CORS는 `null`과 localhost 오리진만 허용하고, 모든 요청에 `X-MyExplorer-Token`을 요구한다 | `electron/sidecar/main.py:46-60` | 유지. 브리지만 내부 토큰으로 호출한다 |
| TONGDAL | 창을 모두 닫으면 앱이 종료되고 사이드카도 함께 꺼진다. 단일 인스턴스 잠금과 트레이가 없다 | `electron/main.ts:98` | T0·T2: 단일 인스턴스, 트레이 상주, 로그인 시 자동 시작 |
| TONGDAL | 지식 공간 경로는 렌더러(zustand persist)가 들고 있다가 `initialize-knowledge-root` IPC로 메인에 알린다 | `electron/ipc/fs.ts:360`, `src/store/explorerStore.ts` | T1: 메인이 현재 지식 공간을 기억해 브리지가 쓴다 |
| TONGDAL | 파일 권한 검사 `isPathAllowed(path, 'read'\|'write')`와 승인 루트는 메인에 있다 | `electron/ipc/permission.ts:97` | 브리지의 모든 경로 처리가 이 함수를 거친다 |
| TONGDAL | 감시기가 `raw/`의 추가·삭제를 보고 색인하거나 색인을 지운다. 점(.)으로 시작하는 경로는 무시하고, `.pdf .docx .hwpx .txt .md .json .csv`만 색인한다 | `electron/rawWatcher.ts:70, :80-82, :96` | 등록 = `raw/`에 파일 쓰기, 삭제 = `.myexplorer/trash/`로 이동 |
| TONGDAL | 문서 행 ID는 절대경로의 md5다. 경로와 무관한 ID(`source_documents`)와 파일 해시(`source_versions.content_hash`)는 따로 있다 | `sidecar/main.py:1278`, `sidecar/app/core/database.py:75, :89` | 확장이 오래 기억할 키는 `source_documents.id` + 해시로 한다. 복원할 때는 원래 경로로 되돌린다 |
| TONGDAL | `/api/delete-file`은 청크·FTS·벡터·`documents`만 지우고 `graph_triples`는 남긴다(재색인 경로 1159행은 지운다). 분류 제안·엔티티 관계·메타데이터 정리 여부는 미확인 | `sidecar/main.py:1275-1300` | T7: 삭제 전에 정리 범위를 확정하고 고친다 |
| TONGDAL | `add-source-files`는 같은 이름이 있으면 "(2)" 사본을 만든다. 해시를 먼저 확인하지 않는다 | `electron/ipc/knowledge.ts:562` | 브리지 등록은 해시 조회를 먼저 한다 |
| TONGDAL | 답변 모델 `gemma4:e2b`, 임베딩 `bge-m3:latest` — onNara와 같은 Ollama를 공유한다 | `sidecar/main.py:66-67` | 색인과 채팅이 CPU를 두고 경합한다(§10) |
| onNara | `host_permissions`에 `<all_urls>`·`http://*/*`가 이미 있다 | `wxt.config.ts:131` | **manifest 권한 추가 불필요.** 나중에 `<all_urls>`를 줄이면 `http://127.0.0.1:<포트>/*`를 명시한다 |
| onNara | 사이드패널 탭은 `inbox·ai·schedule·automation` 4개다 | `src/entrypoints/sidepanel/App.tsx:72-75, :702` | `knowledge` 추가. 페어링 전에는 숨긴다 |
| onNara | 기안 서랍 참고자료 선택기는 "온나라 관련정보 + 내 참고자료" 두 묶음에서 최대 3건을 고른다 | `src/entrypoints/drawer-page/components/ReferencePicker.tsx` | 세 번째 묶음 "TONGDAL 서고" 추가 |
| onNara | '내 참고자료'는 원본을 보관하지 않고 추출 텍스트와 SHA-256만 둔다(최대 50건) | `src/lib/storage/user-refs.ts` | "TONGDAL로 옮기기"는 텍스트 `.md` 등록이 된다 |

---

## 4. 아키텍처

### 4.1 역할 분리

| 담당 | 하는 일 | 하지 않는 일 |
|---|---|---|
| onNara 확장 | 검색 질의, 결과 표시, 컨텍스트 예산 조절, 답변 생성, 등록할 바이트·메타 준비, 사용자 확인 | TONGDAL 파일·DB 직접 접근, 문서 지식 영구 보관 |
| TONGDAL 브리지(메인) | 인증, 권한 단계, 경로 검사, 파일 쓰기와 이동, 해시 조회, 메타 대기열, 감사기록, 렌더러 알림 | 텍스트 파싱·임베딩(사이드카 몫), 답변 생성 |
| TONGDAL 사이드카 | 색인, 하이브리드 검색, 중복·버전 감지, 분류 제안 | 외부 요청 직접 수신 |
| TONGDAL 화면 | 분류 승인, 카테고리, 그래프, 위키, 연결 관리(페어링·권한·해제) | — |

### 4.2 브리지 API v1

모든 요청: `Authorization: Bearer <페어링 토큰>`. 응답은 JSON. 오류는 `{ code, message }`이고 `message`는 한국어로 사용자에게 보여 줄 수 있어야 한다.

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| GET | `/bridge/v1/status` | (토큰 없이도 최소 정보) | `apiVersion`, 앱 버전, 지식 공간 연결 여부, 사이드카 준비 상태, 색인 대기·처리 수, Ollama 도달 여부, 이 토큰의 권한 단계 |
| POST | `/bridge/v1/pair` | 페어링 코드 | 코드와 확장 Origin을 받아 토큰 발급(§4.3) |
| POST | `/bridge/v1/search` | read | `{ query, topK≤10, shelfId?, includeParent? }` → 결과마다 `sourceDocumentId`, 제목, 경로(지식 공간 기준 상대경로), `sectionPath`, 쪽, 청크 본문, 선택적 부모 문맥, 검색 방식(`hybrid`/`keyword`) |
| GET | `/bridge/v1/shelves` | read | 분류 트리 |
| GET | `/bridge/v1/documents?shelfId&query&cursor` | read | 카탈로그 목록(페이지 단위) |
| GET | `/bridge/v1/documents/{id}` | read | 메타데이터, 상태(색인 중·분류 대기·완료·실패), 추출 텍스트(`maxChars`) |
| GET | `/bridge/v1/documents/{id}/file` | read | 원본 바이트(내 참고자료 가져오기, 다운로드용) |
| GET | `/bridge/v1/browse?path=raw/...` | read | `raw/` 폴더 목록. 지식 공간 밖 경로는 거부 |
| PUT | `/bridge/v1/items` | write | 본문 = 파일 바이트. 헤더 `X-Bridge-Meta`(base64url JSON ≤ 4KB), `Idempotency-Key` = SHA-256. → `202 { jobId, state }` 또는 `200 { duplicateOf }` |
| GET | `/bridge/v1/jobs/{jobId}` | write | `accepted → indexing → proposal_pending → cataloged` / `failed(reason)` |
| DELETE | `/bridge/v1/documents/{id}` | delete | 보관함으로 이동 → `{ trashId, restoreUntil }` |
| POST | `/bridge/v1/trash/{trashId}/restore` | delete | 원래 경로로 복원. 경로가 차 있으면 새 이름으로 복원하고 알린다 |
| GET | `/bridge/v1/open?id=` | read | TONGDAL 창을 앞으로 가져와 해당 문서 화면을 연다 |

- `X-Bridge-Meta` 필드: `filename`, `kind`(`onnara-body`·`onnara-attachment`·`drawer-upload`·`user-ref`·`ai-output`), `docNumber`, `title`, `agency`, `date`, `sourceUrl`, `extractedText?`(D6 대체 형식용은 본문으로 따로 보낸다), `note`.
- 크기 상한: 파일 50MB, 요청 본문 60MB. 등록은 시간당 200건으로 제한한다.
- 1차에는 답변 생성 API(`/api/chat` 중계)를 열지 않는다(G7).

### 4.3 페어링

```text
① TONGDAL 설정 › "onNara.sAIde 연결" › [연결 코드 만들기] → 6자리 코드, 5분 유효, 1회용
② onNara 설정 › 연동 › 코드 입력 → POST /bridge/v1/pair { code }   (Origin: chrome-extension://<ID>)
③ TONGDAL 화면에 확인 창: "onNara.sAIde (ID ab…cd) 연결을 허용할까요? 권한: 읽기·등록"
④ 허용 → 256비트 토큰 발급. TONGDAL은 토큰 해시 + 확장 ID + 권한 단계를 safeStorage로 암호화해 저장
⑤ onNara는 토큰을 chrome.storage.local에 저장(백업 파일에서 제외)
```

- 권한 단계 `read` · `write` · `delete`는 TONGDAL 화면에서만 바꾼다. 기본값은 read·write 켜짐, delete 꺼짐.
- 연결 해제는 양쪽 어디서든 할 수 있다. 확장 ID가 바뀌면 토큰이 무효가 되고 다시 페어링해야 한다(D1이 이를 막는다).

### 4.4 보안 규칙 (브리지)

1. `127.0.0.1`에만 바인딩한다.
2. `Host` 헤더가 `127.0.0.1:<포트>` 또는 `localhost:<포트>`가 아니면 거부한다(DNS 리바인딩 방지).
3. `Origin`이 있으면 `chrome-extension://<등록된 ID>`만 허용한다. `http(s)://` Origin은 즉시 거부한다.
4. **CORS 응답 헤더를 보내지 않는다.** 확장은 host 권한으로 CORS를 우회하고, 일반 웹페이지는 응답을 읽지 못한다. `Authorization` 헤더는 사전 요청을 요구하므로 웹페이지발 CSRF도 막힌다.
5. 토큰은 상수 시간으로 비교한다. 실패가 반복되면 일시 차단한다.
6. 경로는 클라이언트가 보낸 값을 쓰지 않는다. 문서 ID → 메인이 경로를 찾아 `isPathAllowed`로 검사한다. 저장 파일명은 브리지가 정리한다(`..`, 예약어 `CON`·`NUL` 등, 금지 문자, 길이).
7. 모든 쓰기·삭제는 `.myexplorer/bridge-audit.jsonl`에 기록한다: 시각, 확장 ID, 동작, 대상 상대경로, SHA-256, 결과.
8. 사이드카 포트·내부 토큰은 브리지 응답에 절대 싣지 않는다.

### 4.5 등록 흐름

```text
onNara: 대상 선택 → 확인 카드(파일명·크기·저장 위치·형식 처리 방식·[S04 이후] 개인정보 경고) → 승인
     → SHA-256 계산 → PUT /items
브리지: 토큰·권한 확인 → content_hash 조회(사이드카) → 이미 있으면 200 duplicateOf
     → 없으면 raw/온나라/<YYYY>/<YYYYMMDD>_<제목 40자>[_<문서번호>].<ext> 에 임시 이름으로 쓰고 → 이름 바꾸기(원자적)
     → 메타 대기열(.myexplorer/bridge-pending.json)에 경로→메타 기록 → 202 jobId
감시기: add → /api/index-file → 분류 제안(자동 승인 설정 적용)
브리지: 색인 완료 이벤트에서 메타 대기열을 꺼내 document_metadata에 반영 → job 상태 갱신 → 렌더러에 "onNara에서 1건 등록" 알림
onNara: 작업 중에는 /jobs 를 3초 간격으로 확인 → "등록됨(분류 대기)"처럼 실제 단계를 그대로 표시
```

- 온나라 문서 본문은 YAML 머리말(문서번호·제목·생산기관·일자·출처 URL·가져온 시각)이 붙은 `.md`로 저장한다. 머리말은 키워드 검색에도 걸린다.
- D6 대체 형식: 원본은 `.myexplorer/originals/<sha256>.<ext>`, 추출 텍스트는 `raw/…/<이름>.<원래 확장자>.md`. 메타에 원본 위치를 연결한다.

### 4.6 삭제·복원 흐름

```text
onNara: [삭제] → 확인 창(제목·상대경로·연결된 위키 수·"30일 안에 복원 가능") → DELETE /documents/{id}
브리지: delete 권한 확인 → 경로 조회·검사 → .myexplorer/trash/<trashId>/ 로 이동 + manifest.json(원래 경로·해시·시각·요청자)
감시기: unlink → /api/delete-file (T7로 정리 범위 보강)
TONGDAL 화면: "onNara에서 1건 삭제됨 [되돌리기]" 알림
복원: POST /trash/{trashId}/restore → 원래 경로로 이동 → 감시기 add → 재색인(원래 경로라 문서 ID 유지)
정리: TONGDAL 시작 시 30일 지난 보관 항목 영구 삭제(보관 기간은 TONGDAL 설정)
```

### 4.7 연결 상태와 화면 표시 (fail-closed)

| 상태 | 판정 | onNara 표시 |
|---|---|---|
| 미설정 | 토큰 없음 | 내 지식 탭 숨김, 설정에 "TONGDAL.ai 연결" 안내 |
| 앱 꺼짐 | `/status` 연결 거부 | "TONGDAL.ai가 실행 중이 아닙니다" + 다시 확인 |
| 지식 공간 없음 | `status.knowledgeRoot=false` | "TONGDAL에서 지식 공간을 먼저 선택하세요" |
| 엔진 준비 중 | `sidecarReady=false` | 준비 중 표시, 검색 비활성 |
| 키워드만 | Ollama 미도달 → `searchMode=keyword` | 결과에 "키워드 검색만 사용" 배지 |
| 색인 중 | 대기 > 0 | "색인 중 N건 — 답변이 느려질 수 있음" |
| 권한 없음 | 403 `scope` | 해당 버튼 숨김 + "TONGDAL 설정에서 허용 필요" |
| 버전 불일치 | `apiVersion` 다름 | 연동 끔 + 업데이트 안내 |
| 토큰 무효 | 401 | 토큰 삭제 + 다시 페어링 안내 |

---

## 5. onNara.sAIde 화면 배치

| 연결 지점 | 기능 | 단계 |
|---|---|---|
| **AI 탭 채팅** | 범위 선택에 "내 지식 포함". 검색 결과를 예산 안에서 근거로 넣고 출처 카드(제목·섹션·쪽·[TONGDAL에서 열기]) 표시 | TG2 |
| **기안 서랍 참고자료 선택기** | 세 번째 묶음 "TONGDAL 서고": 검색 → 선택(합계 3건 제한 유지) | TG2 |
| **조치카드(S01)** | "관련 내 자료" 최대 3건 자동 추천. 질의는 제목·문서번호·기관명으로 코드가 만든다 | TG2 |
| **내 지식 탭(신규)** | 검색, 분류·폴더 탐색, 문서 미리보기, 최근 등록 현황(작업 상태), 연결 상태. 문서별 [채팅 근거로] [내 참고자료로] [TONGDAL에서 열기] [삭제*] | TG2(읽기)·TG3·TG4 |
| **문서 화면·조치카드·첨부 목록** | [TONGDAL에 등록] | TG3 |
| **내 참고자료 항목** | [TONGDAL로 옮기기] | TG3 |

- 내 지식 탭에 **넣지 않는 것**: 분류 제안 승인, 카테고리 편집, 그래프, 위키, 백업. 필요한 곳에 [TONGDAL에서 열기]를 둔다.
- 탭 표시줄 폭: 5개가 되므로 좁은 폭에서는 아이콘만 보이게 한다. 탭 배지는 진행 중인 등록 작업 수를 보여 준다.

---

## 6. 작업 목록 — TONGDAL.ai

| ID | 작업 | 주요 파일(예정) | 완료 기준 |
|---|---|---|---|
| T0 | 단일 인스턴스 잠금(`requestSingleInstanceLock`), 두 번째 실행은 기존 창을 앞으로 | `electron/main.ts` | 두 번 실행해도 프로세스 1개, 포트 충돌 없음 |
| T1 | 메인이 현재 지식 공간을 기억(`initialize-knowledge-root`·`reset-knowledge-root`에서 갱신, userData에 저장) | `electron/ipc/fs.ts`, `electron/ipc/knowledge.ts`, 신규 `electron/knowledgeRoot.ts` | 렌더러 없이도 브리지가 경로를 안다 |
| T2 | 트레이 상주(창 닫기 = 숨기기, 트레이 메뉴 종료), 로그인 시 자동 시작 옵션(`setLoginItemSettings`, `--hidden`) | `electron/main.ts`, 신규 `electron/tray.ts` | 창을 닫아도 브리지 응답, 재부팅 후 자동 기동 |
| T3 | 브리지 서버: 라우터, 인증, Origin·Host 검사, 크기·빈도 제한, 오류 규격, 감사기록 | 신규 `electron/bridge/{server,auth,routes,audit}.ts` | §4.4 보안 규칙별 시험 통과 |
| T4 | 페어링·연결 관리 화면: 켜기/끄기, 코드 발급, 허용 확인 창, 연결 목록, 권한 단계, 해제 | 신규 `src/components/settings/BridgeSettings.tsx`, `electron/preload.ts` | 코드 1회용·5분 만료, 해제 즉시 401 |
| T5 | 읽기 라우트: status, search, shelves, documents, file, browse, open | `electron/bridge/routes.ts` | 모든 경로 처리가 `isPathAllowed`를 거침 |
| T6 | 등록: 해시 조회(사이드카에 `content_hash` 조회 엔드포인트 추가), 원자적 쓰기, 파일명 정리, 메타 대기열, 작업 상태 | `electron/bridge/ingest.ts`, `sidecar/main.py` | 같은 파일 재전송 시 사본 0건, 중단 후 재시작해도 메타 반영 |
| T7 | 삭제 정리 범위 보강: `graph_triples`, 분류 제안, 메타데이터, 엔티티 관계 근거, `source_versions.current_path`의 처리 규칙 확정 | `sidecar/main.py`, `sidecar/app/core/database.py`, `tests/` | 삭제 후 검색·그래프·제안함에 흔적 0건(pytest) |
| T8 | 보관함 이동·복원·30일 정리 | `electron/bridge/trash.ts` | 복원 후 같은 문서 ID로 재색인, 보관 항목은 색인되지 않음 |
| T9 | 대체 형식(D6): 원본 보관소 + 추출 텍스트 `.md`, 메타 연결. 2차로 XLSX 파서 | `electron/bridge/ingest.ts`, `sidecar/` | `.xlsx`·`.hwp` 등록 시 검색 가능, 원본 다운로드 가능 |
| T10 | 렌더러 갱신·알림: 브리지 쓰기 이벤트 → 카탈로그·자료 화면 새로고침, 되돌리기 알림 | `electron/preload.ts`, `src/components/*` | 등록·삭제가 TONGDAL 화면에 즉시 반영 |
| T11 | 시험: 브리지 순수 모듈(인증·경로·Origin·파일명)은 Electron 없이 시험 가능하게 분리, 사이드카 pytest 추가 | `tests/`, `electron/bridge/*.test.ts` | 시험 통과, README 갱신 |

## 7. 작업 목록 — onNara.sAIde

| ID | 작업 | 주요 파일(예정) | 완료 기준 |
|---|---|---|---|
| O0 | **D1·D2 적용**: 전체 백업 → manifest `key` → 복원 → 확장 ID 기록, 배포 절차 README 반영 | `wxt.config.ts`, `README.md` | 폴더를 옮겨도 ID 동일, 데이터 유지 |
| O1 | TONGDAL 클라이언트: fetch·시간 제한·취소, 오류 코드 → 한국어 메시지, 상태 판정(§4.7), `apiVersion` 확인 | 신규 `src/lib/tongdal/{client,types,errors,status}.ts` | 상태별 단위 시험 |
| O2 | 연동 설정: 브리지 주소(`.env` `WXT_TONGDAL_BRIDGE_URL` 기본값), 코드 입력, 상태, 해제. 토큰은 `chrome.storage.local`에 두고 백업에서 제외 | `src/entrypoints/options/`, `src/lib/storage/settings.ts`, `.env.example`, `scripts/check-public-env.mjs` | 백업 파일에 토큰 없음(시험으로 고정) |
| O3 | 내 지식 탭(읽기): `View`에 `knowledge` 추가, 페어링 전 숨김, 검색·탐색·미리보기·연결 상태 | `src/entrypoints/sidepanel/App.tsx`, 신규 `components/KnowledgePanel.tsx`, `public/_locales/*` | 상태 9종 화면 확인, 키보드 조작 가능 |
| O4 | 채팅 연동: "내 지식 포함" 범위, 결과를 예산 안에서 잘라 넣기(자식 청크 우선, 여유 있으면 부모 문맥), 출처 카드 | `src/lib/chat/`, `components/MessageList.tsx` | numCtx 4096에서 넘침 0건, 근거 없으면 거절 |
| O5 | 기안 서랍 "TONGDAL 서고" 묶음 | `drawer-page/components/ReferencePicker.tsx`, `lib/onnara/reference-context.ts` | 세 묶음 합산 3건 제한 유지 |
| O6 | 조치카드 "관련 내 자료" 추천 | `lib/onnara/`, 조치카드 컴포넌트 | 질의 생성은 코드, 추천 0건이면 표시 안 함 |
| O7 | 등록: 문서 본문 `.md`(머리말), 서랍 업로드 파일, 내 참고자료 옮기기, AI 산출물. 확인 카드, SHA-256, 작업 상태 표시 | 신규 `src/lib/tongdal/register.ts`, `components/TongdalRegisterCard.tsx` | 중복 재전송 사본 0건, 단계별 상태가 실제와 일치 |
| O8 | 온나라 첨부 등록 — **P5-1(첨부 자동 획득) 이후** | `lib/downloads/`, `lib/tongdal/register.ts` | P5-1 완료 기준 충족 후 |
| O9 | 삭제·복원: 확인 창, 되돌리기 알림, delete 권한 있을 때만 버튼 표시 | `components/KnowledgePanel.tsx` | 복원 후 검색 결과 복귀 |
| O10 | 에이전트 도구: `tongdal_search`(읽기, 자율), `tongdal_register`(승인 토큰). 삭제 도구 없음 | `src/lib/agent/tools.ts` | 승인 없는 등록 0건(시험) |
| O11 | 시험·문서: 브리지 응답 모형(fixture)으로 계약 시험, 구현 현황·README 갱신 | `src/lib/tongdal/*.test.ts`, `docs/IMPLEMENTATION_STATUS.md` | 전체 시험 통과 |

---

## 8. 단계별 계획 (1인 추정 약 7주)

| 단계 | 기간(추정) | 작업 | 완료 기준 |
|---|---|---|---|
| **TG0 · 선행 결정과 준비** | 0.5주 | D1~D4 결정, O0 적용, 브리지 API v1 명세를 `docs/tongdal-bridge-api.md`로 확정(두 저장소 공통 계약) | 확장 ID 고정, 명세 합의 |
| **TG1 · TONGDAL 브리지 기반** | 1.5주 | T0 T1 T2 T3 T4 T5, T11(해당분) | 확장 없이 curl로 페어링·검색 성공, 보안 시험 통과, 창 닫아도 응답 |
| **TG2 · onNara 읽기 연동** | 1.5주 | O1 O2 O3 O4 O5 O6 | 채팅·서랍·조치카드·탭에서 TONGDAL 근거 사용, 꺼짐 상태 fail-closed 확인 |
| **TG3 · 신규 등록** | 1.5주 | T6 T9 T10, O7 O10 | 문서 본문·업로드·내 참고자료 등록 → 분류 대기까지 확인, 중복 0건 |
| **TG4 · 삭제·복원** | 1주 | T7 T8, O9 (D5 결정 후) | 삭제 후 흔적 0건, 복원 후 동일 ID 재색인 |
| **TG5 · 안정화** | 1주 | 성능 측정(색인 중 채팅 지연), 보안 점검표, 문서, O8은 P5-1 일정에 맞춤 | §9 평가 기록 |

---

## 9. 시험·평가

| 항목 | 방법 | 기준 |
|---|---|---|
| 보안 | Origin 위조(`https://evil.test`), Host 위조, 토큰 없음·틀림, 지식 공간 밖 경로, `..`·예약어 파일명, 크기 초과 | 전부 거부, 감사기록 남음 |
| 검색 품질 | 기존 계획 §12의 질문 30개로 Recall@5 — TONGDAL 하이브리드 vs 확장 단독 | 결과를 `docs/eval/`에 기록, D4 재확인 |
| 컨텍스트 예산 | 긴 부모 문맥 5건을 넣은 질의 | 모델 입력 넘침 0건 |
| 등록 | 같은 파일 3회 전송, 전송 중 TONGDAL 종료 후 재시작 | 사본 0건, 메타 유실 0건 |
| 삭제 | 삭제 → 검색·그래프·제안함 확인 → 복원 | 흔적 0건 → 원상 복귀 |
| 성능 | 색인 50건 진행 중 채팅 첫 토큰 시간 | 기준값 대비 지연을 기록하고 안내 문구 검증 |
| 장애 | Ollama 꺼짐, 사이드카 꺼짐, 지식 공간 해제 | §4.7 표시와 일치 |

---

## 10. 위험과 대응

| 위험 | 대응 |
|---|---|
| 확장 ID 변경으로 페어링이 끊기고 사용자 데이터가 분리됨 | D1 우선 적용. ID 변경 시 401 → 다시 페어링 안내 |
| 같은 PC의 다른 프로그램이 브리지에 접근 | 토큰 + Origin + Host 검사, 권한 단계, 감사기록. 삭제는 보관함 이동뿐 |
| Ollama CPU 경합(TONGDAL 색인 ↔ onNara 채팅) | 색인 중 표시. 필요하면 TG5에서 `POST /bridge/v1/indexing/pause`(채팅 중 색인 일시정지) 추가 검토 |
| 문서 ID가 경로 기반이라 TONGDAL에서 파일을 옮기면 ID가 바뀜 | 확장은 `source_documents.id` + 해시로 기억하고 매번 다시 확인. 오래된 참조는 "이동되었거나 삭제됨"으로 표시 |
| 온나라 첨부 형식(`.hwp` 등)을 TONGDAL이 읽지 못함 | D6 대체 형식 방식, P5-3 결정과 연동 |
| 두 저장소의 API 불일치 | `docs/tongdal-bridge-api.md` 단일 명세, `apiVersion` 검사, 계약 시험 fixture |
| 공문 사본이 로컬에 더 쌓임(보안 규정) | 등록은 사용자 확인 후에만, 출처 머리말로 추적, S04 도입 후 개인정보 경고 |
| 트레이 상주가 기관 PC 정책과 충돌 | 자동 시작은 기본 꺼짐, 사용자가 켬 |

---

## 11. 기존 계획서와의 관계

| 기존 항목 | 변경 |
|---|---|
| §7 업무 지식 저장소 · P4-1 | D4 결정에 따라 문서 지식은 TONGDAL로 대체한다. 확장 내부에는 대화 기억만 남긴다 |
| S05 유사 공문·처리사례 · P4-2 | 검색 백엔드를 TONGDAL로 한다(O6 조치카드 추천이 첫 구현) |
| S06 지침·업무 Q&A · P4-3 | 채팅 "내 지식 포함"(O4)이 기반이다. 판본·적용일 필터는 TONGDAL 메타데이터에 필드를 추가해 처리한다(후속) |
| P5-1 첨부 획득 | O8의 선행 조건 |
| P5-3 I4(Native Messaging) 결정 | 브리지로 로컬 보조 프로세스 역할 일부를 대신한다. `.hwp` 추출을 TONGDAL에 둘지 여기서 함께 결정한다 |
| R15 탭 구조 `현재 문서 / 작성 / 지식 검색 / 내 업무` | "지식 검색"을 `내 지식` 탭으로 구체화한다 |
| 미결 대책 A·B(확장 ID·배포) | D1·D2로 흡수해 TG0에서 결정한다 |

---

## 12. 진행 기록

### 2026-09-28 · TG1 구현 (TONGDAL.ai `main`, dd47d62)

| 작업 | 결과 | 위치 |
|---|---|---|
| T0 단일 인스턴스 | 두 번째 실행은 기존 창을 앞으로 가져옴 | `electron/main.ts` |
| T1 현재 지식 공간 | `start-raw-watcher` 성공 시 기록, `reset-knowledge-root`에서 해제. 저장하지 않고, 숨김 시작에서도 렌더러가 불러와 다시 연결 | `electron/knowledgeRoot.ts` |
| T2 트레이·자동 시작 | 백그라운드 실행(기본 꺼짐), 창 닫기 = 숨기기, 트레이 [열기]·[종료], 로그인 시 `--hidden` 자동 실행(설치판만) | `electron/background.ts` |
| T3 브리지 서버 | Host·Origin·토큰·권한·빈도·본문 제한, 오류 형식. Electron 없이 시험 가능 | `electron/bridge/{policy,server}.ts` |
| T4 연결 설정 화면 | 켜기, 포트, 연결 코드, 확인 창, 연결 목록·권한·해제, 백그라운드 실행 | `src/components/BridgeSettingsModal.tsx`, `electron/bridge/service.ts`, `electron/ipc/bridge.ts` |
| T5 읽기 라우트 | status, pair, search, shelves, documents, documents/{id}(+본문), documents/{id}/file, browse, open | `electron/bridge/routes.ts` |
| 사이드카 | 검색 결과에 `source_document_id`·`document_title` 추가, `GET /api/catalog/document/{id}/text` 추가 | `electron/sidecar/main.py` |
| T11 시험 | `npm run test:electron` 22건, pytest 41건(신규 4건) 통과, `npm run build` 통과 | `electron/bridge/*.test.ts`, `tests/test_bridge_endpoints.py` |
| 명세 | 두 저장소 공통 계약 | TONGDAL.ai `docs/tongdal-bridge-api.md` |

**계획과 달라진 점**
- 페어링 토큰은 암호화해 저장하지 않고 **SHA-256만** 저장한다(원문이 없으므로 설정 파일을 복사해도 재사용할 수 없다).
- 감사기록은 `.myexplorer/`가 아니라 `userData/onnara-bridge-audit.jsonl`에 둔다. 페어링은 지식 공간이 아니라 PC 단위이기 때문이다. 등록·삭제 기록을 지식 공간에도 남길지는 TG3에서 정한다.
- `open`은 창을 띄우는 부작용이 있으므로 `POST /bridge/v1/open`으로 정했다.
- v1 페어링은 **`read`만** 준다(계획은 read·write). 등록 기능이 나와도 기존 연결에 자동 부여하지 않는다.
- 검색의 `shelfId` 필터는 v1에서 뺐다(사이드카 검색이 분류를 모른다).

**아직 확인하지 못한 것**
- 실제 창에서의 페어링(코드 발급 → 확인 창 → 토큰 발급)과 트레이 동작. 화면 조작 권한이 없어 사용자 확인이 필요하다. 개발 모드 실행 시 새 코드가 오류 없이 시작되고, 기본값(꺼짐)에서 포트가 열리지 않는 것까지는 확인했다.

### 2026-09-28 · TG2 구현 (onNara.sAIde `main`, 미커밋)

| 작업 | 결과 | 위치 |
|---|---|---|
| O1 클라이언트 | 요청·시간 제한·취소, 오류 코드 전달, 401이면 토큰 삭제, 상태 판정 7종, 화면 훅 | `src/lib/tongdal/{client,connection,status,types,useTongdal}.ts` |
| O2 연동 설정 | 주소(이 PC만), 연결 코드, 허용 대기, 상태·권한, 해제. 토큰은 백업·복원에서 제외 | `options/TongdalSettings.tsx`, `lib/storage/backup.ts` |
| O3 내 지식 탭 | 연결 시에만 보이는 탭. 검색·분류·본문 미리보기·TONGDAL에서 열기·AI에게 묻기 | `sidepanel/components/KnowledgePanel.tsx` |
| O4 채팅 근거 | "내 지식" 토글. 근거는 마지막 사용자 턴에만, 예산 안에서, `[n]` 출처 카드 저장, 실패는 안내로 | `lib/tongdal/{chat-knowledge,evidence}.ts`, `lib/prompts/knowledge.ts`, `lib/chat/store.ts` |
| O5 기안 서랍 | "TONGDAL 서고" 묶음, 고르면 본문을 받아 초안 참고자료로 | `drawer-page/components/TongdalRefGroup.tsx`, `DrawerApp.tsx` |
| O6 조치카드 | "관련 내 자료" 최대 3건(질의는 공문 제목) | `sidepanel/components/RelatedKnowledge.tsx` |
| O11 시험 | 신규 23건 포함 1152건 통과, `tsc`·빌드·대비 검사 통과 | `lib/tongdal/tongdal.test.ts` 등 |

**계획과 달라진 점**
- 빌드 기본 주소는 `.env`의 `WXT_TONGDAL_BRIDGE_URL`로 바꿀 수 있게 했지만 `.env.example`에는 넣지 않았다(기본값으로 충분).
- 내 지식 탭의 [내 참고자료로 가져오기]는 빼고, 기안 서랍에서 TONGDAL 문서를 바로 고르게 했다(같은 목적, 사본을 만들지 않음).
- "내 지식"은 에이전트 모드와 함께 쓰지 않는다. 도구 스키마와 근거가 같은 컨텍스트 예산을 다툰다.

**아직 확인하지 못한 것**
- 실제 Edge 확장 + 실행 중인 TONGDAL.ai로 페어링 → 검색 → 채팅 근거까지의 종단 확인. 확장 ID가 경로에서 나오므로(D1 미결) 페어링 뒤 폴더를 옮기면 다시 연결해야 한다.
