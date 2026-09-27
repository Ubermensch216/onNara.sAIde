import React from 'react';

export type OnnaraVariant = 'list' | 'drafter' | 'inbox';

interface OnnaraMockFrameProps {
  variant: OnnaraVariant;
  children: React.ReactNode;
}

export function OnnaraMockFrame({ variant, children }: OnnaraMockFrameProps) {
  const currentUrl =
    variant === 'drafter'
      ? 'https://onnara.saas.gcloud.go.kr/bms/dct/addoreportbodyview.do'
      : variant === 'inbox'
        ? 'https://onnara.saas.gcloud.go.kr/bms/dctshr/act_rcv.do'
        : 'https://onnara.saas.gcloud.go.kr/bms/dctlist/act_wil.do';

  const tabTitle =
    variant === 'drafter'
      ? '온나라 전자문서 2.0 - [기안작성] 2026년도 인공지능 행정업무 시범사업...'
      : variant === 'inbox'
        ? '온나라 전자문서 2.0 - 공유/공람 (받은문서)'
        : '온나라 전자문서 2.0 - 접수대기함 (부서문서함)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', background: '#f8fafc', overflow: 'hidden', fontFamily: "'Pretendard', 'Malgun Gothic', '맑은 고딕', sans-serif" }}>
      {/* ── 1. Edge 브라우저 상단 윈도우 크롬 ────────────────── */}
      <header style={{ background: '#eef2f6', borderBottom: '1px solid #cbd5e1', flexShrink: 0 }}>
        {/* 탭 바 */}
        <div style={{ display: 'flex', alignItems: 'center', height: '36px', padding: '0 8px', gap: '6px' }}>
          {/* 활성 탭 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: '#ffffff',
            padding: '6px 14px',
            borderRadius: '8px 8px 0 0',
            fontSize: '12px',
            fontWeight: 600,
            color: '#1e293b',
            boxShadow: '0 -1px 3px rgba(0,0,0,0.05)',
            maxWidth: '360px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            borderTop: '2px solid #2563eb'
          }}>
            {/* 정부 상징 태극 아이콘 */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" fill="#0d2f81" />
              <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C12 17 17 17 17 12C17 7 12 7 12 2Z" fill="#dc2626" />
            </svg>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{tabTitle}</span>
            <span style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: '14px', cursor: 'pointer' }}>×</span>
          </div>

          {/* 새 탭 버튼 */}
          <div style={{ width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: '16px', borderRadius: '4px' }}>+</div>

          {/* 브라우저 우측 창 조절 버튼 */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '14px', color: '#64748b', paddingRight: '8px', fontSize: '13px' }}>
            <span>―</span>
            <span>□</span>
            <span>✕</span>
          </div>
        </div>

        {/* 주소 표시줄 & 툴바 */}
        <div style={{ display: 'flex', alignItems: 'center', height: '40px', padding: '0 12px', gap: '10px', background: '#ffffff', borderTop: '1px solid #e2e8f0' }}>
          {/* 네비게이션 버튼 */}
          <div style={{ display: 'flex', gap: '8px', color: '#64748b', fontSize: '15px' }}>
            <span style={{ cursor: 'pointer' }}>←</span>
            <span style={{ cursor: 'pointer', color: '#cbd5e1' }}>→</span>
            <span style={{ cursor: 'pointer' }}>⟳</span>
          </div>

          {/* 주소창 */}
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            background: '#f1f5f9',
            border: '1px solid #cbd5e1',
            borderRadius: '20px',
            padding: '4px 14px',
            gap: '8px',
            fontSize: '12.5px',
            color: '#334155'
          }}>
            <span style={{ color: '#059669', fontSize: '12px' }}>🔒</span>
            <span style={{ color: '#0f766e', fontWeight: 600 }}>https://</span>
            <span style={{ color: '#0f172a', fontWeight: 600 }}>onnara.saas.gcloud.go.kr</span>
            <span style={{ color: '#64748b' }}>{currentUrl.replace('https://onnara.saas.gcloud.go.kr', '')}</span>
            <span style={{ marginLeft: 'auto', background: '#e2e8f0', color: '#475569', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>정부 G-Cloud 보안존</span>
          </div>

          {/* 브라우저 확장 프로그램 아이콘들 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* sAIde 확장 활성화 뱃지 */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              background: '#eff6ff',
              border: '1.5px solid #3b82f6',
              borderRadius: '8px',
              padding: '3px 9px',
              fontSize: '11.5px',
              fontWeight: 700,
              color: '#1d4ed8'
            }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
              온나라 sAIde [연동 활성]
            </div>

            {/* 사이드패널 토글 아이콘 (활성화 상태) */}
            <div style={{
              width: '28px',
              height: '28px',
              background: '#2563eb',
              color: '#ffffff',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '13px',
              fontWeight: 'bold',
              boxShadow: '0 2px 4px rgba(37,99,235,0.3)'
            }}>
              ◨
            </div>
          </div>
        </div>
      </header>

      {/* ── 2. 브라우저 본문 (온나라 웹사이트 + 우측 사이드카 분할) ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {/* 온나라 전자문서시스템 2.0 웹 화면 영역 */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#f8fafc', overflowY: 'auto', borderRight: '2px solid #cbd5e1' }}>
          {/* 온나라 통합 상단 GNB 바 */}
          <div style={{
            background: 'linear-gradient(90deg, #0d2f81 0%, #153e99 100%)',
            color: '#ffffff',
            padding: '0 20px',
            height: '50px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 2px 5px rgba(0,0,0,0.15)',
            flexShrink: 0
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 900 }}>
                  정부
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '15px', fontWeight: 800, letterSpacing: '-0.3px', lineHeight: 1.1 }}>온나라 전자문서시스템 2.0</span>
                  <span style={{ fontSize: '10px', color: '#93c5fd', fontWeight: 500 }}>행정안전부 디지털정부혁신</span>
                </div>
              </div>

              {/* 온나라 주 메뉴 (GNB) */}
              <nav style={{ display: 'flex', gap: '4px', marginLeft: '24px' }}>
                <div style={{ padding: '6px 14px', fontSize: '13px', fontWeight: 600, color: variant === 'drafter' ? '#ffffff' : '#bfdbfe', background: variant === 'drafter' ? 'rgba(255,255,255,0.18)' : 'transparent', borderRadius: '4px', cursor: 'pointer' }}>
                  전자결재
                </div>
                <div style={{ padding: '6px 14px', fontSize: '13px', fontWeight: 700, color: variant === 'list' ? '#ffffff' : '#bfdbfe', background: variant === 'list' ? 'rgba(255,255,255,0.18)' : 'transparent', borderRadius: '4px', cursor: 'pointer' }}>
                  문서관리
                </div>
                <div style={{ padding: '6px 14px', fontSize: '13px', fontWeight: 600, color: variant === 'inbox' ? '#ffffff' : '#bfdbfe', background: variant === 'inbox' ? 'rgba(255,255,255,0.18)' : 'transparent', borderRadius: '4px', cursor: 'pointer' }}>
                  공유·공람
                </div>
                <div style={{ padding: '6px 14px', fontSize: '13px', fontWeight: 500, color: '#bfdbfe', cursor: 'pointer' }}>
                  기록물관리
                </div>
                <div style={{ padding: '6px 14px', fontSize: '13px', fontWeight: 500, color: '#bfdbfe', cursor: 'pointer' }}>
                  조직정보
                </div>
              </nav>
            </div>

            {/* 사용자 정보 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px' }}>
              <span style={{ background: 'rgba(255,255,255,0.12)', padding: '4px 10px', borderRadius: '9999px', color: '#93c5fd' }}>
                미결 <strong>3건</strong> | 공람 <strong>12건</strong>
              </span>
              <span style={{ fontWeight: 600 }}>디지털정부혁신과 <strong>홍길동</strong> 주무관</span>
              <span style={{ color: '#93c5fd', cursor: 'pointer' }}>로그아웃</span>
            </div>
          </div>

          {/* 메인 온나라 화면 컨텐츠 (좌측 LNB + 우측 콘텐츠 영역) */}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {variant === 'drafter' ? (
              /* ── [DRAFTER] 기안기 화면 ── */
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#ffffff', overflowY: 'auto' }}>
                {/* 기안기 상단 액션 툴바 */}
                <div style={{
                  padding: '10px 18px',
                  background: '#f1f5f9',
                  borderBottom: '1px solid #cbd5e1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexShrink: 0
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>기안문서 작성 (웹기안기)</span>
                    <span style={{ background: '#dbeafe', color: '#1e40af', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px' }}>
                      표준 행정서식
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button style={{ padding: '6px 12px', background: '#2563eb', color: '#fff', borderRadius: '4px', fontSize: '12px', fontWeight: 700, boxShadow: '0 1px 2px rgba(37,99,235,0.3)' }}>
                      결재올림
                    </button>
                    <button style={{ padding: '6px 12px', background: '#ffffff', border: '1px solid #cbd5e1', color: '#334155', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
                      임시저장
                    </button>
                    <button style={{ padding: '6px 12px', background: '#ffffff', border: '1px solid #cbd5e1', color: '#334155', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
                      결재선지정 (3명)
                    </button>
                    <button style={{ padding: '6px 12px', background: '#ffffff', border: '1px solid #cbd5e1', color: '#334155', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
                      수신처지정
                    </button>
                    <button style={{ padding: '6px 12px', background: '#eff6ff', border: '1px solid #93c5fd', color: '#1d4ed8', borderRadius: '4px', fontSize: '12px', fontWeight: 700 }}>
                      📎 관련정보 (수신문서 1건 연동됨)
                    </button>
                  </div>
                </div>

                {/* 기안 문서 메타정보 헤더 테이블 */}
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', background: '#ffffff', border: '1px solid #cbd5e1' }}>
                    <tbody>
                      <tr>
                        <th style={{ width: '100px', background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '6px 10px', color: '#475569', textAlign: 'left' }}>문서 제목</th>
                        <td style={{ border: '1px solid #cbd5e1', padding: '6px 10px' }} colSpan={3}>
                          <input
                            type="text"
                            readOnly
                            value="2026년도 인공지능 행정업무 시범사업 추진계획 수립의 건"
                            style={{ width: '100%', padding: '6px 10px', border: '1.5px solid #2563eb', borderRadius: '4px', fontSize: '13.5px', fontWeight: 700, color: '#0f172a', background: '#f0f7ff' }}
                          />
                        </td>
                      </tr>
                      <tr>
                        <th style={{ width: '100px', background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '6px 10px', color: '#475569', textAlign: 'left' }}>기안자 / 부서</th>
                        <td style={{ border: '1px solid #cbd5e1', padding: '6px 10px', width: '35%' }}>홍길동 주무관 (디지털정부혁신과)</td>
                        <th style={{ width: '100px', background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '6px 10px', color: '#475569', textAlign: 'left' }}>공개 구분</th>
                        <td style={{ border: '1px solid #cbd5e1', padding: '6px 10px' }}>공개 (대국민 공개)</td>
                      </tr>
                      <tr>
                        <th style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '6px 10px', color: '#475569', textAlign: 'left' }}>결재선</th>
                        <td style={{ border: '1px solid #cbd5e1', padding: '6px 10px' }} colSpan={3}>
                          [기안] 홍길동 주무관 → [검토] 김수석 팀장 → [결재] 박진우 과장
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* 웹기안기 에디터 영역 (한글 웹기안기 에뮬레이션) */}
                <div style={{ flex: 1, padding: '20px', background: '#cbd5e1', display: 'flex', justifyContent: 'center', overflowY: 'auto' }}>
                  {/* 종이 문서 시트 (A4 느낌) */}
                  <div style={{
                    width: '680px',
                    minHeight: '620px',
                    background: '#ffffff',
                    boxShadow: '0 4px 15px rgba(0,0,0,0.15)',
                    padding: '48px 50px',
                    boxSizing: 'border-box',
                    position: 'relative'
                  }}>
                    {/* 문서 상단 서식 */}
                    <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                      <h1 style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', letterSpacing: '1px', marginBottom: '4px' }}>행 정 안 전 부</h1>
                      <div style={{ height: '2px', background: '#0f172a', margin: '8px 0 16px' }} />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#475569' }}>
                        <span>수신: 내부결재</span>
                        <span>(경유)</span>
                      </div>
                    </div>

                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', marginBottom: '18px', paddingBottom: '6px', borderBottom: '1px solid #e2e8f0' }}>
                      제목: 2026년도 인공지능 행정업무 시범사업 추진계획 수립의 건
                    </div>

                    {/* 기안문 본문 텍스트 */}
                    <div style={{ fontSize: '12.5px', lineHeight: 1.8, color: '#1e293b' }}>
                      <p style={{ fontWeight: 700, marginBottom: '4px' }}>1. 추진 목적</p>
                      <p style={{ paddingLeft: '16px', margin: '2px 0' }}>가. 인공지능 행정업무 시범사업 추진계획에 따른 지자체 행정 효율성 제고</p>
                      <p style={{ paddingLeft: '16px', margin: '2px 0' }}>나. 온나라 전자문서 시스템과 연계한 맞춤형 AI 사이드패널 도입 추진</p>
                      
                      <div style={{ height: '10px' }} />
                      <p style={{ fontWeight: 700, marginBottom: '4px' }}>2. 주요 추진 내용</p>

                      {/* 블록 선택된 텍스트와 플로팅 버블 시뮬레이션 */}
                      <div style={{ position: 'relative' }}>
                        <p style={{
                          paddingLeft: '16px',
                          margin: '2px 0',
                          background: '#93c5fd',
                          color: '#0f172a',
                          borderRadius: '2px',
                          display: 'inline-block',
                          paddingRight: '6px'
                        }}>
                          가. 부서별 공문서 검토 및 핵심 조치사항 도출 자동화 환경 구축
                        </p>

                        {/* 플로팅 텍스트 버블 (Selection Bubble) */}
                        <div style={{
                          position: 'absolute',
                          top: '-42px',
                          left: '40px',
                          background: '#0f172a',
                          color: '#ffffff',
                          borderRadius: '8px',
                          padding: '6px 10px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          boxShadow: '0 8px 20px rgba(0,0,0,0.3)',
                          fontSize: '11px',
                          fontWeight: 700,
                          zIndex: 50,
                          border: '1px solid rgba(255,255,255,0.15)'
                        }}>
                          <span style={{ color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '3px' }}>
                            ✨ 문장 다듬기
                          </span>
                          <span style={{ color: '#64748b' }}>|</span>
                          <span style={{ color: '#cbd5e1' }}>맞춤법 검사</span>
                          <span style={{ color: '#64748b' }}>|</span>
                          <span style={{ color: '#93c5fd' }}>💬 사이드카로 전송</span>
                          <div style={{
                            position: 'absolute',
                            bottom: '-5px',
                            left: '30px',
                            width: 0,
                            height: 0,
                            borderLeft: '5px solid transparent',
                            borderRight: '5px solid transparent',
                            borderTop: '5px solid #0f172a'
                          }} />
                        </div>
                      </div>

                      <p style={{ paddingLeft: '16px', margin: '2px 0' }}>나. 대용량 첨부파일 및 공문 본문의 스마트 일괄 수신 체계 마련</p>
                      <p style={{ paddingLeft: '16px', margin: '2px 0' }}>다. 안전한 로컬 LLM 기반 정보보안 가이드라인 준수</p>

                      <div style={{ height: '10px' }} />
                      <p style={{ fontWeight: 700, marginBottom: '4px' }}>3. 세부 일정 및 조치계획</p>
                      <p style={{ paddingLeft: '16px', margin: '2px 0' }}>가. 시범사업 수요조사서 및 보안서약서 제출: 2026. 9. 22.(화)한</p>
                      <p style={{ paddingLeft: '16px', margin: '2px 0' }}>나. 부서 의견 수렴 및 시스템 연계 테스트: 2026. 10. 15.까지</p>

                      <div style={{ height: '10px' }} />
                      <p style={{ fontWeight: 700, marginBottom: '4px' }}>4. 행정 사항</p>
                      <p style={{ paddingLeft: '16px', margin: '2px 0' }}>가. 본 사업 추진을 위한 정보화 예산 집행 협의 완료</p>
                      <p style={{ paddingLeft: '16px', margin: '2px 0' }}>나. 관련 서식: 붙임 시범사업 수요조사서 1부.  끝.</p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* ── [LIST / INBOX] 온나라 메인 목록 화면 ── */
              <>
                {/* 좌측 LNB 메뉴 트리 (온나라 2.0 고유 사이드바) */}
                <aside style={{
                  width: '185px',
                  background: '#f8fafc',
                  borderRight: '1px solid #e2e8f0',
                  padding: '16px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                  flexShrink: 0
                }}>
                  {/* 기안하기 버튼 */}
                  <button style={{
                    background: 'linear-gradient(135deg, #1d4ed8, #2563eb)',
                    color: '#ffffff',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    boxShadow: '0 2px 4px rgba(37,99,235,0.25)'
                  }}>
                    ✏️ 새 기안 작성
                  </button>

                  {/* 개인문서함 섹션 */}
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 800, color: '#64748b', marginBottom: '6px', letterSpacing: '0.5px' }}>개인문서함</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '12px' }}>
                      <div style={{ padding: '5px 8px', color: '#475569', borderRadius: '4px' }}>기안문서함</div>
                      <div style={{ padding: '5px 8px', color: '#475569', borderRadius: '4px', display: 'flex', justifyContent: 'space-between' }}>
                        <span>결재대기함</span>
                        <span style={{ background: '#e2e8f0', color: '#475569', borderRadius: '9999px', padding: '0 6px', fontSize: '10px', fontWeight: 700 }}>3</span>
                      </div>
                      <div style={{ padding: '5px 8px', color: '#475569', borderRadius: '4px' }}>진행문서함</div>
                    </div>
                  </div>

                  {/* 부서문서함 섹션 */}
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 800, color: '#64748b', marginBottom: '6px', letterSpacing: '0.5px' }}>부서문서함</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '12px' }}>
                      <div style={{
                        padding: '6px 8px',
                        background: variant === 'list' ? '#dbeafe' : 'transparent',
                        color: variant === 'list' ? '#1d4ed8' : '#475569',
                        fontWeight: variant === 'list' ? 700 : 500,
                        borderRadius: '4px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}>
                        <span>접수대기함</span>
                        <span style={{ background: variant === 'list' ? '#2563eb' : '#e2e8f0', color: variant === 'list' ? '#ffffff' : '#475569', borderRadius: '9999px', padding: '0 6px', fontSize: '10px', fontWeight: 700 }}>5</span>
                      </div>
                      <div style={{ padding: '5px 8px', color: '#475569', borderRadius: '4px' }}>문서등록대장</div>
                      <div style={{ padding: '5px 8px', color: '#475569', borderRadius: '4px' }}>배부대기함</div>
                    </div>
                  </div>

                  {/* 공유/공람 섹션 */}
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 800, color: '#64748b', marginBottom: '6px', letterSpacing: '0.5px' }}>공유/공람</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '12px' }}>
                      <div style={{
                        padding: '6px 8px',
                        background: variant === 'inbox' ? '#dbeafe' : 'transparent',
                        color: variant === 'inbox' ? '#1d4ed8' : '#475569',
                        fontWeight: variant === 'inbox' ? 700 : 500,
                        borderRadius: '4px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}>
                        <span>받은문서 (브리핑)</span>
                        <span style={{ background: variant === 'inbox' ? '#2563eb' : '#e2e8f0', color: variant === 'inbox' ? '#ffffff' : '#475569', borderRadius: '9999px', padding: '0 6px', fontSize: '10px', fontWeight: 700 }}>12</span>
                      </div>
                      <div style={{ padding: '5px 8px', color: '#475569', borderRadius: '4px' }}>공람지정함</div>
                    </div>
                  </div>
                </aside>

                {/* 중앙 메인 공문 목록 테이블 영역 */}
                <section style={{ flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>
                  {/* 상단 브레드크럼 & 제목 */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '2px' }}>
                        {variant === 'inbox' ? '공유/공람 > 받은문서' : '부서문서함 > 접수대기함'}
                      </div>
                      <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {variant === 'inbox' ? '공유/공람 받은문서' : '접수대기함'}
                        <span style={{ fontSize: '12px', fontWeight: 600, color: '#2563eb' }}>
                          총 {variant === 'inbox' ? '12건 (미열람 11건)' : '15건 중 2건 선택됨'}
                        </span>
                      </h2>
                    </div>

                    {/* 온나라 행정 액션 버튼군 */}
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {variant === 'list' && (
                        <>
                          <button style={{ padding: '6px 12px', background: '#2563eb', color: '#fff', borderRadius: '4px', fontSize: '12px', fontWeight: 700 }}>
                            선택 문서 접수
                          </button>
                          <button style={{ padding: '6px 12px', background: '#eff6ff', border: '1px solid #3b82f6', color: '#1d4ed8', borderRadius: '4px', fontSize: '12px', fontWeight: 700 }}>
                            ⚡ 일괄다운로드 (sAIde)
                          </button>
                          <button style={{ padding: '6px 12px', background: '#fff', border: '1px solid #cbd5e1', color: '#475569', borderRadius: '4px', fontSize: '12px' }}>
                            반송
                          </button>
                        </>
                      )}
                      {variant === 'inbox' && (
                        <>
                          <button style={{ padding: '6px 12px', background: '#2563eb', color: '#fff', borderRadius: '4px', fontSize: '12px', fontWeight: 700 }}>
                            일괄 공람확인
                          </button>
                          <button style={{ padding: '6px 12px', background: '#eff6ff', border: '1px solid #3b82f6', color: '#1d4ed8', borderRadius: '4px', fontSize: '12px', fontWeight: 700 }}>
                            📋 sAIde 아침 브리핑 실행
                          </button>
                        </>
                      )}
                      <button style={{ padding: '6px 10px', background: '#fff', border: '1px solid #cbd5e1', color: '#475569', borderRadius: '4px', fontSize: '12px' }}>
                        엑셀저장
                      </button>
                    </div>
                  </div>

                  {/* 정형 검색 필터 바 */}
                  <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '16px', fontSize: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontWeight: 700, color: '#334155' }}>조회기간:</span>
                      <span style={{ padding: '3px 8px', background: '#f1f5f9', borderRadius: '4px', color: '#475569' }}>1주일</span>
                      <span style={{ padding: '3px 8px', background: '#2563eb', color: '#fff', borderRadius: '4px', fontWeight: 700 }}>1개월</span>
                      <span style={{ padding: '3px 8px', background: '#f1f5f9', borderRadius: '4px', color: '#475569' }}>3개월</span>
                      <span style={{ color: '#64748b', marginLeft: '6px' }}>2026.08.27 ~ 2026.09.27</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
                      <span style={{ fontWeight: 700, color: '#334155' }}>제목검색:</span>
                      <input
                        type="text"
                        readOnly
                        value={variant === 'list' ? '인공지능 시범사업' : ''}
                        placeholder="검색어 입력..."
                        style={{ border: '1px solid #cbd5e1', borderRadius: '4px', padding: '4px 8px', width: '160px', fontSize: '12px' }}
                      />
                      <button style={{ padding: '4px 10px', background: '#0d2f81', color: '#fff', borderRadius: '4px', fontWeight: 700 }}>
                        검색
                      </button>
                    </div>
                  </div>

                  {/* 공문 목록 테이블 (온나라 정형 그리드) */}
                  <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ background: '#f1f5f9', borderBottom: '1.5px solid #cbd5e1', color: '#334155', fontWeight: 700 }}>
                          <th style={{ padding: '8px 10px', width: '36px', textAlign: 'center' }}>
                            <input type="checkbox" checked={variant === 'list'} readOnly />
                          </th>
                          <th style={{ padding: '8px 8px', width: '42px', textAlign: 'center' }}>번호</th>
                          <th style={{ padding: '8px 10px', width: '85px' }}>보고일자</th>
                          <th style={{ padding: '8px 12px' }}>문서 제목</th>
                          <th style={{ padding: '8px 10px', width: '150px' }}>발신 기관/부서</th>
                          <th style={{ padding: '8px 10px', width: '100px' }}>소관부서</th>
                          <th style={{ padding: '8px 8px', width: '55px', textAlign: 'center' }}>첨부</th>
                          <th style={{ padding: '8px 10px', width: '75px', textAlign: 'center' }}>상태</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* 1행: AI 요약 대상 공문 (선택 상태) */}
                        <tr style={{
                          background: variant === 'list' ? '#e0f2fe' : '#ffffff',
                          borderBottom: '1px solid #e2e8f0',
                          fontWeight: variant === 'list' ? 700 : 500
                        }}>
                          <td style={{ padding: '10px 10px', textAlign: 'center' }}>
                            <input type="checkbox" checked={variant === 'list'} readOnly />
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'center', color: '#64748b' }}>15</td>
                          <td style={{ padding: '10px 10px', color: '#475569' }}>2026.09.22</td>
                          <td style={{ padding: '10px 12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ background: '#fee2e2', color: '#b91c1c', fontSize: '10px', padding: '1px 5px', borderRadius: '3px', fontWeight: 800 }}>긴급</span>
                              <span style={{ color: '#1d4ed8', cursor: 'pointer' }}>
                                2026년도 인공지능 행정업무 시범사업 추진계획 알림
                              </span>
                              {variant === 'list' && (
                                <span style={{ background: '#2563eb', color: '#fff', fontSize: '10px', padding: '1px 6px', borderRadius: '9999px', fontWeight: 800 }}>
                                  AI 분석중
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '10px 10px', color: '#334155' }}>행정안전부 디지털정부혁신과</td>
                          <td style={{ padding: '10px 10px', color: '#475569' }}>기획예산과</td>
                          <td style={{ padding: '10px 8px', textAlign: 'center', color: '#2563eb', fontWeight: 700 }}>💾 3</td>
                          <td style={{ padding: '10px 10px', textAlign: 'center' }}>
                            <span style={{ background: '#fef3c7', color: '#b45309', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                              접수대기
                            </span>
                          </td>
                        </tr>

                        {/* 2행: 선택 상태 공문 */}
                        <tr style={{
                          background: variant === 'list' ? '#e0f2fe' : '#ffffff',
                          borderBottom: '1px solid #e2e8f0',
                          fontWeight: variant === 'list' ? 700 : 500
                        }}>
                          <td style={{ padding: '10px 10px', textAlign: 'center' }}>
                            <input type="checkbox" checked={variant === 'list'} readOnly />
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'center', color: '#64748b' }}>14</td>
                          <td style={{ padding: '10px 10px', color: '#475569' }}>2026.09.20</td>
                          <td style={{ padding: '10px 12px' }}>
                            <span style={{ color: '#1d4ed8', cursor: 'pointer' }}>
                              2026년도 지자체 정보화예산 편성 및 집행지침 알림
                            </span>
                          </td>
                          <td style={{ padding: '10px 10px', color: '#334155' }}>행정안전부 지역정보화지원과</td>
                          <td style={{ padding: '10px 10px', color: '#475569' }}>정보통신과</td>
                          <td style={{ padding: '10px 8px', textAlign: 'center', color: '#2563eb', fontWeight: 700 }}>💾 2</td>
                          <td style={{ padding: '10px 10px', textAlign: 'center' }}>
                            <span style={{ background: '#fef3c7', color: '#b45309', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                              접수대기
                            </span>
                          </td>
                        </tr>

                        {/* 3행: 일반 공문 */}
                        <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#334155' }}>
                          <td style={{ padding: '10px 10px', textAlign: 'center' }}>
                            <input type="checkbox" readOnly />
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'center', color: '#64748b' }}>13</td>
                          <td style={{ padding: '10px 10px', color: '#475569' }}>2026.09.18</td>
                          <td style={{ padding: '10px 12px', color: '#334155' }}>
                            공공데이터 개방 및 품질진단 지원사업 수요조사 안내
                          </td>
                          <td style={{ padding: '10px 10px', color: '#475569' }}>디지털플랫폼정부위원회</td>
                          <td style={{ padding: '10px 10px', color: '#475569' }}>정보통신과</td>
                          <td style={{ padding: '10px 8px', textAlign: 'center', color: '#64748b' }}>💾 1</td>
                          <td style={{ padding: '10px 10px', textAlign: 'center' }}>
                            <span style={{ background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                              접수완료
                            </span>
                          </td>
                        </tr>

                        {/* 4행 */}
                        <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#334155' }}>
                          <td style={{ padding: '10px 10px', textAlign: 'center' }}>
                            <input type="checkbox" readOnly />
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'center', color: '#64748b' }}>12</td>
                          <td style={{ padding: '10px 10px', color: '#475569' }}>2026.09.17</td>
                          <td style={{ padding: '10px 12px', color: '#334155' }}>
                            온나라 연계 AI 어시스턴트 보안관리지침(안) 부서 의견조회
                          </td>
                          <td style={{ padding: '10px 10px', color: '#475569' }}>행정안전부 정보화기반과</td>
                          <td style={{ padding: '10px 10px', color: '#475569' }}>정보통신과</td>
                          <td style={{ padding: '10px 8px', textAlign: 'center', color: '#64748b' }}>💾 1</td>
                          <td style={{ padding: '10px 10px', textAlign: 'center' }}>
                            <span style={{ background: '#fef3c7', color: '#b45309', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                              접수대기
                            </span>
                          </td>
                        </tr>

                        {/* 5행 */}
                        <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#334155' }}>
                          <td style={{ padding: '10px 10px', textAlign: 'center' }}>
                            <input type="checkbox" readOnly />
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'center', color: '#64748b' }}>11</td>
                          <td style={{ padding: '10px 10px', color: '#475569' }}>2026.09.15</td>
                          <td style={{ padding: '10px 12px', color: '#334155' }}>
                            공공부문 클라우드 네이티브 전환 2차 수요 피드백 회신
                          </td>
                          <td style={{ padding: '10px 10px', color: '#475569' }}>한국지능정보사회진흥원</td>
                          <td style={{ padding: '10px 10px', color: '#475569' }}>기획예산과</td>
                          <td style={{ padding: '10px 8px', textAlign: 'center', color: '#64748b' }}>💾 2</td>
                          <td style={{ padding: '10px 10px', textAlign: 'center' }}>
                            <span style={{ background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                              접수완료
                            </span>
                          </td>
                        </tr>

                        {/* 6행 */}
                        <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#334155' }}>
                          <td style={{ padding: '10px 10px', textAlign: 'center' }}>
                            <input type="checkbox" readOnly />
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'center', color: '#64748b' }}>10</td>
                          <td style={{ padding: '10px 10px', color: '#475569' }}>2026.09.14</td>
                          <td style={{ padding: '10px 12px', color: '#334155' }}>
                            직장 동호회 가을 체육행사 참가 신청 안내
                          </td>
                          <td style={{ padding: '10px 10px', color: '#475569' }}>운영지원과</td>
                          <td style={{ padding: '10px 10px', color: '#475569' }}>운영지원과</td>
                          <td style={{ padding: '10px 8px', textAlign: 'center', color: '#64748b' }}>-</td>
                          <td style={{ padding: '10px 10px', textAlign: 'center' }}>
                            <span style={{ background: '#f1f5f9', color: '#64748b', padding: '2px 8px', borderRadius: '4px', fontSize: '11px' }}>
                              공람완료
                            </span>
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    {/* 페이징 네비게이션 */}
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '10px', gap: '8px', fontSize: '12px', color: '#64748b', background: '#f8fafc' }}>
                      <span>◀</span>
                      <span style={{ fontWeight: 800, color: '#2563eb', padding: '2px 6px' }}>1</span>
                      <span style={{ cursor: 'pointer' }}>2</span>
                      <span style={{ cursor: 'pointer' }}>3</span>
                      <span>▶</span>
                    </div>
                  </div>
                </section>
              </>
            )}
          </div>
        </main>

        {/* ── 3. 우측 온나라 sAIde 패널/사이드카 영역 ─────────────── */}
        <aside style={{
          width: '500px',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#ffffff',
          position: 'relative',
          boxShadow: '-4px 0 15px rgba(0,0,0,0.08)',
          zIndex: 40,
          flexShrink: 0
        }}>
          {children}
        </aside>
      </div>
    </div>
  );
}
