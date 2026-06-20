#!/usr/bin/env node
'use strict';
// inventory.js — ソースの .claude/rules を構造化して JSON 配列で出力する。
//
// 使い方: node inventory.js <rulesDir>
// 出力(stdout): [{ relpath, targetBase, bytes, sha256, content, name, paths, targetPath, exists }]

const fs = require('fs');
const path = require('path');
const { targetRulesDir, listMarkdownFiles, readEntry } = require('./lib');

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

const files = listMarkdownFiles(rulesDir);
const result = files.map((relpath) => {
  const abs = path.join(rulesDir, relpath);
  const { content, bytes, sha256, data, name } = readEntry(abs, relpath);
  const targetPath = path.join('.claude', 'rules', relpath);
  const exists = fs.existsSync(path.join(tgtDir, relpath));
  return {
    relpath,
    targetBase: 'rules',
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
