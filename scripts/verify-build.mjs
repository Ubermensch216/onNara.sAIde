import { readFileSync, existsSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const dir = '.output/edge-mv3';
const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.minimum_chrome_version, '116');
assert.equal(manifest.default_locale, 'ko');
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
console.log('Edge MV3 manifest and referenced build artifacts verified.');
