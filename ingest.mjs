// Telegram -> Claude translation -> posts/<slug>.md
// Runs in GitHub Actions every few minutes. Needs: TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USER_ID.
// Translation provider (first one available wins, or force with LLM_PROVIDER):
//   github    free, uses the workflow's own GITHUB_TOKEN (GitHub Models), no extra key
//   gemini    GEMINI_API_KEY (Google AI Studio free tier)
//   anthropic ANTHROPIC_API_KEY
import fs from 'node:fs/promises';
import path from 'node:path';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED = (process.env.TELEGRAM_ALLOWED_USER_ID || '').trim();
const env = (k) => (process.env[k] || '').trim();
const PROVIDER = env('LLM_PROVIDER') || (env('GEMINI_API_KEY') ? 'gemini' : env('ANTHROPIC_API_KEY') ? 'anthropic' : env('GITHUB_TOKEN') ? 'github' : '');
const MODEL_OVERRIDE = env('LLM_MODEL');
const SITE = (process.env.SITE_URL || '').replace(/\/$/, '');
const SETTLE_SECONDS = 90;      // wait until the last message is this old, so split messages arrive together
// GitHub Models caps each request at 8000 input / 4000 output tokens, so chunks stay small there.
const CHUNK_CHARS = PROVIDER === 'github' ? 3200 : 6500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setOutput = async (k, v) => { if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };

