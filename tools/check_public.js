'use strict';
// Before pushing: scan every file that would be published (all files minus .gitignore'd ones) and the
// built site/ for this PC's private details. Generic patterns are below; personal ones (names, email,
// paths) live in the git-ignored private-patterns.txt so they are never published themselves.
// Usage: node tools/check_public.js      (exit code 1 if anything is found)
//        node tools/check_public.js --all   also scan ignored files, to see the check catch things

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GENERIC = [
  /\b[A-Z]:\\(?![\\nrt"'])/,   // Windows drive paths (not "\n" etc. in strings)
  /\b[A-Z]:\/[\w ]/,           // drive paths written with /
  /file:\/\/\/[A-Za-z]:/,
  /[\\/]Users[\\/][^\\/\s]+/i,
  /App[D]ata/i,                // written so this file does not match itself
  /\S+@\S+\.(com|net|org)\b/i, // e-mail addresses (allow-listed below)
];
const ALLOWED_EMAIL = /noreply@|@users\.noreply\.github\.com/i;

const personal = fs.existsSync(path.join(ROOT, 'private-patterns.txt'))
  ? fs.readFileSync(path.join(ROOT, 'private-patterns.txt'), 'utf8').split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#')).map((l) => new RegExp(l, 'i'))
  : [];
if (!personal.length) console.log('note: no private-patterns.txt, checking generic patterns only');

// Minimal .gitignore reading: one name or folder/ per line, matched anywhere in the path.
const ignored = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/)
  .map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.replace(/\/$/, ''));
// Files that must never be published, whatever their content: fail if .gitignore stops covering them.
const MUST_IGNORE = ['handover.md', 'data', 'start.local.bat', 'private-patterns.txt', '.svn'];
const uncovered = MUST_IGNORE.filter((f) => !ignored.includes(f));
if (uncovered.length) {
  console.log(`NOT git-ignored but must be: ${uncovered.join(', ')}`);
  process.exitCode = 1;
}
const ALL = process.argv.includes('--all');
const isIgnored = (rel) => rel.startsWith('.svn/') || rel.startsWith('.git/') || rel.startsWith('site/') || rel.startsWith('data/')
  || rel === 'private-patterns.txt' || (!ALL && rel.split('/').some((seg) => ignored.includes(seg)));

function* walk(dir, rel = '') {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) yield* walk(path.join(dir, e.name), r);
    else yield r;
  }
}

const TEXT = /\.(js|json|html|css|md|txt|yml|yaml|bat|cmd|ps1)$|^\.gitignore$/i;
let problems = 0;
const scan = (rel, abs) => {
  if (!TEXT.test(path.basename(rel))) return;
  fs.readFileSync(abs, 'utf8').split(/\r?\n/).forEach((line, i) => {
    for (const re of [...GENERIC, ...personal]) {
      const m = re.exec(line);
      if (!m || (re === GENERIC[5] && ALLOWED_EMAIL.test(m[0]))) continue;
      problems++;
      console.log(`${rel}:${i + 1}: "${m[0]}"  (${re})`);
    }
  });
};

let files = 0;
for (const rel of walk(ROOT)) if (!isIgnored(rel)) { files++; scan(rel, path.join(ROOT, rel)); }
const site = path.join(ROOT, 'site');
if (fs.existsSync(site)) for (const rel of walk(site)) { files++; scan(`site/${rel}`, path.join(site, rel)); }

console.log(problems ? `${problems} possible leaks in ${files} files` : `clean: ${files} files checked`);
process.exit(problems || process.exitCode ? 1 : 0);
