import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathAnchor } from '../scripts/lib/diff.mjs';
import {
  dataLine,
  extractStoryData,
  fenceFor,
  measure,
  parseMarker,
  renderComment,
  RenderSizeError,
  sanitizeProse,
} from '../scripts/lib/render.mjs';
import { validateStory } from '../scripts/lib/story.mjs';
import { prepFrom, validStory } from './helpers.mjs';

function setup(mutate = () => {}, prepExtra = {}) {
  const prep = prepFrom('basic.diff', prepExtra);
  const story = validStory();
  mutate(story);
  const res = validateStory(story, prep);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  return { prep, story: res.story };
}

test('マーカー行で始まり、隠しデータ行で終わる', () => {
  const { prep, story } = setup();
  const { markdown, stats } = renderComment(prep, story);
  assert.ok(markdown.startsWith(`<!-- pr-story:v1 head=${prep.head} fingerprint=${prep.fingerprint} -->\n`));
  assert.deepEqual(parseMarker(markdown), { head: prep.head, fingerprint: prep.fingerprint });
  assert.deepEqual(extractStoryData(markdown), story);
  assert.equal(stats.data, 'full');
  assert.deepEqual(stats.reductions, []);
});

test('コメントの構成順と最初の章だけ開く', () => {
  const { prep, story } = setup((s) => {
    s.prologue.diagram = 'graph TD\n  A --> B';
  });
  const md = renderComment(prep, story).markdown;
  const order = [
    '## サンプルの変更',
    'このコメントは変更内容の説明であり、修正依頼ではありません',
    '複数のファイルを変更する。',
    '### なぜ',
    '### 主な変更',
    '### 注意して見る点',
    '### 章の目次',
    '<summary>影響範囲</summary>',
    '<summary>用語集</summary>',
    '```mermaid\ngraph TD\n  A --> B\n```',
    '<details open>\n<summary>第1章 本体の変更（3 hunk）</summary>',
    '<details>\n<summary>第2章 ライブラリ（3 hunk）</summary>',
    '<summary>補助的な変更（2 hunk、ファイル 3 件）</summary>',
    '<!-- pr-story-data:',
  ];
  let pos = -1;
  for (const s of order) {
    const i = md.lastIndexOf(s);
    assert.ok(i > pos, `順序が違う: ${s}`);
    pos = i;
  }
  assert.ok(md.includes(`(https://github.com/octo/demo/pull/7/files#${pathAnchor('lib/pure_new.rb')}) リネームのみ`));
});

test('<summary> の後と </details> の前に空行がある', () => {
  const { prep, story } = setup();
  const md = renderComment(prep, story).markdown;
  assert.ok(md.includes('</summary>\n\n'));
  assert.ok(!/<\/summary>\n[^\n]/.test(md));
  assert.ok(!/[^\n]\n<\/details>/.test(md));
});

test('diff ブロックのフェンスは本文の最長バッククォートより長い', () => {
  assert.equal(fenceFor('no ticks'), '```');
  assert.equal(fenceFor('a ```` b'), '`````');
  const { prep, story } = setup();
  const md = renderComment(prep, story).markdown;
  assert.ok(md.includes('`````diff\n@@ -1,4 +1,5 @@\n a\n--- old'));
});

test('hunk リンクは R<new_start>、削除のみは L<old_start>', () => {
  const { prep, story } = setup();
  const md = renderComment(prep, story).markdown;
  assert.ok(md.includes(`/pull/7/files#${pathAnchor('app/multi.rb')}R47)`));
  assert.ok(md.includes(`/pull/7/files#${pathAnchor('lib/old.rb')}L1)`));
});

