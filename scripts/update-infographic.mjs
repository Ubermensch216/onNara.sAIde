import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const skeletonPath = path.join(rootDir, 'scripts', 'infographic-skeleton.html');
const chatImgPath = path.join(rootDir, 'docs', 'screenshots', '01-chat.png');
const autoImgPath = path.join(rootDir, 'docs', 'screenshots', '06-automation.png');
const targetHtmlPath = path.join(rootDir, 'scripts', 'generate-infographic.html');
const outputPngPath = path.join(rootDir, 'docs', 'infographic.png');

console.log('Reading skeleton and screenshot files...');
let html = fs.readFileSync(skeletonPath, 'utf8');

// Update feature 2 text
html = html.replace(
  '<h2>첨부파일 일괄 자동 다운로드</h2>',
  '<h2>공문 본문 및 첨부파일 일괄 자동 다운로드</h2>'
);
html = html.replace(
  '"상세 화면마다 들어가 첨부 링크를 일일이 누를 필요가 없습니다."',
  '"상세 화면마다 들어가 본문과 첨부파일을 일일이 저장할 필요가 없습니다."'
);
html = html.replace(
  `      <ul class="bullet-list">
        <li><strong>원클릭 일괄 다운로드</strong>: 선택한 여러 공문의 모든 첨부파일(HWP, HWPX, PDF)을 한 번에 수신</li>
        <li><strong>스마트 순차 대기열</strong>: 브라우저 완료 신호를 감지하여 파일 누락이나 충돌 없이 순차 처리</li>
        <li><strong>AI 모델 없이도 초고속</strong>: 온나라 기능 기반 자동화로 LLM 오프라인 상태에서도 100% 즉시 동작</li>
        <li><strong>작업 이력 보존 & 바로 열기</strong>: 패널을 재시작해도 이력이 유지되며, <code>폴더 열기</code>로 즉시 확인</li>
      </ul>`,
  `      <ul class="bullet-list">
        <li><strong>원클릭 일괄 다운로드</strong>: 선택한 공문의 본문(HTML·PDF)과 첨부파일(HWP, HWPX, PDF)을 한 번에 수신</li>
        <li><strong>본문/첨부/전체 선택 모드</strong>: 업무 필요에 따라 첨부파일만, 공문 본문만, 혹은 본문+첨부 전체를 골라 다운로드</li>
        <li><strong>스마트 순차 대기열</strong>: 브라우저 완료 신호를 감지하여 파일 누락이나 충돌 없이 순차 처리</li>
        <li><strong>작업 이력 보존 & 바로 열기</strong>: 패널을 재시작해도 이력이 유지되며, <code>폴더 열기</code>로 즉시 확인</li>
      </ul>`
);
html = html.replace(
  '<span class="frame-title">온나라 sAIde — 도구 탭 첨부 다운로드 화면</span>',
  '<span class="frame-title">온나라 sAIde — 도구 탭 공문 본문·첨부 다운로드 화면</span>'
);

// Update chips in footer
html = html.replace(
  `<div class="bottom-chips">
        <span class="chip">🔒 망분리/기관망 보안 준수</span>
        <span class="chip">⚡ 문맥 경계 자동 격리</span>
        <span class="chip">📑 한국어 CMap PDF 지원</span>
        <span class="chip">🗂️ 공유/공람 브리핑 (미열람 유지)</span>
        <span class="chip">⚙️ 범정부 AI 공통기반 연계 대비</span>
      </div>`,
  `<div class="bottom-chips">
        <span class="chip">🔒 망분리/기관망 보안 준수</span>
        <span class="chip">⚡ 문맥 경계 자동 격리</span>
        <span class="chip">📑 한국어 CMap PDF 지원</span>
        <span class="chip">🗂️ 공유/공람 브리핑 (미열람 유지)</span>
        <span class="chip">💾 로컬 백업 & 복원</span>
        <span class="chip">⚙️ 범정부 AI 공통기반 연계 대비</span>
      </div>`
);

// Read images and convert to base64
const chatB64 = fs.readFileSync(chatImgPath).toString('base64');
const autoB64 = fs.readFileSync(autoImgPath).toString('base64');

let placeholderCount = 0;
html = html.replace(/src="\[BASE64_PLACEHOLDER\]"/g, () => {
  placeholderCount++;
  if (placeholderCount === 1) {
    return `src="data:image/png;base64,${chatB64}"`;
  } else if (placeholderCount === 2) {
    return `src="data:image/png;base64,${autoB64}"`;
  }
  return 'src=""';
});

fs.writeFileSync(targetHtmlPath, html, 'utf8');
console.log(`Updated ${targetHtmlPath} with ${placeholderCount} base64 images.`);

// Clean up temporary skeleton
if (fs.existsSync(skeletonPath)) {
  fs.unlinkSync(skeletonPath);
}

// Locate browser
let browserPath = '';
const candidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
for (const cand of candidates) {
  if (fs.existsSync(cand)) {
    browserPath = cand;
    break;
  }
}

if (!browserPath) {
  console.error('No Chrome or Edge executable found to take screenshot!');
  process.exit(1);
}

console.log(`Using browser: ${browserPath}`);
const fileUrl = 'file:///' + targetHtmlPath.replace(/\\/g, '/');
const tempProfile = path.join(rootDir, '.output', 'infographic-profile');

const args = [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${tempProfile}`,
  '--window-size=1200,1360',
  '--hide-scrollbars',
  '--timeout=30000',
  '--virtual-time-budget=5000',
  `--screenshot=${outputPngPath}`,
  fileUrl,
];

console.log('Capturing infographic screenshot...');
execFileSync(browserPath, args, { stdio: 'inherit' });

if (fs.existsSync(outputPngPath)) {
  const stat = fs.statSync(outputPngPath);
  console.log(`Successfully generated ${outputPngPath} (${stat.size} bytes)`);
} else {
  console.error(`Failed to generate ${outputPngPath}`);
  process.exit(1);
}
