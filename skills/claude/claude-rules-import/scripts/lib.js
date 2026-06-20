'use strict';
// 共有ヘルパー（外部依存ゼロ）。inventory.js / apply.js / resolve-refs.js から require する。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// 取り込み先プロジェクトルートを解決する。
// CWD を優先し、なければ git のトップレベルにフォールバック。
function resolveProjectRoot() {
  const cwd = process.cwd();
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (top) return top;
  } catch (_) {
    // git 管理外: CWD をルートとして扱う
  }
  return cwd;
}

// 取り込み先の .claude/rules ディレクトリ（絶対パス）。
function targetRulesDir() {
  return path.join(resolveProjectRoot(), '.claude', 'rules');
}

// frontmatter（先頭 --- ... --- ブロック）を簡易パースする。
// YAML ライブラリは使わず、name / title / paths のみ抽出する。
// 戻り値: { data: { name?, title?, paths? }, body: string }
function parseFrontmatter(content) {
  const data = {};
  // 先頭が --- で始まり、次の --- で閉じるブロックのみ対象
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!m) return { data, body: content };

  const block = m[1];
  const body = content.slice(m[0].length);
  const lines = block.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const rawVal = kv[2];

    if (key === 'name' || key === 'title') {
      const v = stripQuotes(rawVal.trim());
      if (v) data[key] = v;
    } else if (key === 'paths') {
      // インラインフロー配列 paths: ["a", "b"] / paths: [a, b]
      const inline = rawVal.trim();
      if (inline.startsWith('[')) {
        data.paths = parseInlineArray(inline);
      } else if (inline === '' || inline === '|' || inline === '>') {
        // ブロックリスト形式: 後続の "- item" 行を収集
        const items = [];
        let j = i + 1;
        for (; j < lines.length; j++) {
          const item = /^\s*-\s+(.*)$/.exec(lines[j]);
          if (!item) break;
          const v = stripQuotes(item[1].trim());
          if (v) items.push(v);
        }
        i = j - 1;
        if (items.length) data.paths = items;
      } else {
        // 単一スカラー paths: "a/**/*"
        const v = stripQuotes(inline);
        if (v) data.paths = [v];
      }
    }
  }
  return { data, body };
}

function stripQuotes(s) {
  if (s.length >= 2) {
    const a = s[0];
    const b = s[s.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

function parseInlineArray(s) {
  // ["a","b"] / [a, b] を最小限にパース
  const inner = s.replace(/^\[/, '').replace(/\]$/, '');
  if (!inner.trim()) return [];
  return inner
    .split(',')
    .map((x) => stripQuotes(x.trim()))
    .filter((x) => x.length > 0);
}

// ディレクトリを再帰走査して .md ファイルの相対パス一覧を返す。
function listMarkdownFiles(rootDir) {
  const out = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        out.push(path.relative(rootDir, full));
      }
    }
  }
  walk(rootDir);
  out.sort();
  return out;
}

// frontmatter / 先頭見出し / ファイル名 の優先順でルール名を導出する。
function deriveName(relpath, fmData, body) {
  if (fmData.name) return fmData.name;
  if (fmData.title) return fmData.title;
  const heading = /^\s*#\s+(.+?)\s*$/m.exec(body);
  if (heading) return heading[1].trim();
  return path.basename(relpath, path.extname(relpath));
}

// abs が base 配下（または base 自身）かどうか。パストラバーサル判定の中核。
function safeUnder(base, abs) {
  const baseResolved = path.resolve(base);
  const dest = path.resolve(abs);
  return dest === baseResolved || dest.startsWith(baseResolved + path.sep);
}

// relpath を base に結合する。base 外を指す場合は null を返す（呼び出し側で拒否）。
function safeJoin(base, relpath) {
  const dest = path.resolve(base, relpath);
  if (!safeUnder(base, dest)) return null;
  return dest;
}

// マークダウンファイルを読み、共通メタ（bytes / sha256 / frontmatter / name）を組み立てる。
// inventory.js と resolve-refs.js が同じ形のエントリを作るための単一実装。
function readEntry(absPath, relpath) {
  const content = fs.readFileSync(absPath, 'utf8');
  const bytes = Buffer.byteLength(content, 'utf8');
  const sha256 = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  const { data, body } = parseFrontmatter(content);
  const name = deriveName(relpath, data, body);
  return { content, bytes, sha256, data, name };
}

module.exports = {
  resolveProjectRoot,
  targetRulesDir,
  parseFrontmatter,
  listMarkdownFiles,
  deriveName,
  safeUnder,
  safeJoin,
  readEntry,
};
