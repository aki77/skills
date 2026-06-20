#!/usr/bin/env node
'use strict';
// resolve-refs.js — 選択されたルールファイル群を起点に、本文中の `@path` 参照を
// 再帰的に解決し、取り込むべき参照先ファイルの一覧を返す。
//
// 参照基準は常に repoRoot（ソースの .claude/rules の親の親）。配置先は元のパス構造を
// 維持する（取り込み先プロジェクトルート相対）。サイクル・重複・リポジトリ外・不在を扱う。
//
// 使い方:
//   node resolve-refs.js <repoRoot> <rulesDir> --relpaths a.md,sub/b.md
//
// 出力(stdout):
//   {
//     "refs":     [{ relpath, bytes, sha256, content, name, targetPath, exists, referencedBy }],
//     "missing":  [{ ref, referencedBy }],
//     "external": [{ ref, referencedBy }]
//   }

const fs = require('fs');
const path = require('path');
const { resolveProjectRoot, safeUnder, readEntry } = require('./lib');

function die(msg, code) {
  process.stderr.write(msg + '\n');
  process.exit(code == null ? 1 : code);
}

// --- 引数パース ---
const argv = process.argv.slice(2);
const repoRoot = argv[0];
const rulesDir = argv[1];
if (!repoRoot || !rulesDir) {
  die('Usage: resolve-refs.js <repoRoot> <rulesDir> --relpaths a.md,sub/b.md', 1);
}
if (!fs.existsSync(repoRoot) || !fs.statSync(repoRoot).isDirectory()) {
  die('Not a directory (repoRoot): ' + repoRoot, 1);
}
if (!fs.existsSync(rulesDir) || !fs.statSync(rulesDir).isDirectory()) {
  die('Not a directory (rulesDir): ' + rulesDir, 1);
}

let relpaths = [];
for (let i = 2; i < argv.length; i++) {
  if (argv[i] === '--relpaths' && argv[i + 1]) {
    relpaths = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
  }
}
if (!relpaths.length) die('No --relpaths given', 1);

const repoRootAbs = path.resolve(repoRoot);
const projectRoot = resolveProjectRoot();

// .claude/rules の repoRoot 相対プレフィックス（参照先が rules 配下を指す判定用）
const rulesPrefix = path.relative(repoRootAbs, path.resolve(rulesDir));

// 参照記法の抽出: 行頭または空白の直後の @ で始まり、.md / .markdown（任意の #anchor）で終わる相対パス。
// `@` の前が非空白だとマッチしない → メール（foo@bar.com）を除外。
const REF_RE = /(?:^|\s)@([^\s@]+\.(?:md|markdown))(#[^\s]*)?/g;

// 1ファイルの本文から参照パス（#anchor 除去済み）を抽出する。
// fenced code block（``` または ~~~）内の行はスキップする。
function extractRefs(content) {
  const out = [];
  const lines = content.split(/\r?\n/);
  let inFence = false;
  let fenceMarker = null;
  for (const line of lines) {
    const fence = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      const marker = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = null;
      }
      continue;
    }
    if (inFence) continue;

    REF_RE.lastIndex = 0;
    let m;
    while ((m = REF_RE.exec(line)) !== null) {
      out.push(m[1]); // #anchor (m[2]) は捨てる
      if (m.index === REF_RE.lastIndex) REF_RE.lastIndex++;
    }
  }
  return out;
}

const refs = [];
const missing = [];
const external = [];

// visited: repoRoot 相対 relpath → refs エントリ（referencedBy 集約用）。
const visited = new Map();
// missing / external も重複参照で多重計上しないようキーで dedupe。
const seenMissing = new Map();
const seenExternal = new Map();

// 起点ルール（rulesDir 相対）の repoRoot 相対 relpath 集合。これらは refs に含めない。
const originRelpaths = new Set(
  relpaths.map((rp) => path.relative(repoRootAbs, path.resolve(rulesDir, rp)))
);