test('散文の @ と HTML コメントを無害化し、コードフェンス内は触らない', () => {
  const s = sanitizeProse('cc @alice と a@b.com <!-- x -->\n```\n@keep <!--\n```\n@bob');
  assert.equal(s, 'cc @​alice と a@b.com &lt;!-- x --&gt;\n```\n@keep <!--\n```\n@​bob');
  const { prep, story } = setup((st) => {
    st.prologue.overview = '@octocat に依頼 <!-- 隠す';
    st.chapters[0].title = '<b>@team</b>';
  });
  const md = renderComment(prep, story).markdown;
  assert.ok(md.includes('@​octocat に依頼 &lt;!-- 隠す'));
  assert.ok(md.includes('<summary>第1章 &lt;b&gt;@​team&lt;/b&gt;（3 hunk）</summary>'));
});

test('60 行を超える hunk は先頭 60 行だけ埋め込む', () => {
  const body = Array.from({ length: 70 }, (_, i) => `+l${i}`).join('\n') + '\n';
  const prep = prepFrom('basic.diff');
  const h = prep.hunks.find((x) => x.file_path === 'app/new.rb');
  h.body = body;
  const res = validateStory(validStory(), prep);
  const md = renderComment(prep, res.story).markdown;
  assert.ok(md.includes('+l59\n```'));
  assert.ok(!md.includes('+l60'));
  assert.ok(md.includes('（残り 10 行はリンク先で確認）'));
});

test('隠しデータは末尾行からだけ抽出する', () => {
  const story = { chapters: [{ id: 'a', title: 't', hunk_refs: [] }] };
  const body = `x\n${dataLine(story)}\n\n`;
  assert.deepEqual(extractStoryData(body), story);
  assert.deepEqual(extractStoryData(body.replace(/\n/g, '\r\n')), story);
  assert.equal(extractStoryData(`${dataLine(story)}\n本文が後に続く`), null);
  assert.equal(extractStoryData('<!-- pr-story-data:!!!! -->'), null);
});

test('隠しデータを外したとき、diff 本文中のデータ文字列を拾わない', () => {
  const { prep, story } = setup();
  const full = renderComment(prep, story).markdown;
  assert.ok(full.includes('+<!-- pr-story-data:H4sIAAAA -->'));
  const dataLen = measure(dataLine(story)) + 2;
  const { markdown, stats } = renderComment(prep, story, { total: measure(full) - dataLen + 1, data: 1e9 });
  assert.equal(stats.data, 'omitted');
  assert.equal(extractStoryData(markdown), null);
});

test('サイズ超過時は段階的に縮小する', () => {
  const { prep, story } = setup();
  const base = renderComment(prep, story);

  // 1. 隠しデータが上限を超えたら章の id・title・hunk_refs だけにする
  const small = renderComment(prep, story, { data: 10 });
  assert.equal(small.stats.data, 'minimal');
  assert.deepEqual(Object.keys(extractStoryData(small.markdown)), ['chapters']);
  assert.deepEqual(Object.keys(extractStoryData(small.markdown).chapters[0]), ['id', 'title', 'hunk_refs']);

  // 2. 大きい hunk から順にリンクのみへ落とす
  const linked = renderComment(prep, story, { total: base.stats.chars - 50 });
  assert.deepEqual(linked.stats.reductions, ['link_only']);
  assert.equal(linked.stats.link_only_hunks, 1);
  assert.ok(linked.stats.chars <= base.stats.chars - 50);
  assert.ok(linked.markdown.includes('（diff の埋め込みは省略。リンク先で確認）'));
  assert.ok(!linked.markdown.includes('+x ```` y'), '最大の hunk（tricky.txt）が先に落ちる');

  // 3. それでも超えたら隠しデータを外す。まだ超えるならエラー
  assert.throws(
    () => renderComment(prep, story, { total: 100 }),
    (e) => e instanceof RenderSizeError && e.stats.data === 'omitted' && e.stats.link_only_hunks === 6,
  );
});

test('stats に文字数とバイト数を返す', () => {
  const { prep, story } = setup();
  const { markdown, stats } = renderComment(prep, story);
  assert.equal(stats.chars, markdown.length);
  assert.equal(stats.bytes, Buffer.byteLength(markdown));
  assert.equal(stats.limit, 60000);
});
