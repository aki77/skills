#!/usr/bin/env node
'use strict';
// scan-markers.js — ルールファイル中の「プロジェクト固有の可能性が高いトークン」を
// 行単位で検出してフラグ付けする。置換・汎用化はしない（Claude の判断材料）。
//
// 使い方:
//   node scan-markers.js <rulesDir> --relpaths a.md,sub/b.md --hint owner,repo
//   （--relpaths 省略時は rulesDir 内の全 .md を対象）
//
// 出力(stdout): [{ relpath, line, type, match }]

const fs = require('fs');
const path = require('path');
const { listMarkdownFiles } = require('./lib');

function die(msg, code) {
  process.stderr.write(msg + '\n');
  process.exit(code == null ? 1 : code);
}

// --- 引数パース ---
const argv = process.argv.slice(2);
const rulesDir = argv[0];
if (!rulesDir) die('Usage: scan-markers.js <rulesDir> [--relpaths a,b] [--hint owner,repo]', 1);
if (!fs.existsSync(rulesDir) || !fs.statSync(rulesDir).isDirectory()) {
  die('Not a directory: ' + rulesDir, 1);
}

let relpaths = null;
let hints = [];
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === '--relpaths' && argv[i + 1]) {
    relpaths = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
  } else if (argv[i] === '--hint' && argv[i + 1]) {
    hints = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
  }
}

const targets = relpaths && relpaths.length ? relpaths : listMarkdownFiles(rulesDir);

// --- 検出ルール ---
// 各ルール: { type, re } — re は g フラグ付きで行ごとに exec する。
const RULES = [
  // シークレットらしき行（key/token/secret/password の近傍に値がある）
  {
    type: 'secret',
    re: /\b(?:api[_-]?key|secret|token|password|passwd|access[_-]?key|private[_-]?key|bearer)\b\s*[:=]\s*\S+/gi,
  },
  // メールアドレス
  { type: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // URL
  { type: 'url', re: /\bhttps?:\/\/[^\s)\]>"']+/g },
  // IPv4
  { type: 'ip', re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  // 絶対パス（Unix）。.claude/rules の相対パスは拾わない
  { type: 'abs-path', re: /(?:^|\s)(\/(?:[\w.-]+\/){1,}[\w.-]+)/g },
  // JIRA キー（ABC-123）
  { type: 'ticket', re: /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g },
  // GitHub Issue/PR 参照（#123）
  { type: 'issue-ref', re: /(?:^|\s)(#\d+)\b/g },
];

// ヒント（org/repo 名）を追加ルール化
const hintRe =
  hints.length > 0
    ? new RegExp(
        '\\b(' + hints.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b',
        'g'
      )
    : null;

const findings = [];

for (const relpath of targets) {
  const abs = path.join(rulesDir, relpath);
  if (!fs.existsSync(abs)) continue;
  const content = fs.readFileSync(abs, 'utf8');
  const lines = content.split(/\r?\n/);

  lines.forEach((lineText, idx) => {
    const lineNo = idx + 1;
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(lineText)) !== null) {
        // キャプチャグループがある（先頭空白対策）ものは m[1] を使う
        const matched = (m[1] != null ? m[1] : m[0]).trim();
        if (matched) findings.push({ relpath, line: lineNo, type: rule.type, match: matched });
        if (m.index === rule.re.lastIndex) rule.re.lastIndex++; // 無限ループ防止
      }
    }
    if (hintRe) {
      hintRe.lastIndex = 0;
      let m;
      while ((m = hintRe.exec(lineText)) !== null) {
        findings.push({ relpath, line: lineNo, type: 'org-repo-name', match: m[1] });
        if (m.index === hintRe.lastIndex) hintRe.lastIndex++;
      }
    }
  });
}

process.stdout.write(JSON.stringify(findings, null, 2) + '\n');
