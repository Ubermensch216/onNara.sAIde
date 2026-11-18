// 심사·배포 제출용 소스 패키지(zip)를 만든다.
//
//   npm run package:source
//
// - 대상: git이 추적하는 파일 + 아직 추적되지 않았지만 .gitignore에 걸리지 않는 파일
//   (그래서 node_modules·.output·.wxt·.env.local·*.log 같은 산출물과 비밀값은 자동으로 빠진다)
// - 추가 제외: .claude/(개인 도구 설정), release/(이 스크립트의 산출물)
// - 안전장치: .env 계열(.env.example 제외)·개인키·알려진 토큰 형태가 들어 있으면 중단한다
// - 산출: release/<name>-<version>-source.zip, 그리고 .output에 확장 배포본 zip이 있으면 release/로 복사,
//         release/SHA256SUMS.txt
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const prefix = `${pkg.name}-${pkg.version}`;
const releaseDir = join(root, 'release');

const EXCLUDE = [/^\.claude\//, /^release\//, /^node_modules\//, /^\.output\//, /^\.wxt\//, /\.log$/];
const SECRET_FILE = /(^|\/)\.env(\..+)?$/;
const SECRET_CONTENT = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
];
const TEXT_EXT = /\.(md|txt|json|jsonc|ts|tsx|js|mjs|cjs|css|html|ps1|yml|yaml|toml|svg|xml|env|example|nvmrc|gitattributes|gitignore)$/i;

const listed = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

const files = [];
for (const rel of [...new Set(listed)].sort()) {
  if (EXCLUDE.some((re) => re.test(rel))) continue;
  const abs = join(root, rel);
  if (!existsSync(abs) || !statSync(abs).isFile()) continue; // 추적 중이나 작업 폴더에서 지운 파일
  if (SECRET_FILE.test(rel) && !rel.endsWith('.env.example')) {
    throw new Error(`비밀값 파일이 패키지에 들어갈 뻔했습니다: ${rel}`);
  }
  files.push(rel);
}

const entries = {};
let totalBytes = 0;
for (const rel of files) {
  const abs = join(root, rel);
  const buf = readFileSync(abs);
  if (TEXT_EXT.test(rel) && buf.length < 4 * 1024 * 1024) {
    const text = buf.toString('utf8');
    for (const re of SECRET_CONTENT) {
      if (re.test(text)) throw new Error(`비밀값으로 보이는 문자열이 있어 중단합니다: ${rel} (${re})`);
    }
  }
  const mtime = statSync(abs).mtime;
  entries[`${prefix}/${rel}`] = [new Uint8Array(buf), { level: 6, mtime: mtime.getFullYear() >= 1980 ? mtime : new Date() }];
  totalBytes += buf.length;
}

mkdirSync(releaseDir, { recursive: true });
const sourceZip = join(releaseDir, `${prefix}-source.zip`);
writeFileSync(sourceZip, zipSync(entries));

const outputs = [sourceZip];
const extZipName = `${prefix}-edge.zip`;
const extZip = join(root, '.output', extZipName);
if (existsSync(extZip)) {
  const dest = join(releaseDir, extZipName);
  copyFileSync(extZip, dest);
  outputs.push(dest);
} else {
  console.warn(`! .output/${extZipName} 가 없어 확장 배포본은 복사하지 않았습니다. 먼저 npm run zip 을 실행하세요.`);
}

const sums = outputs.map((p) => {
  const sha = createHash('sha256').update(readFileSync(p)).digest('hex');
  return `${sha}  ${p.slice(releaseDir.length + 1)}  (${(statSync(p).size / 1024 / 1024).toFixed(2)} MB)`;
});
writeFileSync(join(releaseDir, 'SHA256SUMS.txt'), sums.join('\n') + '\n');

console.log(`소스 파일 ${files.length}개 (원본 ${(totalBytes / 1024 / 1024).toFixed(1)} MB) → ${sourceZip}`);
console.log(sums.join('\n'));
