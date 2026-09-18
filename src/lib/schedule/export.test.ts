import { describe, expect, it } from 'vitest';
import { csvCell, exportFileName, icsText, tasksToCsv, tasksToIcs } from './export';
import type { ScheduleTask } from './task';

const NOW = new Date(Date.UTC(2026, 8, 18, 6, 0, 0));

function task(patch: Partial<ScheduleTask> = {}): ScheduleTask {
  return { id: 1, title: '사업계획서 제출', status: 'todo', dueDate: '2026-09-30', createdAt: Date.UTC(2026, 8, 18), updatedAt: 1, ...patch };
}

describe('csvCell', () => {
  it('★ 수식으로 읽히는 칸을 막는다 — 공문 제목은 "-"로 시작하는 일이 잦다', () => {
    expect(csvCell('-붙임 참조')).toBe("'-붙임 참조");
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('@담당자')).toBe("'@담당자");
  });

  it('쉼표·따옴표·개행이 있으면 감싸고 따옴표를 겹쳐 쓴다', () => {
    expect(csvCell('가, 나')).toBe('"가, 나"');
    expect(csvCell('그는 "확인"했다')).toBe('"그는 ""확인""했다"');
    expect(csvCell('한 줄\n두 줄')).toBe('"한 줄\n두 줄"');
  });

  it('평범한 값은 그대로 둔다', () => {
    expect(csvCell('사업계획서 제출')).toBe('사업계획서 제출');
  });
});

describe('tasksToCsv', () => {
  it('기한·상태·근거·출처를 한 줄로 담는다', () => {
    const csv = tasksToCsv([task({
      due: { date: '2026-09-30', time: '18:00', text: '9. 30.', yearInferred: true },
      evidence: '9. 30.까지 제출하여 주시기 바랍니다.',
      evidenceVerified: true,
      deliverables: ['사업계획서', '예산내역서'],
      contact: '기획예산과 홍길동',
      source: { docTitle: '공모사업 안내', docUrl: 'https://onnara.test/doc/1' },
    })]);
    const [header, row] = csv.split('\r\n');

    expect(header).toContain('기한');
    expect(row).toContain('2026-09-30,18:00,진행,사업계획서 제출');
    expect(row).toContain('사업계획서 / 예산내역서');
    expect(row).toContain('확인');
    expect(row).toContain('추정');
    expect(row).toContain('https://onnara.test/doc/1');
  });

  it('★ 엑셀이 한국어를 깨뜨리지 않도록 BOM을 붙인다', () => {
    expect(tasksToCsv([])).toMatch(/^\uFEFF기한,/);
  });

  it('완료한 항목도 기록으로 남긴다', () => {
    const csv = tasksToCsv([task({ status: 'done', completedAt: Date.UTC(2026, 8, 19) })]);
    expect(csv).toContain('완료');
  });
});

describe('tasksToIcs', () => {
  it('기한만 있는 일은 종일 일정으로, 끝은 다음 날로 적는다', () => {
    const ics = tasksToIcs([task()], NOW);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260930');
    expect(ics).toContain('DTEND;VALUE=DATE:20261001');
    expect(ics).toContain('SUMMARY:사업계획서 제출');
    expect(ics).toContain('UID:saide-task-1@onnara-saide');
  });

  it('달을 넘기는 종일 일정의 끝 날짜도 맞는다', () => {
    expect(tasksToIcs([task({ dueDate: '2026-12-31' })], NOW)).toContain('DTEND;VALUE=DATE:20270101');
  });

  it('시각이 있으면 Asia/Seoul 기준 한 시간짜리로 적는다', () => {
    const ics = tasksToIcs([task({ due: { date: '2026-09-30', time: '18:00', text: '9. 30.', yearInferred: false } })], NOW);
    expect(ics).toContain('DTSTART;TZID=Asia/Seoul:20260930T180000');
    expect(ics).toContain('DTEND;TZID=Asia/Seoul:20260930T190000');
  });

  it('★ 달력에 넣을 수 없는 것은 담지 않는다 — 기한 없는 일과 끝난 일', () => {
    const ics = tasksToIcs([
      task({ id: 1, dueDate: '' }),
      task({ id: 2, status: 'done' }),
      task({ id: 3 }),
    ], NOW);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain('UID:saide-task-3@onnara-saide');
  });

  it('근거와 출처를 설명에 담고, 구분자로 읽힐 글자를 피한다', () => {
    const ics = tasksToIcs([task({
      evidence: '가, 나; 다',
      source: { docTitle: '공모사업 안내' },
    })], NOW);
    expect(ics).toContain('DESCRIPTION:근거: 가\\, 나\\; 다\\n출처 공문: 공모사업 안내');
  });

  it('항목이 없어도 올바른 달력 파일이다', () => {
    const ics = tasksToIcs([], NOW);
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });
});

describe('icsText / exportFileName', () => {
  it('역슬래시와 개행을 escape한다', () => {
    expect(icsText('C:\\경로\n다음 줄')).toBe('C:\\\\경로\\n다음 줄');
  });

  it('파일 이름에 날짜를 붙여 덮어쓰지 않게 한다', () => {
    expect(exportFileName('csv', new Date(2026, 8, 18))).toBe('온나라-sAIde-일정-20260918.csv');
  });
});
