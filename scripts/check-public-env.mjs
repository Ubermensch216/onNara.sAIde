import { existsSync, readFileSync } from 'node:fs';

const candidates = ['.env', '.env.local', '.env.production', '.env.production.local'];
const secretName = /(?:^|_)(?:API_?KEY|TOKEN|SECRET|PASSWORD|PRIVATE_?KEY)(?:_|$)/i;
const violations = [];

for (const file of candidates) {
  if (!existsSync(file)) continue;
  for (const [index, line] of readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    const match = line.match(/^\s*(WXT_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || !secretName.test(match[1]) || !match[2]) continue;
    violations.push(`${file}:${index + 1} (${match[1]})`);
  }
}

for (const [name, value] of Object.entries(process.env)) {
  if (name.startsWith('WXT_') && secretName.test(name) && value) violations.push(`process.env (${name})`);
}

if (violations.length) {
  throw new Error(`WXT_ 비밀값은 확장 번들에 노출됩니다. 다음 값을 제거하세요:\n${violations.join('\n')}`);
}

console.log('Public WXT environment contains no secret-like values.');