async function tg(method, body = {}) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description}`);
  return j.result;
}
const say = (chat_id, text) => tg('sendMessage', { chat_id, text, disable_web_page_preview: true }).catch((e) => console.error(e.message));

const wait = (r) => { const h = r.headers.get('retry-after'); const n = h ? Number(h) : NaN; return Number.isFinite(n) ? n : null; };

async function post(url, headers, body) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    if (r.ok) return r.json();
    const text = (await r.text()).slice(0, 300);
    const err = Object.assign(new Error(`${r.status}: ${text}`), { status: r.status });
    if ([429, 500, 502, 503, 529].includes(r.status)) {
      const ra = wait(r);
      if (ra !== null && ra > 90) { err.longWait = true; throw err; }      // daily limit: do not sit and wait
      await sleep(Math.min(60000, (ra !== null ? ra * 1000 : 2000 * 2 ** i)));
      continue;
    }
    throw err;
  }
  throw new Error('The translation service is busy right now');
}

async function llmGithub(system, user, max) {
  const models = [MODEL_OVERRIDE || 'openai/gpt-4.1', 'openai/gpt-4.1-mini'];
  let last;
  for (const model of models) {
    try {
      const j = await post('https://models.github.ai/inference/chat/completions',
        { authorization: `Bearer ${env('GITHUB_TOKEN')}`, accept: 'application/json' },
        { model, max_tokens: Math.min(max, 3500), temperature: 0.3, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] });
      await sleep(1500);   // stay under the per-minute limit
      return (j.choices?.[0]?.message?.content || '').trim();
    } catch (e) {
      last = e;
      if (![400, 403, 404, 429].includes(e.status)) throw e;   // try the next (lighter) model
    }
  }
  throw new Error(last?.longWait ? 'The free daily limit of GitHub Models is used up. Try again tomorrow.' : `GitHub Models error ${last?.message}`);
}

async function llmGemini(system, user, max) {
  const model = MODEL_OVERRIDE || 'gemini-2.5-flash';
  const j = await post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    { 'x-goog-api-key': env('GEMINI_API_KEY') },
    { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { maxOutputTokens: max, temperature: 0.3 } });
  return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
}

async function llmAnthropic(system, user, max) {
  const j = await post('https://api.anthropic.com/v1/messages',
    { 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' },
    { model: MODEL_OVERRIDE || 'claude-sonnet-5-5', max_tokens: max, system, messages: [{ role: 'user', content: user }] });
  return j.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

async function llm(system, user, max = 8000) {
  if (PROVIDER === 'github') return llmGithub(system, user, max);
  if (PROVIDER === 'gemini') return llmGemini(system, user, max);
  if (PROVIDER === 'anthropic') return llmAnthropic(system, user, max);
  throw new Error('No translation provider is configured.');
}

const TRANSLATE_SYSTEM = `You are a literary translator and editor for a personal blog.
Translate the Persian text inside <text> into fluent, natural, publication-ready English.
- Keep the author's voice, tone, rhythm and meaning. Do not summarise, add, explain or omit anything.
- Prefer idiomatic English over word-for-word translation. Use the common English spelling of names and places.
- Render poetry as poetry, keeping line breaks.
- The text was sent through Telegram and may be split into parts. If a paragraph break falls in the middle of a sentence, join it again.
- Format as clean Markdown: normal paragraphs, "##" or "###" headings only where the source clearly has section titles, lists and quotes where the source has them. Never use a single "#" heading.
- If the text is already English, only polish flow and fix typos.
- <previous_context> (if present) is the end of the previous section, for continuity only. Do not translate it again.
Output only the translated Markdown. No preface, no notes.`;

const META_SYSTEM = `You write metadata for a blog post. Reply with a single JSON object and nothing else:
{"title": string (max 70 chars, plain and specific, no clickbait), "excerpt": string (one or two sentences, max 170 chars), "tags": array of 2 to 4 short lowercase tags}`;

function splitLong(par, max) {
  if (par.length <= max) return [par];
  const out = []; let cur = '';
  for (const s of par.split(/(?<=[.!?؟…])\s+/)) {
    if ((cur + ' ' + s).length > max && cur) { out.push(cur); cur = s; } else cur = cur ? cur + ' ' + s : s;
  }
  if (cur) out.push(cur);
  return out.flatMap((x) => x.length > max ? x.match(new RegExp(`[\\s\\S]{1,${max}}`, 'g')) : [x]);
}

function chunkText(text, max = CHUNK_CHARS) {
  const chunks = []; let cur = '';
  for (const p of text.split(/\n{2,}/).flatMap((x) => splitLong(x, max))) {
    if ((cur + '\n\n' + p).length > max && cur) { chunks.push(cur); cur = p; } else cur = cur ? cur + '\n\n' + p : p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'post';
const isPersian = (s) => { const L = (s.match(/\p{L}/gu) || []).length || 1; return (s.match(/[؀-ۿ]/g) || []).length / L > 0.3; };

async function translate(text) {
  const chunks = chunkText(text);
  const out = [];
  for (let i = 0; i < chunks.length; i++) {
    const ctx = out.length ? `<previous_context>\n${out[out.length - 1].slice(-700)}\n</previous_context>\n` : '';
    out.push(await llm(TRANSLATE_SYSTEM, `${ctx}<text>\n${chunks[i]}\n</text>`));
  }
  return out.join('\n\n').replace(/^#\s+.+\n+/, '');
}

async function metadata(english) {
  const sample = english.length > 5000 ? english.slice(0, 4000) + '\n...\n' + english.slice(-1000) : english;
  const raw = await llm(META_SYSTEM, sample, 600);
  try {
    const j = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    return { title: String(j.title).slice(0, 90), excerpt: String(j.excerpt).slice(0, 200), tags: (j.tags || []).map((t) => slugify(String(t))).filter(Boolean).slice(0, 4) };
  } catch {
    const first = english.replace(/[#*_>`]/g, '').trim().split(/\n/)[0];
    return { title: first.slice(0, 60) || 'Untitled', excerpt: first.slice(0, 160), tags: [] };
  }
}

async function uniqueSlug(base) {
  let slug = base, n = 2;
  const exists = async (s) => fs.access(path.join('posts', `${s}.md`)).then(() => true, () => false);
  while (await exists(slug)) slug = `${base}-${n++}`;
  return slug;
}

async function publish(original, dateIso) {
  const sourceLang = isPersian(original) ? 'fa' : 'en';
  const body = await translate(original);
  const meta = await metadata(body);
  const slug = await uniqueSlug(slugify(meta.title));
  const fm = ['---', `title: ${JSON.stringify(meta.title)}`, `date: ${dateIso}`, `excerpt: ${JSON.stringify(meta.excerpt)}`, `tags: ${JSON.stringify(meta.tags)}`, `source_lang: ${sourceLang}`, '---', ''].join('\n');
  await fs.mkdir('posts', { recursive: true });
  await fs.writeFile(path.join('posts', `${slug}.md`), `${fm}\n${body}\n`);
  return { slug, title: meta.title };
}

