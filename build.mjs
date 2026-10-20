// Static build: posts/*.md -> dist/ (blog index, one page per post, posts.json, feed.xml, sitemap.xml)
import fs from 'node:fs/promises';
import path from 'node:path';
import { render, esc } from './md.mjs';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const SITE = (process.env.SITE_URL || 'https://alireza-taherif.github.io').replace(/\/$/, '');
const NAME = 'Alireza Taheri';

const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function parseFrontMatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: raw };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (val.startsWith('"') || val.startsWith('[')) { try { val = JSON.parse(val); } catch { /* keep string */ } }
    else if (val === 'true') val = true;
    else if (val === 'false') val = false;
    data[key] = val;
  }
  return { data, body: m[2] };
}

const head = ({ title, desc, url, type = 'website' }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="${type}">
<meta property="og:url" content="${SITE}${url}">
<link rel="canonical" href="${SITE}${url}">
<meta name="theme-color" content="#F1F2F6" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0C0D12" media="(prefers-color-scheme: dark)">
<link rel="alternate" type="application/rss+xml" title="${NAME}" href="/feed.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,300..800&family=DM+Mono:wght@400;500&family=Hanken+Grotesk:ital,wght@0,400;0,500;0,600;1,400&display=swap">
<script src="/theme-init.js"></script>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div class="wrap">
  <header class="bar">
    <a class="mono" href="/">A. Taheri</a>
    <nav class="mono" aria-label="Sections">
      <a href="/#work">Work</a>
      <a href="/blog/" aria-current="page">Writing</a>
      <a href="/#contact">Contact</a>
      <button class="theme-btn mono" id="themeBtn" type="button" aria-label="Switch colour theme">Theme</button>
    </nav>
  </header>
`;

const foot = `
  <footer>
    <span>© ${new Date().getUTCFullYear()} ${NAME}</span>
    <span class="mono"><a href="/feed.xml">RSS</a></span>
  </footer>
</div>
<script src="/site.js"></script>
</body>
</html>
`;

async function loadPosts() {
  let files = [];
  try { files = await fs.readdir(path.join(ROOT, 'posts')); } catch { /* no posts yet */ }
  const posts = [];
  for (const f of files) {
    if (!f.endsWith('.md') || f.startsWith('_')) continue;
    const raw = await fs.readFile(path.join(ROOT, 'posts', f), 'utf8');
    const { data, body } = parseFrontMatter(raw);
    if (data.draft === true) continue;
    const slug = f.replace(/\.md$/, '');
    const words = body.trim().split(/\s+/).filter(Boolean).length;
    const date = data.date ? new Date(data.date).toISOString() : new Date(0).toISOString();
    posts.push({
      slug,
      title: data.title || slug,
      date,
      excerpt: data.excerpt || '',
      tags: Array.isArray(data.tags) ? data.tags : [],
      lang: data.source_lang || 'en',
      minutes: Math.max(1, Math.round(words / 220)),
      body,
    });
  }
  posts.sort((a, b) => b.date.localeCompare(a.date));
  return posts;
}

function postPage(p, newer, older) {
  const html = render(p.body);
  const tags = p.tags.map((t) => `<span class="tag mono">${esc(t)}</span>`).join('');
  const translated = p.lang === 'fa' ? '<span>Translated from Persian</span>' : '';
  const nav = [
    older ? `<a href="/blog/${esc(older.slug)}/">← ${esc(older.title)}</a>` : '<span></span>',
    newer ? `<a href="/blog/${esc(newer.slug)}/">${esc(newer.title)} →</a>` : '<span></span>',
  ].join('');
  return head({ title: `${p.title} · ${NAME}`, desc: p.excerpt || p.title, url: `/blog/${p.slug}/`, type: 'article' }) + `
  <main class="post-wrap">
    <a class="back mono" href="/blog/">← All posts</a>
    <article>
      <header class="post-head">
        <div class="post-meta mono"><span>${fmtDate(p.date)}</span><span>${p.minutes} min read</span>${translated}</div>
        <h1>${esc(p.title)}</h1>
        ${p.excerpt ? `<p class="excerpt">${esc(p.excerpt)}</p>` : ''}
        ${tags ? `<div class="post-meta" style="margin-top:20px">${tags}</div>` : ''}
      </header>
      <div class="prose">
${html}
      </div>
    </article>
    <nav class="post-foot" aria-label="More posts">${nav}</nav>
  </main>
` + foot;
}

function blogIndex(posts) {
  const rows = posts.length
    ? `<ul class="rows">` + posts.map((p) => `
      <li class="row"><a href="/blog/${esc(p.slug)}/">
        <div>
          <h3>${esc(p.title)}</h3>
          <p>${esc(p.excerpt)}</p>
          ${p.tags.length ? `<div class="tags mono">${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
        </div>
        <div class="meta mono"><span>${fmtDate(p.date)}</span><span>${p.minutes} min</span><span class="arrow">↗</span></div>
      </a></li>`).join('') + `\n    </ul>`
    : `<p class="empty">No posts yet. The first one is on its way.</p>`;
  return head({ title: `Writing · ${NAME}`, desc: 'Essays and notes by Alireza Taheri, written in Persian and translated into English.', url: '/blog/' }) + `
  <main>
    <div class="page-head">
      <h1>Writing</h1>
      <p>Essays and notes, written in Persian and translated into English.</p>
    </div>
    <div class="list">
    ${rows}
    </div>
  </main>
` + foot;
}

function feed(posts) {
  const items = posts.slice(0, 20).map((p) => `
    <item>
      <title>${esc(p.title)}</title>
      <link>${SITE}/blog/${p.slug}/</link>
      <guid>${SITE}/blog/${p.slug}/</guid>
      <pubDate>${new Date(p.date).toUTCString()}</pubDate>
      <description>${esc(p.excerpt)}</description>
    </item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>${NAME}</title>
  <link>${SITE}/blog/</link>
  <description>Essays and notes, translated from Persian.</description>${items}
</channel></rss>
`;
}

function sitemap(posts) {
  const urls = ['/', '/blog/', ...posts.map((p) => `/blog/${p.slug}/`)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE}${u}</loc></url>`).join('\n')}
</urlset>
`;
}

async function copyIfExists(src, dst) {
  try { await fs.cp(path.join(ROOT, src), path.join(DIST, dst), { recursive: true }); } catch { /* optional */ }
}

async function main() {
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(path.join(DIST, 'blog'), { recursive: true });
  await copyIfExists('index.html', 'index.html');
  for (const f of ['style.css', 'site.js', 'theme-init.js']) await copyIfExists(f, f);
  await copyIfExists('CNAME', 'CNAME');
  await copyIfExists('404.html', '404.html');

  const posts = await loadPosts();
  for (let i = 0; i < posts.length; i++) {
    const dir = path.join(DIST, 'blog', posts[i].slug);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'index.html'), postPage(posts[i], posts[i - 1], posts[i + 1]));
  }
  await fs.writeFile(path.join(DIST, 'blog', 'index.html'), blogIndex(posts));
  await fs.writeFile(path.join(DIST, 'posts.json'), JSON.stringify(posts.map(({ body, ...rest }) => rest), null, 2));
  await fs.writeFile(path.join(DIST, 'feed.xml'), feed(posts));
  await fs.writeFile(path.join(DIST, 'sitemap.xml'), sitemap(posts));
  await fs.writeFile(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
  console.log(`Built ${posts.length} post(s) into dist/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
