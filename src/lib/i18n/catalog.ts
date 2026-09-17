/**
 * UI 문자열 카탈로그. 계획서 §5 Phase 7-4
 *
 * ★ 여기 없는 문자열이 화면에 직접 박히면 안 된다.
 *   완결성은 catalog.test.ts가 지킨다 — ko와 en의 키 집합이 다르면 실패한다.
 *
 * ★ 모델에게 보내는 프롬프트는 여기 넣지 않는다.
 *   prompts/ 쪽 문자열은 KV 캐시 접두사를 이루므로 성격이 다르다. 응답 언어를
 *   정하는 한 줄만 로케일을 따르고, 나머지는 prompts/system.ts가 관리한다.
 *
 * 자리표시자는 `{name}` 형식이다. 예: '앞부분 {pct}%만 읽음'
 */

const ko = {
  /* ── 공통 ── */
  'ui.retry': '다시 확인',
  'ui.close': '닫기',
  'ui.copy': '복사',
  'ui.copied': '복사됨',
  'ui.delete': '삭제',
  'ui.settings': '설정',
  'ui.openSettings': '설정 열기',
  'ui.grantPermission': '권한 허용',
  'ui.resolve': '해결',
  'ui.unknown': '(알 수 없음)',

  /* ── 오류 (lib/errors/describe.ts) ── */
  'err.down.title': 'Ollama가 실행 중이 아닙니다',
  'err.down.body':
    '설정한 주소의 Ollama를 시작한 뒤 다시 시도하세요. 기본 연결 주소는 이 컴퓨터의 localhost입니다.',
  'err.cors.title': 'Ollama가 확장의 요청을 거부하고 있습니다',
  'err.cors.body':
    '아래 명령을 PowerShell에서 실행한 뒤, 트레이의 Ollama를 완전히 종료했다가 다시 시작하세요.',
  'err.model.title': "모델 '{model}'이 설치되어 있지 않습니다",
  'err.model.titleGeneric': '모델이 설치되어 있지 않습니다',
  'err.model.body': '아래 명령으로 내려받은 뒤 다시 확인하세요.',
  'err.oom.title': '모델을 올릴 메모리가 부족합니다',
  'err.oom.body':
    '설정에서 컨텍스트 길이(num_ctx)를 줄이거나, 메모리를 많이 쓰는 다른 프로그램을 종료한 뒤 다시 시도하세요.',
  'err.timeout.title': '응답이 오지 않아 중단했습니다',
  'err.timeout.body':
    '이 컴퓨터는 CPU로 추론하기 때문에 긴 페이지에서 느려질 수 있습니다. 페이지 분량을 줄이거나 질문을 짧게 나눠 보세요.',
  'err.aborted.title': '중단했습니다',
  'err.restricted.title': '이 페이지에서는 내용을 읽을 수 없습니다',
  'err.restricted.body':
    'chrome:// 페이지와 크롬 웹스토어에서는 브라우저가 확장 스크립트 실행을 금지합니다. 일반 웹페이지에서 다시 시도하세요.',
  'err.hostPerm.title': '이 사이트에 접근할 권한이 없습니다',
  'err.hostPerm.body':
    '설치할 때는 아무 사이트 권한도 받지 않기 때문에, 필요한 순간에만 요청합니다. 허용하면 이 사이트에서만 동작합니다.',
  'err.denied.title': '동작을 실행하지 않았습니다',
  'err.denied.body': '승인되지 않아 페이지를 건드리지 않았습니다.',
  'err.unknown.title': '문제가 발생했습니다',
  'err.unknown.body': '알 수 없는 오류입니다.',
  'err.embedFailed': '임베딩에 실패했습니다 (HTTP {status})',
  'err.close': '오류 닫기',

  /* ── 권한 요청 (App) ── */
  'perm.page.denied': '이 사이트의 내용을 읽으려면 접근 권한이 필요합니다.',
  'perm.capture.denied':
    '화면 캡처는 모든 사이트에 대한 접근 권한이 필요합니다. 크롬이 캡처 기능에 한해 사이트별 권한을 받아주지 않기 때문입니다. 허용하지 않으시려면 대신 "이 페이지 요약"으로 본문을 읽을 수 있습니다.',

  /* ── 헬스 배너 ── */
  'health.cold.title': '모델을 메모리에 올리는 중입니다',
  'health.cold.gpu': '첫 응답까지 잠시 걸립니다.',
  'health.cold.cpu': '첫 응답까지 약 20초 걸립니다. 이후에는 빨라집니다.',
  'health.model.size': '약 7.2GB입니다.',
  'health.warming': '모델 준비 중',
  'health.aboutSec': '약 {sec}초',

  /* ── 패널 ── */
  'panel.conversations': '대화 목록',
  'panel.empty.ready': '무엇을 도와드릴까요?',
  'panel.empty.readyBody':
    '설정한 Ollama 모델로 돕는 AI 조력자입니다. 기본값은 이 컴퓨터의 로컬 서버입니다.',
  'panel.empty.body': '내 컴퓨터에서만 도는 AI 브라우저 조력자. 인터넷 없이 작동합니다.',
  'panel.generating': '생성 중',
  'panel.readingPage': '페이지 읽는 중',
  'panel.elapsedSec': '{sec}초',
  'panel.regenerate': '다시 생성',
  'panel.regenerateHint': '마지막 답변을 다시 생성합니다',
  'panel.attachPage': '페이지 붙이기',
  'panel.attachPageHint': '현재 페이지 본문을 대화에 붙입니다 (약 {sec}초)',
  'panel.attachScreen': '화면 붙이기',
  'panel.attachScreenHint': '현재 화면을 캡처해 대화에 붙입니다 (약 5초)',
  'panel.reading': '읽는 중…',
  'panel.secShort': '{sec}초',

  /* ── 에이전트 ── */
  'agent.toggleOn': '에이전트 모드 — 페이지를 직접 읽고 조작합니다. 클릭·입력·이동은 승인을 거칩니다.',
  'agent.toggleOff': '에이전트 모드 끄기',
  'agent.turn': '에이전트 {turn}/{max}턴',
  'agent.label': '에이전트',
  'agent.on': '켜짐',
  'agent.approval.title': '동작 승인 요청',
  'agent.steps.show': '결과 보기',
  'agent.approval.ask': '이 동작을 실행할까요?',
  'agent.approval.target': '대상',
  'agent.approval.page': '페이지',
  'agent.approval.deny': '거부',
  'agent.approval.allow': '승인하고 실행',
  'agent.steps.choosing': '다음 동작을 고르는 중…',
  'agent.steps.approved': '승인됨',
  'agent.steps.denied': '거부됨',
  'agent.steps.sec': '{sec}초',
  'conv.title': '대화',
  'msg.charCount': '{n}자',

  /* ── 메시지 ── */
  'msg.thinking': '생각하는 중…',
  'msg.thoughts': '생각 과정',
  'msg.generating': '응답 생성 중',
  'msg.coldStart': ' · 콜드 스타트',
  'msg.aborted': '여기서 중단했습니다.',

  /* ── 페이지 첨부 ── */
  'page.method.readability': '본문',
  'page.method.innerText': '화면 텍스트',
  'page.method.youtube': '자막',
  'page.detach': '페이지 떼어내기',
  'page.truncated': '앞부분 {pct}%만 읽음',
  'page.tokens': '{n}토큰',
  'page.screenshot': '화면 캡처',
  'page.screenshotAlt': '붙인 화면 캡처',
  'page.screenshotDetach': '화면 캡처 떼어내기',
  'page.attached': '이 페이지에 대해 계속 물어볼 수 있습니다. 후속 질문은 빠릅니다.',
  'page.costHint': '본문을 읽는 데 약 {sec}초, 화면 캡처는 약 5초 걸립니다.',
  'page.reading': '페이지를 읽는 중…',
  'page.restricted':
    '이 페이지에서는 내용을 읽을 수 없습니다. 일반 웹페이지에서 다시 시도하세요.',
  'page.truncateNotice': '본문이 길어 앞부분 {pct}%만 참조했습니다.',
  'page.staleNotice':
    '페이지가 바뀌어 이전 본문을 떼어냈습니다. 현재 페이지 내용은 참조하지 않았습니다.',

  /* ── 대화 목록 ── */
  'conv.empty': '저장된 대화가 없습니다.',
  'conv.deleteOne': '{title} 삭제',
  'conv.confirmDelete': '“{title}” 대화를 삭제할까요? 삭제 후 복구할 수 없습니다.',
  'conv.localHost': '로컬',
  'conv.unknownHost': '알 수 없음',
  'conv.justNow': '방금',
  'conv.minAgo': '{n}분 전',
  'conv.hourAgo': '{n}시간 전',
  'conv.dayAgo': '{n}일 전',
  'conv.newChat': '새 대화',

  /* ── 입력창 ── */
  'composer.blocked': 'Ollama 연결을 먼저 확인하세요',
  'composer.agent': '무엇을 해 드릴까요?  (페이지를 직접 조작합니다)',
  'composer.normal': '무엇이든 물어보세요  ( / 로 명령 )',
  'composer.label': '메시지 입력',
  'composer.stop': '생성 중단',
  'composer.stopShort': '중단',
  'composer.send': '보내기',
  'composer.sendHint': '보내기 (Enter)',
  'composer.commands': '명령 목록',
  'composer.needsPage': '페이지',
  'composer.needsScreen': '화면',

  /* ── 기억 (Phase 6) ── */
  'mem.h': '기억',
  'mem.enable': '읽은 페이지 기억하기',
  'mem.enableDesc':
    '읽은 페이지를 이 컴퓨터에 저장해 나중에 찾아봅니다. 임베딩할 본문은 설정한 Ollama 서버로 전송하므로, 원격 주소를 사용하면 그 서버에도 전달됩니다.',
  'mem.scopeDesc':
    'sAIde가 **실제로 읽은 페이지만** 기억합니다. 그냥 방문한 페이지는 기억하지 않습니다 — 모든 페이지를 들여다보려면 상시 접근 권한이 필요한데, 그렇게 만들지 않았습니다.',
  'mem.stored': '저장된 기억',
  'mem.count': '{pages}개 페이지 · {chunks}조각',
  'mem.oldest': '가장 오래된 기록: {date}',
  'mem.retention': '보관 기간',
  'mem.retention.days': '{n}일',
  'mem.retention.forever': '계속 보관',
  'mem.retentionDesc': '기간이 지난 기억은 검색에서 제외하고, 기억을 켠 상태로 패널을 열 때 지웁니다.',
  'mem.excluded': '기억하지 않을 도메인',
  'mem.excludedPlaceholder': '예: bank.co.kr',
  'mem.excludedDesc':
    '하위 도메인까지 함께 제외합니다. 추가하면 그 도메인의 기존 기억도 함께 지웁니다.',
  'mem.excludedNone': '아직 없습니다.',
  'mem.add': '추가',
  'mem.clear': '기억 전체 삭제',
  'mem.clearConfirm': '되돌릴 수 없습니다. 정말 지울까요?',
  'mem.clearYes': '전체 삭제',
  'mem.clearNo': '취소',

  /* ── 기억 검색 (사이드패널) ── */
  'mem.search.title': '기억에서 찾기',
  'mem.search.hint': '전에 읽은 페이지에서 찾기',
  'mem.search.empty': '기억해 둔 페이지가 없습니다.',
  'mem.search.none': '비슷한 페이지를 찾지 못했습니다.',
  'mem.search.searching': '찾는 중…',
  'mem.search.score': '유사도 {n}%',
  'mem.search.disabled': '설정에서 기억하기를 켜야 검색할 수 있습니다.',

  /* ── 설정 화면 (options) ── */
  /* ── 액션 결과 (injected.ts가 코드로 돌려준 것) ── */
  //  ★ 이 문구들은 화면(실행 단계)과 모델(툴 결과) 양쪽으로 간다.
  'act.found': '찾음: {target}',
  'act.scrolled': '{direction} 방향으로 스크롤했습니다.',
  'act.clicked': '클릭했습니다: {target}',
  'act.typed': '입력했습니다: {target}',
  'act.navigated': '{url} 로 이동했습니다.',
  'act.notFound': "'{query}'에 해당하는 요소를 찾지 못했습니다.",
  'act.noElement': '선택자에 맞는 요소가 없습니다: {selector}',
  'act.notTextInput': '{target} 는 글자를 넣을 수 있는 요소가 아닙니다.',
  'act.wrongRoute': 'navigate는 주입 스크립트에서 처리하지 않습니다.',

  /* ── 실행기 (executor.ts) ── */
  //  ★ 모델에게 가는 문장이라 해라체를 쓴다. 화면 문구와 어조가 다른 것은 의도다.
  'exec.noTab': '지금 조작할 수 있는 탭이 없다.',
  'exec.tabsFailed': '탭 목록을 가져오지 못했다.',
  'exec.captured': '화면을 캡처했다.',
  'exec.captureFailed': '화면을 캡처하지 못했다.',
  'exec.unknownAction': '알 수 없는 동작이다.',
  'exec.actionFailed': '동작을 수행하지 못했다.',
  'exec.currentTab': ' (현재 탭)',
  'exec.moreTabs': '… 외 {n}개',

  'sw.extractFailed': '페이지 내용을 가져오지 못했습니다.',
  'sw.actionFailed': '동작을 수행하지 못했습니다.',
  'sw.badUrl': '이동할 수 없는 주소입니다: {url}',
  'sw.badScheme': '허용되지 않는 주소 형식입니다: {scheme}',
  'sw.badSchemeHint': 'http 또는 https 주소로만 이동할 수 있습니다.',

  'panel.restrictedHint':
    '이 페이지에서는 내용을 읽을 수 없습니다. 일반 웹페이지에서 다시 시도하세요.',

  'opt.title': '설정',

  'opt.conn.h': '연결',
  'opt.conn.endpoint': 'Ollama 엔드포인트',
  'opt.conn.endpointDesc': '기본값은 이 컴퓨터의 Ollama입니다. 원격 주소를 입력하면 대화·첨부·임베딩 요청이 해당 서버로 전송됩니다.',
  'opt.conn.model': '모델',
  'opt.conn.check': '연결 확인',
  'opt.conn.failed': '연결 실패',
  'opt.conn.ok': 'Ollama {version} · 모델 {count}개',
  'opt.conn.resident': ' · 상주 중 ({processor})',
  'opt.conn.embed': '임베딩 모델',
  'opt.conn.embedDesc': '기억·검색 기능에서만 사용합니다. bge-m3는 한국어 검색 품질이 좋습니다.',

  'opt.perf.h': '성능',
  'opt.perf.think': '추론 과정(thinking)',
  'opt.perf.think.off': '끄기 — 가장 빠름',
  'opt.perf.think.agent': '에이전트에서만 (권장)',
  'opt.perf.think.always': '항상 켜기',
  'opt.perf.thinkDesc':
    '모델이 답하기 전에 생각을 적는 기능입니다. 개발 당시 CPU 실험에서는 응답이 **약 6배 느렸습니다**. 속도와 정확도는 모델·장비·질문에 따라 달라집니다.',
  'opt.perf.budget': '페이지 본문 분량',
  'opt.perf.budgetVal': '{n} 토큰',
  'opt.perf.budgetCost': '한국어 약 {chars}자 · 답변 시작까지 약 **{sec}초**',
  'opt.perf.budgetTooLong': ' — 실사용에는 너무 깁니다',
  'opt.perf.budgetDesc': '이 분량을 넘는 페이지는 앞부분만 읽고, 그 사실을 화면에 알립니다.',
  'opt.perf.ctx': '컨텍스트 길이 (num_ctx)',
  'opt.perf.ctxDesc':
    '대화 전체가 들어갈 수 있는 최대 크기입니다. 꽉 채우면 답변 시작까지 약 {sec}초 걸립니다. 값을 바꾸면 모델이 다시 로드되므로 잠시 느려집니다.',
  'opt.perf.keep': '모델 유지 시간',
  'opt.perf.keep.5m': '5분',
  'opt.perf.keep.10m': '10분 (권장)',
  'opt.perf.keep.30m': '30분',
  'opt.perf.keep.forever': '계속 유지',
  'opt.perf.keepDesc':
    '길게 잡으면 응답이 빠르지만 메모리를 계속 차지합니다(약 7GB). 16GB 컴퓨터에서는 10분이 적당합니다.',
  'opt.perf.warm': '패널을 열 때 미리 준비',
  'opt.perf.warmDesc':
    '모델을 미리 메모리에 올려 첫 응답을 앞당깁니다. 끄면 첫 질문에서 약 20초를 기다리게 됩니다.',
  'opt.perf.tempDesc': '낮을수록 일관되고, 높을수록 다양한 답을 냅니다.',

  'opt.agent.h': '에이전트',
  'opt.agent.enable': '에이전트 모드 사용',
  'opt.agent.enableDesc':
    '입력창 옆의 **에이전트** 버튼이 보입니다. 켜면 sAIde가 페이지를 직접 읽고 스크롤하며, 필요하면 클릭·입력·이동을 **제안**합니다.',
  'opt.agent.approvalDesc':
    '클릭·입력·주소 이동은 **매번 승인을 거칩니다.** 자동 승인이나 "다시 묻지 않기"는 일부러 만들지 않았습니다 — 페이지에 숨겨진 지시문으로부터 지켜 주는 마지막 장치이기 때문입니다.',
  'opt.agent.turns': '최대 턴 수',
  'opt.agent.turnsVal': '{n}턴',
  'opt.agent.turnsDesc':
    '한 턴에 약 25초가 걸리므로 최악의 경우 약 **{min}분**까지 돌 수 있습니다. 중간에 언제든 중단할 수 있습니다.',
  'opt.agent.idle': '무응답 대기 한도',
  'opt.agent.idleSec': '{n}초',
  'opt.agent.idleSecRec': '{n}초 (권장)',
  'opt.agent.idleDesc':
    '한 턴이 이 시간 동안 아무것도 내놓지 못하면 멈춥니다. 글자가 나오는 동안에는 시간이 다시 초기화되므로, 느리게라도 답하고 있으면 끊기지 않습니다.',

  'opt.access.h': '페이지 접근',
  'opt.access.intro':
    'sAIde는 설치할 때 어떤 사이트 권한도 갖지 않습니다. "이 페이지 요약" 같은 기능을 처음 쓸 때 그 사이트에 한해 권한을 요청합니다. 아래에서 한 번에 허용하거나 언제든 회수할 수 있습니다.',
  'opt.access.all': '모든 사이트에서 허용',
  'opt.access.allDesc':
    '켜면 사이트마다 묻지 않습니다. 읽거나 첨부한 내용은 설정한 Ollama 서버에서 처리합니다.',
  'opt.access.captureDesc':
    '**화면 캡처 기능은 이 권한이 반드시 필요합니다.** 크롬이 캡처에 한해 사이트별 권한을 받아주지 않기 때문입니다. 본문 읽기는 사이트별 권한만으로 동작합니다.',
  'opt.access.granted': '허용된 사이트',
  'opt.access.count': '{n}곳',
  'opt.access.none': '아직 없습니다.',
  'opt.access.revoke': '회수',

  'opt.display.h': '표시',
  'opt.display.theme': '테마',
  'opt.display.theme.system': '시스템 설정 따르기',
  'opt.display.theme.light': '밝게',
  'opt.display.theme.dark': '어둡게',
  'opt.display.locale': '언어 · Language',
  'opt.display.localeDesc':
    '사이드패널 화면과 모델의 답변 언어가 함께 바뀝니다. 확장 이름과 우클릭 메뉴는 브라우저 언어를 따릅니다.',

  'opt.reset': '기본값으로 되돌리기',
  'opt.resetDesc':
    '기본값과 대기시간 예측은 개발 당시 CPU 측정(프리필 {rate} tok/s) 기준입니다. 현재 장비의 보장값은 아닙니다.',

  /* ── 성능 대시보드 ── */
  'perf.h': '성능 기록',
  'perf.empty':
    '아직 기록이 없습니다. 대화를 몇 번 나누면 이곳에 실제 응답 속도가 쌓이고, 계획서가 정한 목표와 나란히 비교됩니다.',
  'perf.intro':
    '최근 {total}건의 실제 응답에서 잰 값입니다. 콜드 스타트 {cold}건은 목표 대조에서 제외했습니다(모델을 처음 올리는 시간이라 매번 겪는 지연이 아닙니다).',
  'perf.bucket.short': '짧은 대화',
  'perf.bucket.selection': '선택 텍스트',
  'perf.bucket.page': '페이지 작업',
  'perf.bucket.huge': '대용량',
  'perf.col.bucket': '작업 구간',
  'perf.col.count': '건수',
  'perf.col.median': '첫 토큰(중앙값)',
  'perf.col.target': '목표',
  'perf.sec': '{n}초',
  'perf.miss': ' 초과',
  'perf.meet': ' 달성',
  'perf.prefill': '프리필',
  'perf.decode': '생성',
  'perf.base': ' 기준 {n}',
  'perf.tokensIn': '읽은 토큰',
  'perf.tokensOut': '생성한 토큰',
  'perf.fasterHw':
    '프리필이 기준선의 3배를 넘습니다. GPU가 붙은 것으로 보입니다 — 페이지 본문 분량과 컨텍스트 길이를 늘려도 실용 범위에 들어옵니다.',
  'perf.refresh': '새로고침',

  /* ── 프리셋 편집 ── */
  'preset.h': '내 프리셋',
  'preset.intro':
    '자주 쓰는 프롬프트를 슬래시 커맨드로 등록합니다. 사이드패널 입력창에 / 를 치면 목록이 뜹니다. 본문에 {selection}을 넣으면 커맨드 뒤에 입력한 내용이 그 자리에 들어갑니다.',
  'preset.needs.none': '첨부 없음',
  'preset.needs.page': '페이지 본문 필요',
  'preset.needs.screen': '화면 캡처 필요',
  'preset.needs.selection': '입력한 텍스트 대상',
  'preset.delete': '삭제',
  'preset.label': '이름',
  'preset.labelPlaceholder': '예: 회의록 정리',
  'preset.slash': '명령어',
  'preset.conflict': ' — 같은 이름이 있습니다. 저장하면 덮어씁니다.',
  'preset.willSave': ' 로 저장됩니다.',
  'preset.needs': '필요한 첨부',
  'preset.needsDesc':
    "'페이지 본문 필요'를 고르면 명령 실행 시 본문을 먼저 읽습니다(약 15초). '화면 캡처'는 약 5초로 더 빠릅니다.",
  'preset.body': '본문',
  'preset.bodyPlaceholder': '다음 회의록에서 결정 사항과 할 일만 뽑아줘.\n\n{selection}',
  'preset.add': '추가',
} as const;