async function download(file_id) {
  const f = await tg('getFile', { file_id });
  const r = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${f.file_path}`);
  if (!r.ok) throw new Error(`Could not download file (${r.status})`);
  return r.text();
}

const HELP = (id) => `Send me your text and I will translate it into English and post it on your blog.

• Long texts can be sent as several messages, or as a .txt / .md file.
• Wait about two minutes after the last message. The bot checks every five minutes or so.
• To publish several posts at once, put a line with only /// between them.
• /cancel throws away what you sent since the last post.

Your Telegram ID: ${id}`;

async function selftest() {
  const sample = 'یادگیری ماشین فقط ریاضی نیست؛ پرسش اصلی این است که یک مدل با آدمی که از آن استفاده می‌کند چه می‌کند.';
  console.log(`Provider: ${PROVIDER || 'none'}`);
  const out = await translate(sample + '\n\n' + sample);
  console.log('Translation:\n' + out);
  if (!/[a-z]{4,}/i.test(out) || /[\u0600-\u06FF]{6,}/.test(out)) throw new Error('Output does not look like English');
  console.log('SELFTEST OK');
}

async function main() {
  if (process.argv.includes('--selftest')) return selftest();
  await setOutput('changed', 'false');
  if (!TOKEN) { console.log('TELEGRAM_BOT_TOKEN is not set. Nothing to do.'); return; }

  const updates = await tg('getUpdates', { timeout: 0, allowed_updates: ['message'] });
  if (!updates.length) { console.log('No new messages.'); return; }
  const lastId = Math.max(...updates.map((u) => u.update_id));
  const confirm = () => tg('getUpdates', { offset: lastId + 1, timeout: 0, allowed_updates: ['message'] });

  const messages = updates.map((u) => u.message).filter((m) => m && m.chat?.type === 'private');

  // First run: tell the owner their numeric ID so they can add it as a secret.
  if (!ALLOWED) {
    for (const id of new Set(messages.map((m) => m.chat.id))) await say(id, `Bot is connected.\n\nYour Telegram ID is ${id}.\nAdd it to GitHub as the secret TELEGRAM_ALLOWED_USER_ID, then send me a text.`);
    await confirm();
    return;
  }

  const mine = messages.filter((m) => String(m.from?.id) === ALLOWED);
  if (!mine.length) { await confirm(); return; }

  const newest = Math.max(...mine.map((m) => m.date));
  const onlyCommands = mine.every((m) => /^\/(start|help|cancel)\b/.test(m.text || ''));
  if (!onlyCommands && Date.now() / 1000 - newest < SETTLE_SECONDS) { console.log('Waiting for the last message to settle.'); return; }

  const chat = mine[0].chat.id;
  const posts = [[]];
  let lastDate = newest;
  for (const m of mine) {
    const t = (m.text || '').trim();
    if (/^\/(start|help)\b/.test(t)) { await say(chat, HELP(ALLOWED)); continue; }
    if (/^\/cancel\b/.test(t)) { posts.length = 0; posts.push([]); await say(chat, 'Discarded. Send the text again whenever you like.'); continue; }
    let content = '';
    if (m.document) {
      const okType = /^text\//.test(m.document.mime_type || '') || /\.(txt|md|markdown)$/i.test(m.document.file_name || '');
      if (!okType || (m.document.file_size || 0) > 1_000_000) { await say(chat, 'I can only read .txt or .md files up to 1 MB. Paste the text instead.'); continue; }
      try { content = (await download(m.document.file_id)).trim(); } catch (e) { await say(chat, e.message); continue; }
    } else if (m.text) {
      content = m.text;
    } else continue;
    for (const piece of content.split(/^\s*\/\/\/\s*$/m)) {
      if (piece === content) posts[posts.length - 1].push(piece);
      else { posts[posts.length - 1].push(piece); posts.push([]); }
    }
  }

  const texts = posts.map((p) => p.join('\n\n').trim()).filter((t) => t.length > 0);
  let changed = false;
  for (const text of texts) {
    if (text.length < 40) { await say(chat, 'That text is very short, so I skipped it.'); continue; }
    await say(chat, `Got ${text.length.toLocaleString('en')} characters. Translating now.`);
    try {
      const { slug, title } = await publish(text, new Date(lastDate * 1000).toISOString());
      changed = true;
      await say(chat, `Done: "${title}"\n${SITE ? `${SITE}/blog/${slug}/` : `/blog/${slug}/`}\nIt will be live in about a minute.`);
    } catch (e) {
      console.error(e);
      await say(chat, `Translation failed: ${e.message}\nPlease send the text again.`);
    }
  }
  await confirm();
  await setOutput('changed', changed ? 'true' : 'false');
}

main().catch((e) => { console.error(e); process.exit(1); });
