import { readFileSync, existsSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const dir = '.output/edge-mv3';
const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.minimum_chrome_version, '116');
assert.equal(manifest.default_locale, 'ko');
assert.equal(manifest.storage?.managed_schema, 'managed-policy.json');
assert.ok(existsSync(`${dir}/${manifest.storage.managed_schema}`), 'Missing managed policy schema');
assert.ok(manifest.content_security_policy?.extension_pages.includes("img-src 'self' data: blob:"), 'Model output must not load remote images');
assert.equal(manifest.short_name, '온나라 sAIde');
assert.ok(manifest.permissions.includes('webNavigation'), 'iframe discovery requires webNavigation');
assert.ok(manifest.content_scripts?.some(cs => cs.js?.includes('drawer.js')), 'Drafter drawer script must be registered in content_scripts');
assert.ok(manifest.host_permissions.includes('http://localhost:11434/*'), 'Ollama host permission must be included');
// 본문이 PDF 뷰어로 표시되는 문서를 읽으려면 오프스크린 문서와 pdf.js 워커가 함께 실려야 한다.
assert.ok(manifest.permissions.includes('offscreen'), 'PDF body reading requires the offscreen permission');
assert.ok(manifest.web_accessible_resources?.length, 'Drawer iframe requires web_accessible_resources');
for (const file of [manifest.background.service_worker, manifest.side_panel.default_path, manifest.options_ui.page, 'injected.js', 'drawer.js', 'drawer-page.html', 'offscreen.html', ...Object.values(manifest.icons)]) {
  assert.ok(existsSync(`${dir}/${file}`), `Missing build artifact: ${file}`);
}
assert.ok(readdirSync(`${dir}/assets`).some(file => /^pdf\.worker.*\.mjs$/.test(file)), 'Missing pdf.js worker asset');
// 글꼴을 넣지 않은 한글 PDF는 이 CMap이 없으면 한 글자도 읽지 못한다.
assert.ok(readdirSync(`${dir}/cmaps`).includes('UniKS-UCS2-H.bcmap'), 'Missing Korean CMap files');
// 기관별로 다른 온나라 서버 주소를 매니페스트에 박아 두지 않는다(어느 기관에서도 같은 빌드가 동작해야 한다).
// 루프백(Ollama 로컬 주소)만 예외다.
const manifestHosts = [...manifest.host_permissions, ...(manifest.content_scripts ?? []).flatMap(cs => cs.matches ?? [])];
const hardcodedIps = manifestHosts.filter(h => /(?<![\d.])\d{1,3}(\.\d{1,3}){3}(?![\d.])/.test(h) && !/^https?:\/\/127\.0\.0\.1(:\d+)?\//.test(h));
assert.deepEqual(hardcodedIps, [], `Manifest must not hard-code server IPs: ${hardcodedIps.join(', ')}`);

// 확장 ID 고정 검사: manifest.key에서 계산한 ID가 약속한 값과 같아야 한다(키를 실수로 바꾸면 사용자 저장소가 분리된다).
// 웹 스토어용 빌드(SAIDE_OMIT_EXTENSION_KEY=1)는 키가 없는 것이 정상이다.
const EXPECTED_EXTENSION_ID = 'popnobbmpmholgejlcflnkmicegjmjah';
if (process.env.SAIDE_OMIT_EXTENSION_KEY) {
  assert.equal(manifest.key, undefined, 'Store build must not contain manifest.key');
} else {
  assert.ok(manifest.key, 'manifest.key (fixed extension ID) is missing');
  const hash = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest().subarray(0, 16);
  const id = [...hash].map(b => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15))).join('');
  assert.equal(id, EXPECTED_EXTENSION_ID, `Extension ID changed: ${id}`);
  console.log(`Fixed extension ID: ${id}`);
}
console.log('Edge MV3 manifest and referenced build artifacts verified.');
