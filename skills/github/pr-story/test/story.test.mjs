import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPrepText, REASON_AUTO_FILLED, REASON_PREPLACED, truncateTitle, validateStory } from '../scripts/lib/story.mjs';
import { prepFrom, validStory } from './helpers.mjs';

const codes = (res) => res.errors.map((e) => e.code);

test('正しい story は通り、preplaced が support に合流する', () => {
  const res = validateStory(validStory(), prepFrom('basic.diff'));
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.deepEqual(res.coverage, { indexed: 8, placed: 8, preplaced: 1, auto_filled: 0, ratio: 1 });
  const pre = res.story.support.find((s) => s.reason === REASON_PREPLACED);
  assert.deepEqual(pre.hunk_refs, [{ file_path: 'Gemfile.lock', old_start: 1 }]);
  assert.deepEqual(Object.keys(res.story), ['prologue', 'chapters', 'support']);
});

test('未配置の hunk は support に「未分類」で補填して警告する', () => {
  const story = validStory();
  story.chapters[1].hunk_refs.pop();
  const res = validateStory(story, prepFrom('basic.diff'));
  assert.equal(res.ok, true);
  assert.equal(res.coverage.auto_filled, 1);
  const filled = res.story.support.find((s) => s.reason === REASON_AUTO_FILLED);
  assert.deepEqual(filled.hunk_refs, [{ file_path: 'lib/tricky.txt', old_start: 1 }]);
  assert.ok(res.warnings.some((w) => w.code === 'auto_filled'));
});

test('配置率 50% ちょうどは通り、下回ると失敗（preplaced を配置済みに数える）', () => {
  // 8 hunk のうち preplaced 1 + 章に 3 = 4/8
  const story = validStory();
  story.chapters = [story.chapters[0]];
  story.support = [];
  const ok = validateStory(story, prepFrom('basic.diff'));
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.coverage.placed, 4);
  assert.equal(ok.coverage.ratio, 0.5);

  story.chapters[0].hunk_refs.pop(); // 3/8
  const ng = validateStory(story, prepFrom('basic.diff'));
  assert.equal(ng.ok, false);
  const err = ng.errors.find((e) => e.code === 'below_floor');
  assert.equal(err.refs.length, 5);
  assert.equal(ng.coverage.placed, 3);
});

test('hunk が 0 件の PR はゼロ除算せずに通る', () => {
  const prep = prepFrom('basic.diff', { hunks: [], preplaced: [] });
  const story = validStory();
  story.chapters = [];
  story.support = [];
  const res = validateStory(story, prep);
  assert.equal(res.ok, true);
  assert.equal(res.coverage.ratio, 1);
});

test('重複配置（同じ章内を含む）と索引にない参照は具体的に列挙して失敗', () => {
  const story = validStory();
  story.chapters[0].hunk_refs.push({ file_path: 'app/multi.rb', old_start: 2 });
  story.support[0].hunk_refs.push({ file_path: 'lib/old.rb', old_start: 1 });
  story.chapters[1].hunk_refs.push({ file_path: 'app/typo.rb', old_start: 3 });
  const res = validateStory(story, prepFrom('basic.diff'));
  assert.equal(res.ok, false);
  const dup = res.errors.find((e) => e.code === 'duplicate_refs');
  assert.deepEqual(
    dup.refs.map((r) => [r.id, r.locations]),
    [
      ['(app/multi.rb, 2)', ['chapters[0](id=ch1).hunk_refs[0]', 'chapters[0](id=ch1).hunk_refs[3]']],
      ['(lib/old.rb, 1)', ['chapters[1](id=ch2).hunk_refs[1]', 'support[0].hunk_refs[1]']],
    ],
  );
  const unknown = res.errors.find((e) => e.code === 'unknown_refs');
  assert.deepEqual(unknown.refs, [
    { id: '(app/typo.rb, 3)', file_path: 'app/typo.rb', old_start: 3, locations: ['chapters[1](id=ch2).hunk_refs[3]'] },
  ]);
  assert.equal(res.story, null);
});

