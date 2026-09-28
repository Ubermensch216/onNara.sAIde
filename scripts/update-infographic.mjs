import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const chatImgPath = path.join(rootDir, 'docs', 'screenshots', '01-chat.png');
const autoImgPath = path.join(rootDir, 'docs', 'screenshots', '06-automation.png');
const targetHtmlPath = path.join(rootDir, 'scripts', 'generate-infographic.html');
const outputPngPath = path.join(rootDir, 'docs', 'infographic.png');

console.log('Reading HTML template and screenshot files...');
if (!fs.existsSync(targetHtmlPath)) {
  console.error(`Missing target HTML: ${targetHtmlPath}`);
  process.exit(1);
}

let html = fs.readFileSync(targetHtmlPath, 'utf8');

// Read images and convert to base64
const chatB64 = fs.readFileSync(chatImgPath).toString('base64');
const autoB64 = fs.readFileSync(autoImgPath).toString('base64');

// Replace the two data URLs or placeholders in order
let replaced = 0;
html = html.replace(/src="(?:data:image\/png;base64,[^"]*|\[BASE64_PLACEHOLDER\])"/g, () => {
  replaced++;
  if (replaced === 1) {
    return `src="data:image/png;base64,${chatB64}"`;
  } else if (replaced === 2) {
    return `src="data:image/png;base64,${autoB64}"`;
  }
  return 'src=""';
});

fs.writeFileSync(targetHtmlPath, html, 'utf8');
console.log(`Updated ${targetHtmlPath} with ${replaced} base64 screenshot images.`);

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