export type MessageKey = keyof typeof ko;

const en = {
  'ui.retry': 'Check again',
  'ui.close': 'Close',
  'ui.copy': 'Copy',
  'ui.copied': 'Copied',
  'ui.delete': 'Delete',
  'ui.settings': 'Settings',
  'ui.openSettings': 'Open settings',
  'ui.grantPermission': 'Grant access',
  'ui.resolve': 'Fix',
  'ui.unknown': '(unknown)',

  'err.down.title': 'Ollama is not running',
  'err.down.body':
    'Start Ollama and try again. sAIde connects to Ollama on this computer, not to the internet.',
  'err.cors.title': 'Ollama is refusing requests from this extension',
  'err.cors.body':
    'Run the command below in PowerShell, then quit Ollama from the tray and start it again.',
  'err.model.title': "The model '{model}' is not installed",
  'err.model.titleGeneric': 'The model is not installed',
  'err.model.body': 'Download it with the command below, then check again.',
  'err.oom.title': 'Not enough memory to load the model',
  'err.oom.body':
    'Reduce the context length (num_ctx) in settings, or close other memory-heavy programs and try again.',
  'err.timeout.title': 'Stopped — no response came back',
  'err.timeout.body':
    'This computer runs inference on the CPU, so long pages can be slow. Try a smaller page budget or shorter questions.',
  'err.aborted.title': 'Stopped',
  'err.restricted.title': "This page's contents can't be read",
  'err.restricted.body':
    'Chrome blocks extension scripts on chrome:// pages and the Web Store. Try again on a regular web page.',
  'err.hostPerm.title': 'No permission to access this site',
  'err.hostPerm.body':
    'sAIde takes no site permissions at install time, so it asks only when needed. Granting applies to this site only.',
  'err.denied.title': 'The action was not performed',
  'err.denied.body': 'It was not approved, so the page was left untouched.',
  'err.unknown.title': 'Something went wrong',
  'err.unknown.body': 'An unknown error occurred.',
  'err.embedFailed': 'Embedding failed (HTTP {status})',
  'err.close': 'Dismiss error',

  'perm.page.denied': 'Reading this site requires access permission.',
  'perm.capture.denied':
    'Screen capture requires access to all sites, because Chrome does not accept per-site permission for capture. If you prefer not to grant it, use "Summarize this page" to read the text instead.',

  'health.cold.title': 'Loading the model into memory',
  'health.cold.gpu': 'The first response will take a moment.',
  'health.cold.cpu': 'The first response takes about 20 seconds. It gets faster after that.',
  'health.model.size': 'About 7.2 GB.',
  'health.warming': 'Preparing the model',
  'health.aboutSec': 'about {sec}s',

  'panel.conversations': 'Conversations',
  'panel.empty.ready': 'How can I help?',
  'panel.empty.readyBody':
    'An AI aide using your configured Ollama model. The default is a local server on this computer.',
  'panel.empty.body': 'An AI browser aide that runs on your machine. Works without internet.',
  'panel.generating': 'Generating',
  'panel.readingPage': 'Reading the page',
  'panel.elapsedSec': '{sec}s',
  'panel.regenerate': 'Regenerate',
  'panel.regenerateHint': 'Generate the last answer again',
  'panel.attachPage': 'Attach page',
  'panel.attachPageHint': "Attach this page's text to the conversation (about {sec}s)",
  'panel.attachScreen': 'Attach screen',
  'panel.attachScreenHint': 'Capture the current screen and attach it (about 5s)',
  'panel.reading': 'Reading…',
  'panel.secShort': '{sec}s',

  'agent.toggleOn':
    'Agent mode — reads and operates the page directly. Clicks, typing and navigation need your approval.',
  'agent.toggleOff': 'Turn off agent mode',
  'agent.turn': 'Agent turn {turn}/{max}',
  'agent.label': 'Agent',
  'agent.on': 'on',
  'agent.approval.title': 'Approval required',
  'agent.steps.show': 'Show result',
  'agent.approval.ask': 'Run this action?',
  'agent.approval.target': 'Target',
  'agent.approval.page': 'Page',
  'agent.approval.deny': 'Deny',
  'agent.approval.allow': 'Approve and run',
  'agent.steps.choosing': 'Choosing the next action…',
  'agent.steps.approved': 'approved',
  'agent.steps.denied': 'denied',
  'agent.steps.sec': '{sec}s',
  'conv.title': 'Chats',
  'msg.charCount': '{n} chars',

  'msg.thinking': 'Thinking…',
  'msg.thoughts': 'Thoughts',
  'msg.generating': 'Generating response',
  'msg.coldStart': ' · cold start',
  'msg.aborted': 'Stopped here.',

  'page.method.readability': 'Article',
  'page.method.innerText': 'Screen text',
  'page.method.youtube': 'Captions',
  'page.detach': 'Detach page',
  'page.truncated': 'first {pct}% only',
  'page.tokens': '{n} tokens',
  'page.screenshot': 'Screen capture',
  'page.screenshotAlt': 'Attached screen capture',
  'page.screenshotDetach': 'Detach screen capture',
  'page.attached': 'You can keep asking about this page. Follow-up questions are fast.',
  'page.costHint': 'Reading the text takes about {sec}s; a screen capture about 5s.',
  'page.reading': 'Reading the page…',
  'page.restricted': "This page's contents can't be read. Try a regular web page.",
  'page.truncateNotice': 'The page was long, so only the first {pct}% was used.',
  'page.staleNotice':
    'The page changed, so the previous text was detached. The current page was not used.',

  'conv.empty': 'No saved conversations.',
  'conv.deleteOne': 'Delete {title}',
  'conv.confirmDelete': 'Delete “{title}”? This cannot be undone.',
  'conv.localHost': 'local',
  'conv.unknownHost': 'unknown',
  'conv.justNow': 'just now',
  'conv.minAgo': '{n} min ago',
  'conv.hourAgo': '{n} h ago',
  'conv.dayAgo': '{n} d ago',
  'conv.newChat': 'New chat',

  'composer.blocked': 'Check the Ollama connection first',
  'composer.agent': 'What should I do?  (operates the page directly)',
  'composer.normal': 'Ask me anything  ( / for commands )',
  'composer.label': 'Message input',
  'composer.stop': 'Stop generating',
  'composer.stopShort': 'Stop',
  'composer.send': 'Send',
  'composer.sendHint': 'Send (Enter)',
  'composer.commands': 'Command list',
  'composer.needsPage': 'page',
  'composer.needsScreen': 'screen',

  /* ── Memory ── */
  'mem.h': 'Memory',
  'mem.enable': 'Remember pages I read',
  'mem.enableDesc':
    'Stores pages on this computer for later search. Text for embeddings is sent to your configured Ollama server, including a remote server if you choose one.',
  'mem.scopeDesc':
    'Only pages sAIde **actually read** are remembered. Pages you merely visited are not — seeing every page would require standing access, and this extension does not ask for it.',
  'mem.stored': 'Stored',
  'mem.count': '{pages} pages · {chunks} chunks',
  'mem.oldest': 'Oldest entry: {date}',
  'mem.retention': 'Keep for',
  'mem.retention.days': '{n} days',
  'mem.retention.forever': 'Keep indefinitely',
  'mem.retentionDesc': 'Expired entries are excluded from search and removed when the panel opens with memory enabled.',
  'mem.excluded': 'Domains never to remember',
  'mem.excludedPlaceholder': 'e.g. bank.com',
  'mem.excludedDesc':
    'Subdomains are excluded too. Adding one also deletes what is already stored for it.',
  'mem.excludedNone': 'None yet.',
  'mem.add': 'Add',
  'mem.clear': 'Delete all memory',
  'mem.clearConfirm': 'This cannot be undone. Delete everything?',
  'mem.clearYes': 'Delete all',
  'mem.clearNo': 'Cancel',

  /* ── Memory search ── */
  'mem.search.title': 'Search memory',
  'mem.search.hint': 'Search pages you read before',
  'mem.search.empty': 'No pages remembered yet.',
  'mem.search.none': 'No similar page found.',
  'mem.search.searching': 'Searching…',
  'mem.search.score': '{n}% match',
  'mem.search.disabled': 'Turn on memory in settings to search it.',

  /* ── Settings screen ── */
  /* ── Action results ── */
  'act.found': 'Found: {target}',
  'act.scrolled': 'Scrolled {direction}.',
  'act.clicked': 'Clicked: {target}',
  'act.typed': 'Typed into: {target}',
  'act.navigated': 'Navigated to {url}.',
  'act.notFound': "No element matching '{query}' was found.",
  'act.noElement': 'No element matches that selector: {selector}',
  'act.notTextInput': '{target} is not something text can be typed into.',
  'act.wrongRoute': 'navigate is not handled by the injected script.',

  /* ── Executor ── */
  'exec.noTab': 'There is no tab available to work on right now.',
  'exec.tabsFailed': 'Could not get the tab list.',
  'exec.captured': 'Captured the screen.',
  'exec.captureFailed': 'Could not capture the screen.',
  'exec.unknownAction': 'That action is not recognized.',
  'exec.actionFailed': 'Could not carry out the action.',
  'exec.currentTab': ' (current tab)',
  'exec.moreTabs': '… and {n} more',

  'sw.extractFailed': 'Could not read the page content.',
  'sw.actionFailed': 'Could not carry out the action.',
  'sw.badUrl': 'That address cannot be opened: {url}',
  'sw.badScheme': 'That address type is not allowed: {scheme}',
  'sw.badSchemeHint': 'Only http and https addresses can be opened.',

  'panel.restrictedHint':
    'This page cannot be read. Try again on a regular web page.',

  'opt.title': 'Settings',

  'opt.conn.h': 'Connection',
  'opt.conn.endpoint': 'Ollama endpoint',
  'opt.conn.endpointDesc': 'Defaults to local Ollama. A remote address sends conversations, attachments and embedding requests to that server.',
  'opt.conn.model': 'Model',
  'opt.conn.check': 'Check connection',
  'opt.conn.failed': 'Connection failed',
  'opt.conn.ok': 'Ollama {version} · {count} models',
  'opt.conn.resident': ' · resident ({processor})',
  'opt.conn.embed': 'Embedding model',
  'opt.conn.embedDesc': 'Used only for memory and search. bge-m3 handles Korean queries well.',

  'opt.perf.h': 'Performance',
  'opt.perf.think': 'Reasoning (thinking)',
  'opt.perf.think.off': 'Off — fastest',
  'opt.perf.think.agent': 'Agent only (recommended)',
  'opt.perf.think.always': 'Always on',
  'opt.perf.thinkDesc':
    'Lets the model write its reasoning first. A development CPU experiment was **about 6x slower**. Speed and accuracy depend on the model, hardware and question.',
  'opt.perf.budget': 'Page text budget',
  'opt.perf.budgetVal': '{n} tokens',
  'opt.perf.budgetCost': 'about {chars} characters · first token in about **{sec}s**',
  'opt.perf.budgetTooLong': ' — too long to be practical',
  'opt.perf.budgetDesc': 'Pages longer than this are read from the top only, and the panel says so.',
  'opt.perf.ctx': 'Context length (num_ctx)',
  'opt.perf.ctxDesc':
    'The most that can fit in one conversation. Filling it costs about {sec}s before the first token. Changing this reloads the model, so it will be slow for a moment.',
  'opt.perf.keep': 'Keep model loaded',
  'opt.perf.keep.5m': '5 minutes',
  'opt.perf.keep.10m': '10 minutes (recommended)',
  'opt.perf.keep.30m': '30 minutes',
  'opt.perf.keep.forever': 'Indefinitely',
  'opt.perf.keepDesc':
    'Longer means faster replies but the model holds about 7GB of memory. On a 16GB machine, 10 minutes is a good balance.',
  'opt.perf.warm': 'Warm up when the panel opens',
  'opt.perf.warmDesc':
    'Loads the model ahead of time so the first reply starts sooner. With this off, expect about 20s on your first question.',
  'opt.perf.tempDesc': 'Lower is more consistent; higher is more varied.',

  'opt.agent.h': 'Agent',
  'opt.agent.enable': 'Enable agent mode',
  'opt.agent.enableDesc':
    'Shows the **Agent** button next to the composer. sAIde will read and scroll the page itself, and **propose** clicks, typing, and navigation when needed.',
  'opt.agent.approvalDesc':
    'Clicks, typing, and navigation **always go through approval.** There is deliberately no auto-approve and no "do not ask again" — this is the last thing standing between you and instructions hidden in a page.',
  'opt.agent.turns': 'Maximum turns',
  'opt.agent.turnsVal': '{n} turns',
  'opt.agent.turnsDesc':
    'At about 25s per turn, the worst case runs for about **{min} minutes**. You can stop it at any point.',
  'opt.agent.idle': 'Silence before giving up',
  'opt.agent.idleSec': '{n}s',
  'opt.agent.idleSecRec': '{n}s (recommended)',
  'opt.agent.idleDesc':
    'A turn stops if it produces nothing for this long. The clock resets while text is arriving, so a slow answer is never cut off.',

  'opt.access.h': 'Page access',
  'opt.access.intro':
    'sAIde installs with no site access at all. The first time you use something like "Summarize this page", it asks for that one site. You can grant everything at once below, or revoke any of it at any time.',
  'opt.access.all': 'Allow on all sites',
  'opt.access.allDesc':
    'Stops the per-site prompts. Content you read or attach is processed by your configured Ollama server.',
  'opt.access.captureDesc':
    '**Screen capture requires this permission.** Chrome will not grant capture on a per-site basis. Reading page text works with per-site access alone.',
  'opt.access.granted': 'Allowed sites',
  'opt.access.count': '{n}',
  'opt.access.none': 'None yet.',
  'opt.access.revoke': 'Revoke',

  'opt.display.h': 'Display',
  'opt.display.theme': 'Theme',
  'opt.display.theme.system': 'Follow system',
  'opt.display.theme.light': 'Light',
  'opt.display.theme.dark': 'Dark',
  'opt.display.locale': 'Language · 언어',
  'opt.display.localeDesc':
    "Changes both the panel's interface and the language the model replies in. The extension name and right-click menu follow your browser language.",

  'opt.reset': 'Restore defaults',
  'opt.resetDesc':
    'Defaults and time estimates use a development CPU baseline ({rate} prefill tok/s), not a guarantee for your current hardware.',

  /* ── Performance dashboard ── */
  'perf.h': 'Performance record',
  'perf.empty':
    'Nothing recorded yet. After a few conversations, real response times collect here alongside the targets set in the plan.',
  'perf.intro':
    'Measured across the last {total} real responses. {cold} cold starts are excluded from the comparison — that is the one-time cost of loading the model, not a delay you meet every time.',
  'perf.bucket.short': 'Short chat',
  'perf.bucket.selection': 'Selected text',
  'perf.bucket.page': 'Page task',
  'perf.bucket.huge': 'Large input',
  'perf.col.bucket': 'Task',
  'perf.col.count': 'Samples',
  'perf.col.median': 'First token (median)',
  'perf.col.target': 'Target',
  'perf.sec': '{n}s',
  'perf.miss': ' over',
  'perf.meet': ' met',
  'perf.prefill': 'Prefill',
  'perf.decode': 'Generation',
  'perf.base': ' baseline {n}',
  'perf.tokensIn': 'Tokens read',
  'perf.tokensOut': 'Tokens written',
  'perf.fasterHw':
    'Prefill is more than 3x the baseline — this looks like a GPU. You can raise the page budget and context length and stay in practical range.',
  'perf.refresh': 'Refresh',

  /* ── Preset editor ── */
  'preset.h': 'My presets',
  'preset.intro':
    'Register prompts you use often as slash commands. Type / in the panel composer to see the list. Put {selection} in the body and whatever you type after the command lands there.',
  'preset.needs.none': 'No attachment',
  'preset.needs.page': 'Needs page text',
  'preset.needs.screen': 'Needs screenshot',
  'preset.needs.selection': 'Acts on typed text',
  'preset.delete': 'Delete',
  'preset.label': 'Name',
  'preset.labelPlaceholder': 'e.g. Tidy meeting notes',
  'preset.slash': 'Command',
  'preset.conflict': ' — that name exists. Saving overwrites it.',
  'preset.willSave': ' will be saved.',
  'preset.needs': 'Required attachment',
  'preset.needsDesc':
    "Choosing 'Needs page text' reads the page first when the command runs (about 15s). 'Needs screenshot' is faster, about 5s.",
  'preset.body': 'Body',
  'preset.bodyPlaceholder':
    'Pull only the decisions and action items out of these notes.\n\n{selection}',
  'preset.add': 'Add',
} satisfies Record<MessageKey, string>;

export const MESSAGES = { ko, en } as const;