test('章 ID は形式・予約語・一意性を検証する', () => {
  const story = validStory();
  story.chapters.push({ id: 'overview', title: 'x', hunk_refs: [] });
  story.chapters.push({ id: 'support', title: 'x', hunk_refs: [] });
  story.chapters.push({ id: 'bad id', title: 'x', hunk_refs: [] });
  story.chapters.push({ id: 'ch1', title: 'x', hunk_refs: [] });
  const res = validateStory(story, prepFrom('basic.diff'));
  assert.deepEqual(codes(res), ['invalid_chapter_id', 'invalid_chapter_id', 'invalid_chapter_id', 'duplicate_chapter_id']);
});

test('必須項目と motivation の欠落をまとめて報告する', () => {
  const story = validStory();
  story.prologue.title = '  ';
  story.prologue.risks = [''];
  story.prologue.motivation = { problem: '課題', approach: '' };
  const res = validateStory(story, prepFrom('basic.diff'));
  assert.deepEqual(
    res.errors.map((e) => e.path),
    ['prologue.title', 'prologue.risks', 'prologue.motivation.approach', 'prologue.motivation.rationale'],
  );
});

test('glossary は 6 件以上なら先頭 5 件に切り詰めて警告', () => {
  const story = validStory();
  story.prologue.glossary = Array.from({ length: 7 }, (_, i) => ({ term: `t${i}`, description: 'd' }));
  const res = validateStory(story, prepFrom('basic.diff'));
  assert.equal(res.story.prologue.glossary.length, 5);
  assert.equal(res.story.prologue.glossary[4].term, 't4');
  assert.ok(res.warnings.some((w) => w.code === 'glossary_truncated'));
});

test('title はコードポイントで 48 文字に切り詰める', () => {
  const long = '😀'.repeat(50);
  const t = truncateTitle(long);
  assert.equal(Array.from(t).length, 48);
  assert.ok(t.endsWith('...'));
  assert.equal(truncateTitle('😀'.repeat(48)), '😀'.repeat(48));
  const story = validStory();
  story.chapters[0].title = 'あ'.repeat(60);
  assert.equal(Array.from(validateStory(story, prepFrom('basic.diff')).story.chapters[0].title).length, 48);
});

test('preplaced への参照は失敗にせず取り除いて警告する', () => {
  const story = validStory();
  story.chapters[0].hunk_refs.push({ file_path: 'Gemfile.lock', old_start: 1 });
  const res = validateStory(story, prepFrom('basic.diff'));
  assert.equal(res.ok, true);
  assert.equal(res.story.chapters[0].hunk_refs.length, 3);
  const w = res.warnings.find((x) => x.code === 'preplaced_ref_removed');
  assert.deepEqual(w.refs[0].locations, ['chapters[0](id=ch1).hunk_refs[3]']);
});

test('old_start は数字の文字列なら数値として扱い、それ以外は invalid_ref', () => {
  const story = validStory();
  story.chapters[0].hunk_refs[0].old_start = '2';
  story.chapters[1].hunk_refs.push({ file_path: 'lib/x', old_start: 'abc' });
  const res = validateStory(story, prepFrom('basic.diff'));
  assert.ok(res.warnings.some((w) => w.code === 'old_start_coerced'));
  assert.deepEqual(codes(res), ['invalid_ref']);
});

test('prep.txt は見出しと本文を並べ、preplaced は ID だけ載せる', () => {
  const text = buildPrepText(prepFrom('basic.diff'));
  assert.match(text, /=== PR ===\nurl: https:\/\/github\.com\/octo\/demo\/pull\/7\ntitle: サンプル PR/);
  assert.match(text, /=== COMMITS ===\ncccccc. feat: サンプル\n {4}詳細/);
  assert.match(text, /=== PREPLACED ===\n#.*story\.json に書かない.*\n--- \(Gemfile\.lock, 1\) \[preplaced\]/);
  assert.ok(!text.includes('a (1.1)'));
  assert.match(text, /--- \(app\/multi\.rb, 47\) \[modified\]\n@@ -47,7 \+47,7 @@ line 46\n line 47/);
  assert.match(text, /--- \(app\/new\.rb, 0\) \[added\]/);
  assert.match(text, /lib\/pure_new\.rb ← lib\/pure_old\.rb \[リネームのみ\]/);
});
