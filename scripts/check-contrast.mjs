import assert from 'node:assert/strict';

function luminance(hex) {
  const values = hex.match(/[0-9a-f]{2}/gi).map(value => Number.parseInt(value, 16) / 255);
  const linear = values.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const textPairs = [
  ['light body', '#0f1b2d', '#ffffff'],
  ['light muted', '#526079', '#ffffff'],
  ['light accent', '#1a4fa0', '#ffffff'],
  ['light accent button', '#ffffff', '#1a4fa0'],
  ['light local', '#0b7a75', '#ffffff'],
  ['light ok', '#12704a', '#ffffff'],
  ['light warning', '#9a5b00', '#ffffff'],
  ['light danger', '#b42318', '#ffffff'],
  ['dark body', '#e6edf7', '#152238'],
  ['dark muted', '#93a3bb', '#152238'],
  ['dark accent', '#6aa2f5', '#152238'],
  ['dark accent button', '#0e1726', '#6aa2f5'],
  ['header', '#ffffff', '#0b2545'],
];

for (const [name, foreground, background] of textPairs) {
  const ratio = contrast(foreground, background);
  assert.ok(ratio >= 4.5, `${name}: ${ratio.toFixed(2)}:1 is below WCAG AA`);
}

console.log(`${textPairs.length} color pairs meet WCAG AA.`);
