/**
 * 약관 문서(docs/privacy-policy.md, docs/terms.md)를 서버가 보여 줄 HTML 페이지로 바꾼다.
 * 문서에 쓰는 문법만 다룬다: 제목(#·##·###), 문단, 목록(- · 1.), 표, 굵게(**), 링크, 맨 주소, 표 안의 <br>.
 * 외부 라이브러리 없이 순수 함수로 두어 테스트에서 저장된 HTML과 그대로 비교한다.
 */

/** 문서 사이 링크(GitHub 상대 경로)를 서버 주소로 바꾼다 */
const LINK_MAP: Record<string, string> = {
  'privacy-policy.md': '/privacy',
  'terms.md': '/terms',
};

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 한 줄 안의 꾸밈: 굵게, [글](주소), 맨 http(s) 주소, 이메일. 표 칸의 <br>만 태그로 살린다 */
export function renderInline(text: string): string {
  const links: string[] = [];
  // 링크를 먼저 자리표시로 빼 두어 주소 안의 글자가 다른 규칙에 걸리지 않게 한다
  let out = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => {
    const target = LINK_MAP[href] ?? href;
    links.push(`<a href="${escapeHtml(target)}">${escapeHtml(label)}</a>`);
    return `\uE000${links.length - 1}\uE000`;
  });
  out = out.replace(/https?:\/\/[^\s<>|)]+/g, (url) => {
    links.push(`<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);
    return `\uE000${links.length - 1}\uE000`;
  });
  out = out.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, (email) => {
    links.push(`<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`);
    return `\uE000${links.length - 1}\uE000`;
  });
  out = escapeHtml(out)
    .replace(/&lt;br&gt;/g, '<br>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return out.replace(/\uE000(\d+)\uE000/g, (_, i: string) => links[Number(i)]);
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** 마크다운 본문 → HTML 조각 */
export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i++;
      continue;
    }
    if (line.startsWith('|')) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const [head, , ...body] = rows; // 두 번째 줄은 |---| 구분선
      const th = splitRow(head).map((c) => `<th>${renderInline(c)}</th>`).join('');
      const trs = body.map((r) => `<tr>${splitRow(r).map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`).join('');
      html.push(`<div class="table"><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`);
      continue;
    }
    const bullet = /^- (.*)$/;
    const numbered = /^\d+\. (.*)$/;
    if (bullet.test(line) || numbered.test(line)) {
      const pattern = bullet.test(line) ? bullet : numbered;
      const tag = pattern === bullet ? 'ul' : 'ol';
      const items: string[] = [];
      while (i < lines.length && pattern.test(lines[i])) {
        items.push(`<li>${renderInline((pattern.exec(lines[i]) as RegExpExecArray)[1])}</li>`);
        i++;
      }
      html.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }
    // 문단: 빈 줄이나 다른 블록이 나올 때까지 이어진 줄을 한 문단으로
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3} |\||- |\d+\. )/.test(lines[i])) para.push(lines[i++].trim());
    html.push(`<p>${renderInline(para.join(' '))}</p>`);
  }
  return html.join('\n');
}

const STYLE = `
:root{color-scheme:light dark;--bg:#e8e9ed;--card:#ffffff;--text:#2b2d33;--strong:#15161b;--sub:#5d606b;--line:#dcdee4;--link:#0a6f99}
@media (prefers-color-scheme:dark){:root{--bg:#15161b;--card:#202228;--text:#d9dbe1;--strong:#ffffff;--sub:#a3a7b3;--line:#33363e;--link:#5fd0ff}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.7 -apple-system,system-ui,"Malgun Gothic",sans-serif;word-break:keep-all;overflow-wrap:break-word}
main{max-width:760px;margin:0 auto;padding:24px 16px 48px}
article{background:var(--card);border-radius:20px;padding:28px 22px}
nav{display:flex;gap:16px;margin:0 4px 16px;font-size:15px}
nav a[aria-current]{color:var(--strong);font-weight:700;text-decoration:none}
h1{margin:0 0 8px;font-size:24px;line-height:1.35;color:var(--strong)}
h2{margin:32px 0 8px;padding-top:20px;border-top:1px solid var(--line);font-size:19px;color:var(--strong)}
h3{margin:22px 0 6px;font-size:17px;color:var(--strong)}
p,ul,ol{margin:8px 0}
ul,ol{padding-left:22px}
li{margin:4px 0}
a{color:var(--link)}
strong{color:var(--strong)}
.table{overflow-x:auto;margin:12px 0}
table{border-collapse:collapse;min-width:100%;font-size:14px;line-height:1.55}
th,td{padding:8px 10px;border:1px solid var(--line);text-align:left;vertical-align:top}
th{background:var(--bg);color:var(--strong);white-space:nowrap}
footer{margin:20px 4px 0;font-size:14px;color:var(--sub)}
`.trim();

/** 문서 하나를 완성된 HTML 페이지로. 외부 리소스를 하나도 불러오지 않는다 */
export function renderLegalPage(markdown: string, current: '/privacy' | '/terms'): string {
  const title = /^# (.+)$/m.exec(markdown)?.[1] ?? '아케이드박스';
  const navLink = (href: '/privacy' | '/terms', label: string) =>
    `<a href="${href}"${href === current ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="64x64" href="/favicon-64.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>${STYLE}</style>
</head>
<body>
<main>
<nav>${navLink('/privacy', '개인정보처리방침')}${navLink('/terms', '이용약관')}</nav>
<article>
${renderMarkdown(markdown)}
</article>
<footer>아케이드박스</footer>
</main>
</body>
</html>
`;
}
