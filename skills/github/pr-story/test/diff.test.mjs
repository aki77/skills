import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildIndex,
  decodeDiff,
  fingerprint,
  hunkAnchor,
  hunkIdString,
  isLockfile,
  parseDiff,
  pathAnchor,
  unquotePath,
} from '../scripts/lib/diff.mjs';
import { fixture } from './helpers.mjs';

const basic = () => buildIndex(parseDiff(fixture('basic.diff')));

test('hunk ID は (file_path, old_start) で、種別ごとの規則に従う', () => {
  const ids = basic().hunks.map((h) => `${hunkIdString(h.file_path, h.old_start)} ${h.status}`);
  assert.deepEqual(ids, [
    '(Gemfile.lock, 1) modified',
    '(app/multi.rb, 2) modified',
    '(app/multi.rb, 47) modified',
    '(app/new.rb, 0) added',
    '(docs/日本語.md, 1) modified',
    '(lib/after.rb, 7) renamed',
    '(lib/old.rb, 1) deleted',
    '(lib/tricky.txt, 1) modified',
  ]);
});

test('純リネーム・バイナリ・モード変更のみは files_without_hunks に入る', () => {
  assert.deepEqual(basic().files_without_hunks, [
    { file_path: 'lib/image.bin', old_path: 'lib/image.bin', status: 'modified', reason: 'binary' },
    { file_path: 'lib/pure_new.rb', old_path: 'lib/pure_old.rb', status: 'renamed', reason: 'rename' },
    { file_path: 'lib/run.sh', old_path: 'lib/run.sh', status: 'modified', reason: 'mode' },
  ]);
});

test('リネームと編集は新パスで、old_start は旧ファイル側', () => {
  const files = parseDiff(fixture('basic.diff'));
  const f = files.find((x) => x.path === 'lib/after.rb');
  assert.equal(f.old_path, 'lib/before.rb');
  assert.equal(f.hunks[0].old_start, 7);
});

test('lockfile の hunk だけ preplaced になる', () => {
  assert.deepEqual(basic().preplaced, [{ file_path: 'Gemfile.lock', old_start: 1 }]);
  assert.ok(isLockfile('frontend/yarn.lock'));
  assert.ok(!isLockfile('Gemfile'));
});

test('"--- " で始まる削除行・No newline・データマーカー文字列は hunk 本文として残る', () => {
  const h = basic().hunks.find((x) => x.file_path === 'lib/tricky.txt');
  const lines = h.body.trimEnd().split('\n');
  assert.deepEqual(lines, [
    ' a',
    '--- old',
    ' --- triple',
    '+x ```` y',
    '+<!-- pr-story-data:H4sIAAAA -->',
    ' end',
    '\\ No newline at end of file',
  ]);
});

test('削除ファイルの hunk は旧パスで new_count が 0', () => {
  const h = basic().hunks.find((x) => x.file_path === 'lib/old.rb');
  assert.equal(h.status, 'deleted');
  assert.equal(h.new_count, 0);
});

test('C 形式のクォートを解除する', () => {
  assert.equal(unquotePath('"a/docs/\\346\\227\\245\\346\\234\\254\\350\\252\\236.md"'), 'a/docs/日本語.md');
  assert.equal(unquotePath('"tab\\there\\"q\\\\"'), 'tab\there"q\\');
  assert.equal(unquotePath('plain/path.rb'), 'plain/path.rb');
});

test('空白を含むパスは行末のタブを落とす', () => {
  const files = parseDiff(fixture('edge.diff'));
  assert.equal(files[0].path, 'docs/with space.txt');
});

test('不正な UTF-8 は置換文字にして例外にしない', () => {
  const buf = fixture('edge.diff');
  assert.ok(buf.includes(Buffer.from([0xe9])));
  const files = parseDiff(buf);
  const h = files.find((f) => f.path === 'lib/latin1.txt').hunks[0];
  assert.ok(h.body.includes('�'));
  assert.equal(decodeDiff(Buffer.from([0x61, 0xff])), 'a�');
});

test('fingerprint は本文の変更で変わり、並び順には依存しない', () => {
  const { hunks } = basic();
  const fp = fingerprint(hunks);
  assert.match(fp, /^[0-9a-f]{64}$/);
  assert.equal(fingerprint([...hunks].reverse()), fp);
  const changed = hunks.map((h, i) => (i === 1 ? { ...h, body: h.body.replace('line five', 'line 5!') } : h));
  assert.notEqual(fingerprint(changed), fp);
});

test('アンカーはパスの SHA-256 で、削除のみの hunk は L', () => {
  assert.equal(pathAnchor('app/new.rb'), 'diff-cf72780122f6ba148a40191799fecb97e8d2e0ae16ae31c902f22e86acc9fa05');
  assert.equal(pathAnchor('docs/日本語.md'), 'diff-a6ad112ec952f768bd232c17e84b739c5f57d57b0b2a5fe9b5aed723bd21aac4');
  const { hunks } = basic();
  const added = hunks.find((h) => h.file_path === 'app/new.rb');
  assert.equal(hunkAnchor(added), `${pathAnchor('app/new.rb')}R1`);
  const deleted = hunks.find((h) => h.file_path === 'lib/old.rb');
  assert.equal(hunkAnchor(deleted), `${pathAnchor('lib/old.rb')}L1`);
});
