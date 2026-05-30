#!/usr/bin/env node
'use strict';
// apply.js — マニフェストを受け取り、バックアップ付きで ./.claude/rules へ書き込む。
//
// 使い方:
//   node apply.js [--timestamp <epoch>] < manifest.json
//
// 入力(stdin): [{ relpath, targetBase, action, cleanedContent }]
//   targetBase: "rules"（.claude/rules 相対）| "root"（プロジェクトルート相対）。必須。
//   action: "write" | "skip"
// 出力(stdout): { written: [], backedUp: [], skipped: [] }
//
// 取り込み先の無関係なファイルは絶対に削除・改変しない。

const fs = require('fs');
const path = require('path');
const { targetRulesDir, resolveProjectRoot, safeJoin } = require('./lib');

function die(msg, code) {
  process.stderr.write(msg + '\n');
  process.exit(code == null ? 1 : code);
}

// --- 引数: タイムスタンプ（再現性のためスキル側から渡す。省略時は実行時刻） ---
let timestamp = null;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--timestamp' && argv[i + 1]) timestamp = argv[++i];
}
if (!timestamp) timestamp = String(Math.floor(Date.now() / 1000));

// --- stdin からマニフェスト読み込み ---
const raw = fs.readFileSync(0, 'utf8');
let manifest;
try {
  manifest = JSON.parse(raw);
} catch (e) {
  die('Invalid manifest JSON on stdin: ' + e.message, 1);
}
if (!Array.isArray(manifest)) die('Manifest must be a JSON array', 1);

const tgtDir = targetRulesDir();
const rootDir = resolveProjectRoot();

const written = [];
const backedUp = [];
const skipped = [];

for (const item of manifest) {
  if (!item || typeof item.relpath !== 'string') {
    die('Each manifest entry needs a string relpath', 1);
  }
  const relpath = item.relpath;
  const action = item.action || 'write';

  if (action === 'skip') {
    skipped.push(relpath);
    continue;
  }
  if (action !== 'write') {
    die('Unknown action "' + action + '" for ' + relpath, 1);
  }
  if (typeof item.cleanedContent !== 'string') {
    die('write action requires cleanedContent for ' + relpath, 1);
  }

  // 書き込み先の名前空間を targetBase で決める（必須）。
  const targetBase = item.targetBase;
  let base;
  if (targetBase === 'rules') base = tgtDir;
  else if (targetBase === 'root') base = rootDir;
  else die('Each manifest entry needs targetBase "rules" or "root": ' + relpath, 1);

  const dest = safeJoin(base, relpath);
  if (dest === null) {
    die('Refusing to write outside ' + targetBase + ' dir: ' + relpath, 2);
  }

  // 既存ファイルはバックアップ
  if (fs.existsSync(dest)) {
    const bak = dest + '.bak.' + timestamp;
    fs.copyFileSync(dest, bak);
    backedUp.push('./' + path.relative(process.cwd(), bak));
  }

  // サブディレクトリ作成 + 書き込み
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, item.cleanedContent, 'utf8');
  written.push(
    targetBase === 'rules'
      ? './' + path.join('.claude', 'rules', relpath)
      : './' + relpath
  );
}

process.stdout.write(JSON.stringify({ written, backedUp, skipped }, null, 2) + '\n');