// BFS キュー: { abs, relRepo, byRel, isOrigin } — byRel は参照元の repoRoot 相対 relpath。
const queue = [];

// 起点ルールをキューに積む（自身は refs に出さないが、本文から参照を辿る）。
for (const rp of relpaths) {
  const abs = path.resolve(rulesDir, rp);
  const relRepo = path.relative(repoRootAbs, abs);
  queue.push({ abs, relRepo, byRel: relRepo, isOrigin: true });
}

// referencedBy への重複なし追加。
function addReferencedBy(entry, by) {
  if (by && !entry.referencedBy.includes(by)) entry.referencedBy.push(by);
}

// missing / external のレコードを seen Map で dedupe しつつ list に積む。
function addRecord(seen, list, key, ref, by) {
  let rec = seen.get(key);
  if (!rec) {
    rec = { ref, referencedBy: [] };
    seen.set(key, rec);
    list.push(rec);
  }
  addReferencedBy(rec, by);
}

while (queue.length) {
  const { abs, relRepo, byRel, isOrigin } = queue.shift();

  let entry;
  try {
    entry = readEntry(abs, relRepo);
  } catch (_) {
    // 起点ルールは inventory 検証済みで通常読める。参照先が読めなければ missing 扱い。
    if (!isOrigin) addRecord(seenMissing, missing, relRepo, relRepo, byRel);
    continue;
  }
  const content = entry.content;

  // 起点でなければ refs に登録（重複は referencedBy 集約のみ）。
  if (!isOrigin) {
    // 同一ノードが処理前に複数経路からキューイングされた場合のサイクル/重複停止。
    const seen = visited.get(relRepo);
    if (seen) {
      addReferencedBy(seen, byRel);
      continue;
    }
    // 参照先が .claude/rules 配下を指す場合は targetBase を rules に正規化。
    const underRules =
      rulesPrefix &&
      (relRepo === rulesPrefix || relRepo.startsWith(rulesPrefix + path.sep));
    let targetBase, targetRel, targetPath, existsAbs;
    if (underRules) {
      targetBase = 'rules';
      targetRel = path.relative(rulesPrefix, relRepo);
      targetPath = './' + path.join('.claude', 'rules', targetRel);
      existsAbs = path.join(projectRoot, '.claude', 'rules', targetRel);
    } else {
      targetBase = 'root';
      targetRel = relRepo;
      targetPath = './' + targetRel;
      existsAbs = path.join(projectRoot, targetRel);
    }

    const refEntry = {
      relpath: targetRel,
      targetBase,
      bytes: entry.bytes,
      sha256: entry.sha256,
      content,
      name: entry.name,
      targetPath,
      exists: fs.existsSync(existsAbs),
      referencedBy: byRel ? [byRel] : [],
    };
    visited.set(relRepo, refEntry);
    refs.push(refEntry);
  }

  // 本文中の参照を解決してキューに積む。
  for (const refPath of extractRefs(content)) {
    const childAbs = path.resolve(repoRootAbs, refPath);
    const childRel = path.relative(repoRootAbs, childAbs);

    // リポジトリ外（@../.. など）
    if (!safeUnder(repoRootAbs, childAbs)) {
      addRecord(seenExternal, external, refPath, refPath, relRepo);
      continue;
    }

    // 起点ルール自身を指す参照は無視（inventory 側で扱う）。
    if (originRelpaths.has(childRel)) continue;

    // 既に refs 済みなら referencedBy だけ足してサイクル停止。
    const seenEntry = visited.get(childRel);
    if (seenEntry) {
      addReferencedBy(seenEntry, relRepo);
      continue;
    }

    queue.push({ abs: childAbs, relRepo: childRel, byRel: relRepo, isOrigin: false });
  }
}

process.stdout.write(JSON.stringify({ refs, missing, external }, null, 2) + '\n');
