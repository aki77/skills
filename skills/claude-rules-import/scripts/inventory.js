#!/usr/bin/env node
'use strict';
// inventory.js — ソースの .claude/rules を構造化して JSON 配列で出力する。
//
// 使い方: node inventory.js <rulesDir>
// 出力(stdout): [{ relpath, bytes, sha256, content, name, paths, targetPath, exists }]

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { targetRulesDir, parseFrontmatter, listMarkdownFiles } = require('./lib');

function die(msg, code) {
  process.stderr.write(msg + '\n');
  process.exit(code == null ? 1 : code);
}

const rulesDir = process.argv[2];
if (!rulesDir) die('Usage: inventory.js <rulesDir>', 1);
if (!fs.existsSync(rulesDir) || !fs.statSync(rulesDir).isDirectory()) {
  die('Not a directory: ' + rulesDir, 1);
}

const tgtDir = targetRulesDir();

// frontmatter / 先頭見出し / ファイル名 の優先順でルール名を導出する。
function deriveName(relpath, fmData, body) {
  if (fmData.name) return fmData.name;
  if (fmData.title) return fmData.title;
  const heading = /^\s*#\s+(.+?)\s*$/m.exec(body);
  if (heading) return heading[1].trim();
  return path.basename(relpath, path.extname(relpath));
}

const files = listMarkdownFiles(rulesDir);
const result = files.map((relpath) => {
  const abs = path.join(rulesDir, relpath);
  const content = fs.readFileSync(abs, 'utf8');
  const bytes = Buffer.byteLength(content, 'utf8');
  const sha256 = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  const { data, body } = parseFrontmatter(content);
  const name = deriveName(relpath, data, body);
  const targetPath = path.join('.claude', 'rules', relpath);
  const exists = fs.existsSync(path.join(tgtDir, relpath));
  return {
    relpath,
    bytes,
    sha256,
    content,
    name,
    paths: data.paths || null,
    targetPath: './' + targetPath,
    exists,
  };
});

process.stdout.write(JSON.stringify(result, null, 2) + '\n');
