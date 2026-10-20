# alireza-taheriF.github.io

Personal portfolio and blog. Static site, built with a small Node script and deployed with GitHub Pages.

- `index.html`, `style.css`, `site.js` – the portfolio
- `posts/*.md` – blog posts (front matter + Markdown)
- `build.mjs` – turns posts into HTML, an RSS feed and a sitemap
- `ingest.mjs` – reads your Telegram bot, translates Persian text to English with Claude, and writes a new post
- `.github/workflows/site.yml` – runs the bot every five minutes and deploys the site

Setup steps (in Persian) are in `SETUP.fa.md`.

## Local build

```
node build.mjs   # output in dist/
```
