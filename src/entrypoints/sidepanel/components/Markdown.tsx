/**
 * 마크다운 + 코드블록 렌더링. 계획서 Phase 2-6
 *
 * 코드블록만 따로 떼어 하이라이팅·복사 버튼을 붙이고, 나머지는 sanitize된
 * HTML로 그린다. 스트리밍 중에는 하이라이팅을 건너뛴다 — 토큰마다 shiki를
 * 돌리면 21 tok/s에서도 프레임을 놓친다.
 */

import { memo, useEffect, useState } from 'react';
import { highlightCode, renderMarkdown } from '@/lib/markdown';

interface Segment {
  kind: 'md' | 'code';
  text: string;
  lang?: string;
  /** 코드펜스가 아직 닫히지 않았는가 (스트리밍 중) */
  open?: boolean;
}

/** 코드펜스를 기준으로 본문을 쪼갠다. */
function segment(md: string): Segment[] {
  const out: Segment[] = [];
  const re = /```([\w+-]*)[ \t]*\n([\s\S]*?)(```|$)/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(md)) !== null) {
    if (m.index > last) out.push({ kind: 'md', text: md.slice(last, m.index) });
    out.push({
      kind: 'code',
      lang: m[1] || '',
      text: (m[2] ?? '').replace(/\n$/, ''),
      open: m[3] !== '```',
    });
    last = re.lastIndex;
  }
  if (last < md.length) out.push({ kind: 'md', text: md.slice(last) });
  return out;
}

export const Markdown = memo(function Markdown({
  text,
  streaming,
  dark,
}: {
  text: string;
  streaming?: boolean;
  dark: boolean;
}) {
  const segs = segment(text);

  return (
    <div className="md">
      {segs.map((s, i) =>
        s.kind === 'code' ? (
          <CodeBlock
            key={i}
            code={s.text}
            lang={s.lang ?? ''}
            // 아직 닫히지 않은 펜스나 스트리밍 중에는 하이라이팅하지 않는다
            highlight={!streaming && !s.open}
            dark={dark}
          />
        ) : (
          <div
            key={i}
            className="md-body"
            // renderMarkdown이 DOMPurify를 통과시킨 결과다.
            dangerouslySetInnerHTML={{ __html: renderMarkdown(s.text) }}
          />
        ),
      )}
    </div>
  );
});

function CodeBlock({
  code,
  lang,
  highlight,
  dark,
}: {
  code: string;
  lang: string;
  highlight: boolean;
  dark: boolean;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!highlight) {
      setHtml(null);
      return;
    }
    let alive = true;
    highlightCode(code, lang, dark).then((h) => {
      if (alive) setHtml(h);
    });
    return () => {
      alive = false;
    };
  }, [code, lang, highlight, dark]);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="code">
      <div className="code-head">
        <span className="code-lang">{lang || 'text'}</span>
        <button className="code-copy" onClick={copy}>
          {copied ? '복사됨' : '복사'}
        </button>
      </div>
      {html ? (
        <div className="code-body" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="code-body">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
