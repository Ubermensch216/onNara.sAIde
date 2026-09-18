/**
 * 일정 내보내기 — CSV·ICS(계획서 §8.2 "업무 항목 → 내보내기(CSV)", S07).
 *
 * ★ CSV는 기록용이다. 근거 문장과 원문 대조 결과까지 그대로 담아, 표 계산기에서 열어도
 *   "이 기한을 어디서 봤는지"를 잃지 않는다. 그래서 완료 항목도 함께 내보낸다.
 *
 * ★ ICS는 달력용이다. 달력에 넣을 수 있는 것은 날짜가 있는 남은 일뿐이므로 그것만 담는다.
 *
 * ★ CSV 수식 주입을 막는다(계획서 §8.2). `=`, `+`, `-`, `@`, 탭, 개행으로 시작하는 칸은
 *   엑셀·한셀이 수식으로 읽는다. 공문 제목에 "-"로 시작하는 항목이 흔해 실제로 걸린다.
 */

import type { ScheduleTask } from './task';

const CSV_HEADER = ['기한', '시각', '상태', '할 일', '제출물', '문의처', '근거 문장', '원문 확인', '연도 추정', '출처 공문', '출처 주소', '등록일', '완료일'];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function stamp(at: number | undefined): string {
  if (!at) return '';
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 표 계산기가 수식으로 읽는 칸을 막는다.
 *
 * 값을 바꾸지 않고 작은따옴표를 앞에 붙인다 — 엑셀·한셀·구글 시트가 모두 "글자"로 읽고,
 * 화면에는 따옴표가 보이지 않는다.
 */
export function csvCell(value: string): string {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /["\n\r,]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function tasksToCsv(tasks: ScheduleTask[]): string {
  const rows = tasks.map(task => [
    task.due?.date ?? task.dueDate ?? '',
    task.due?.time ?? '',
    task.status === 'done' ? '완료' : '진행',
    task.title,
    (task.deliverables ?? []).join(' / '),
    task.contact ?? '',
    task.evidence ?? '',
    task.evidence ? (task.evidenceVerified ? '확인' : '미확인') : '',
    task.due?.yearInferred ? '추정' : '',
    task.source?.docTitle ?? '',
    task.source?.docUrl ?? '',
    stamp(task.createdAt),
    stamp(task.completedAt),
  ].map(csvCell).join(','));
  // ★ BOM을 붙인다. 없으면 엑셀이 한국어 Windows에서 CSV를 CP949로 읽어 글자가 깨진다.
  return `\uFEFF${[CSV_HEADER.map(csvCell).join(','), ...rows].join('\r\n')}\r\n`;
}

/** ICS 텍스트 escape. 쉼표·세미콜론·역슬래시·개행은 그대로 두면 구분자로 읽힌다. */
export function icsText(value: string): string {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icsDate(dateISO: string): string {
  return dateISO.replace(/-/g, '');
}

function icsStamp(at: Date): string {
  return `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`;
}

/** 날짜에 하루를 더한다. 종일 일정의 DTEND는 다음 날(끝을 포함하지 않음)이다. */
function nextDay(dateISO: string): string {
  const [year, month, day] = dateISO.split('-').map(Number);
  const date = new Date(year!, month! - 1, day! + 1);
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

/** 시각에 한 시간을 더한다. 기한 시각만 있는 일에 기본으로 주는 길이다. */
function plusHour(time: string): string {
  const [hour, minute] = time.split(':').map(Number);
  return `${pad(((hour ?? 0) + 1) % 24)}${pad(minute ?? 0)}00`;
}

/**
 * 달력용 ICS. 기한이 있고 아직 끝나지 않은 일만 담는다.
 *
 * ★ 시간대는 Asia/Seoul로 적되 VTIMEZONE은 넣지 않는다. 시각까지 있는 기한은 드물고,
 *   대부분 종일(VALUE=DATE) 항목이라 시간대 해석이 필요 없다.
 */
export function tasksToIcs(tasks: ScheduleTask[], now: Date = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//onNara sAIde//Schedule//KO', 'CALSCALE:GREGORIAN'];
  for (const task of tasks) {
    if (task.status === 'done' || !task.dueDate) continue;
    const description = [
      task.evidence ? `근거: ${task.evidence}` : '',
      task.source?.docTitle ? `출처 공문: ${task.source.docTitle}` : '',
      task.deliverables?.length ? `제출물: ${task.deliverables.join(' / ')}` : '',
      task.contact ? `문의처: ${task.contact}` : '',
      task.notes ?? '',
    ].filter(Boolean).join('\n');

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:saide-task-${task.id}@onnara-saide`);
    lines.push(`DTSTAMP:${icsStamp(now)}`);
    if (task.due?.time) {
      lines.push(`DTSTART;TZID=Asia/Seoul:${icsDate(task.dueDate)}T${task.due.time.replace(':', '')}00`);
      lines.push(`DTEND;TZID=Asia/Seoul:${icsDate(task.dueDate)}T${plusHour(task.due.time)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(task.dueDate)}`);
      lines.push(`DTEND;VALUE=DATE:${nextDay(task.dueDate)}`);
    }
    lines.push(`SUMMARY:${icsText(task.title)}`);
    if (description) lines.push(`DESCRIPTION:${icsText(description)}`);
    if (task.source?.docUrl) lines.push(`URL:${icsText(task.source.docUrl)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

/** 내보낼 파일 이름. 날짜를 붙여 여러 번 받아도 덮어쓰지 않는다. */
export function exportFileName(extension: 'csv' | 'ics', now: Date = new Date()): string {
  return `온나라-sAIde-일정-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.${extension}`;
}

/**
 * 만든 텍스트를 파일로 내려받는다.
 *
 * ★ chrome.downloads가 아니라 앵커를 쓴다. 사이드패널은 일반 문서라 이 방법이 통하고,
 *   저장 위치를 브라우저 설정에 맡길 수 있다.
 */
export function downloadText(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // 즉시 해제하면 브라우저가 내려받기를 시작하기 전에 사라질 수 있다.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
