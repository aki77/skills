import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { CommandError, createGitHub, findStoryComment, parsePrSpec } from '../scripts/lib/github.mjs';
import { dataLine, markerLine } from '../scripts/lib/render.mjs';
import { run } from '../scripts/pr-story.mjs';
import { fixture, validStory } from './helpers.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/pr-story.mjs', import.meta.url));
const HEAD = 'a'.repeat(40);
const PR_JSON = {
  number: 7,
  url: 'https://github.com/octo/demo/pull/7',
  title: 'サンプル PR',
  body: '本文',
  headRefOid: HEAD,
  baseRefOid: 'b'.repeat(40),
  baseRefName: 'main',
  headRefName: 'feature',
  commits: [{ oid: 'c'.repeat(40), messageHeadline: 'feat: x', messageBody: '' }],
};

// gh / git の偽物。呼び出しを記録し、応答は opts で差し替える
function fakeExec(opts = {}) {
  const calls = [];
  const exec = (cmd, args, { input } = {}) => {
    calls.push({ cmd, args, input });
    const j = (v) => Buffer.from(JSON.stringify(v));
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') {
      if (args.includes('headRefOid') && args.at(-1) === 'headRefOid') return j({ headRefOid: opts.currentHead ?? HEAD });
      if (opts.noPr) throw new CommandError('gh pr view が失敗した: no pull requests found', { stderr: 'no pull requests found' });
      return j(PR_JSON);
    }
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'diff') {
      if (opts.ghDiffFails) throw new CommandError('gh pr diff が失敗した: HTTP 406');
      return fixture('basic.diff');
    }
    if (cmd === 'git') {
      if (opts.gitFails) throw new CommandError('git が失敗した');
      if (args[0] === 'merge-base') return Buffer.from('d'.repeat(40) + '\n');
      if (args.includes('diff')) return fixture('basic.diff');
      return Buffer.alloc(0);
    }
    if (cmd === 'gh' && args[0] === 'api' && args.some((a) => a.includes('/git/trees/'))) {
      if (opts.treeFails) throw new CommandError('gh api が失敗した: HTTP 404');
      return j({ truncated: false, tree: [{ path: 'app', type: 'tree' }, { path: 'app/components/x.rb', type: 'blob' }] });
    }
    if (cmd === 'gh' && args[0] === 'api') {
      const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : 'GET';
      if (method === 'GET') return j([opts.comments ?? []]);
      if (method === 'PATCH') {
        if (opts.patchFails) throw new CommandError('gh api が失敗した: HTTP 403');
        return j({ id: 11, html_url: 'https://github.com/octo/demo/pull/7#issuecomment-11' });
      }
      if (method === 'POST') return j({ id: 12, html_url: 'https://github.com/octo/demo/pull/7#issuecomment-12' });
    }
    throw new Error(`想定外の呼び出し: ${cmd} ${args.join(' ')}`);
  };
  return { exec, calls };
}

async function runCli(argv, opts = {}, tmp = mkdtempSync(join(tmpdir(), 'pr-story-test-'))) {
  const fake = fakeExec(opts);
  let out = '';
  let err = '';
  const code = await run(argv, { gh: createGitHub(fake.exec), tmpdir: tmp, stdout: (s) => (out += s), stderr: (s) => (err += s) });
  return { code, json: out ? JSON.parse(out) : null, err, calls: fake.calls, tmp };
}

async function prepared(opts = {}) {
  const r = await runCli(['prep', '7'], opts);
  assert.equal(r.code, 0, r.err);
  return r;
}

test('PR 引数は番号・URL・省略に対応し、それ以外は使い方の誤り', async () => {
  assert.deepEqual(parsePrSpec(undefined), { arg: null });
  assert.deepEqual(parsePrSpec('12'), { arg: '12' });
  assert.deepEqual(parsePrSpec('https://github.com/o/r/pull/12/files'), { arg: 'https://github.com/o/r/pull/12' });
  const r = await runCli(['check', 'feature-branch']);
  assert.equal(r.code, 2);
  assert.match(r.err, /PR 番号または PR URL/);
  const none = await runCli(['check']);
  assert.deepEqual(none.calls[0].args, ['pr', 'view', '--json', 'number,url,title,body,headRefOid,baseRefOid,baseRefName,headRefName,commits']);
  assert.equal(none.code, 0);
});

test('現在のブランチに PR がなければ exit 3', async () => {
  const r = await runCli(['check'], { noPr: true });
  assert.equal(r.code, 3);
  assert.match(r.err, /現在のブランチに紐づく PR が見つからない/);
});

test('サブコマンドや引数の誤りは exit 2', async () => {
  assert.equal((await runCli([])).code, 2);
  assert.equal((await runCli(['unknown'])).code, 2);
  assert.equal((await runCli(['validate'])).code, 2);
  assert.equal((await runCli(['validate', '--dir', '/nonexistent-dir'])).code, 2);
  assert.equal((await runCli(['prep', '1', '2'])).code, 2);
  assert.equal((await runCli(['render', '--bogus'])).code, 2);
});

test('check は absent / fresh / regenerate を返す', async () => {
  const absent = await runCli(['check', '7']);
  assert.equal(absent.json.status, 'absent');
  assert.equal(absent.json.comment_url, null);
  assert.equal(absent.json.head, HEAD);
  const fp = absent.json.fingerprint;

  const comment = (f, id, created) => ({ id, created_at: created, html_url: `u${id}`, body: `${markerLine(HEAD, f)}\n本文` });
  const fresh = await runCli(['check', '7'], { comments: [comment('0'.repeat(64), 1, '2026-01-01T00:00:00Z'), comment(fp, 2, '2026-01-02T00:00:00Z')] });
  assert.deepEqual(fresh.json, { status: 'fresh', comment_url: 'u2', head: HEAD, fingerprint: fp });

  const regen = await runCli(['check', '7'], { comments: [comment('0'.repeat(64), 3, '2026-01-03T00:00:00Z'), { id: 9, body: '関係ないコメント' }] });
  assert.equal(regen.json.status, 'regenerate');
  assert.equal(regen.json.comment_url, 'u3');
  assert.ok(regen.calls.some((c) => c.args.join(' ') === 'api --paginate --slurp repos/octo/demo/issues/7/comments'));
});

test('gh pr diff が失敗したら git diff に切り替え、両方だめなら exit 3', async () => {
  const r = await runCli(['check', '7'], { ghDiffFails: true });
  assert.equal(r.code, 0);
  const diffCall = r.calls.find((c) => c.cmd === 'git' && c.args.includes('diff'));
  assert.deepEqual(diffCall.args.slice(-2), ['d'.repeat(40), HEAD]);
  const fail = await runCli(['check', '7'], { ghDiffFails: true, gitFails: true });
  assert.equal(fail.code, 3);
  assert.equal(fail.json, null);
});

test('prep は作業ディレクトリに prep.json / prep.txt / previous-story.json を書く', async () => {
  const previous = validStory();
  const r = await prepared({ comments: [{ id: 5, created_at: 'x', html_url: 'u5', body: `${markerLine(HEAD, 'f')}\n本文\n${dataLine(previous)}\n` }] });
  const dir = join(r.tmp, 'pr-story', 'octo-demo-7');
  assert.equal(r.json.dir, dir);
  assert.equal(r.json.prep_txt, join(dir, 'prep.txt'));
  assert.equal(r.json.story_json, join(dir, 'story.json'));
  assert.equal(r.json.previous_story, join(dir, 'previous-story.json'));
  assert.deepEqual(r.json.counts, { hunks: 8, preplaced: 1, files_without_hunks: 3 });
  assert.deepEqual(JSON.parse(readFileSync(r.json.previous_story, 'utf8')), previous);
  const prep = JSON.parse(readFileSync(join(dir, 'prep.json'), 'utf8'));
  assert.equal(prep.head, HEAD);
  assert.equal(prep.diff_source, 'gh');
  assert.match(readFileSync(r.json.prep_txt, 'utf8'), /=== HUNKS ===/);
  assert.ok(r.calls.some((c) => c.args.join(' ') === `api repos/octo/demo/git/trees/${HEAD}?recursive=1`));
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'tree.json'), 'utf8')), { truncated: false, paths: ['app/components/x.rb'] });
});

test('trees API が失敗しても prep は成功し、tree.json は空になる', async () => {
  const r = await prepared({ treeFails: true });
  assert.deepEqual(JSON.parse(readFileSync(join(r.json.dir, 'tree.json'), 'utf8')), { truncated: true, paths: [] });
  const story = validStory();
  story.prologue.impact = ['app/components/x.rb'];
  writeFileSync(join(r.json.dir, 'story.json'), JSON.stringify(story));
  const v = await runCli(['validate', '--dir', r.json.dir], {}, r.tmp);
  assert.equal(v.code, 0, v.err);
  assert.equal(v.json.warnings.find((w) => w.code === 'unlinked_paths').tree_truncated, true);
});

test('validate と render は tree.json を使ってパスを判定する', async () => {
  const { json, tmp } = await prepared();
  const story = validStory();
  story.prologue.impact = ['app/components/x.rb と app/missing.rb'];
  writeFileSync(join(json.dir, 'story.json'), JSON.stringify(story));
  const v = await runCli(['validate', '--dir', json.dir], {}, tmp);
  assert.equal(v.code, 0, v.err);
  assert.deepEqual(v.json.warnings.find((w) => w.code === 'unlinked_paths').paths, [{ path: 'app/missing.rb', locations: ['prologue.impact[0]'] }]);
  assert.equal((await runCli(['render', '--dir', json.dir], {}, tmp)).code, 0);
  const md = readFileSync(join(json.dir, 'comment.md'), 'utf8');
  assert.ok(md.includes(`[app/components/x.rb](https://github.com/octo/demo/blob/${HEAD}/app/components/x.rb) と app/missing.rb`));
});

test('prep は前回の作業ファイルを消す', async () => {
  const first = await prepared();
  writeFileSync(join(first.json.dir, 'story.json'), '{}');
  writeFileSync(join(first.json.dir, 'comment.md'), 'old');
  const again = await runCli(['prep', '7'], {}, first.tmp);
  assert.equal(again.json.previous_story, null);
  assert.ok(!existsSync(join(first.json.dir, 'story.json')));
  assert.ok(!existsSync(join(first.json.dir, 'comment.md')));
});

test('validate は失敗時も問題の参照を JSON で出して exit 1、成功時に story.validated.json を書く', async () => {
  const { json, tmp } = await prepared();
  const dir = json.dir;
  const story = validStory();
  story.chapters[0].hunk_refs.push({ file_path: 'app/typo.rb', old_start: 1 });
  writeFileSync(join(dir, 'story.json'), JSON.stringify(story));
  writeFileSync(join(dir, 'story.validated.json'), '{"stale":true}');
  const bad = await runCli(['validate', '--dir', dir], {}, tmp);
  assert.equal(bad.code, 1);
  assert.equal(bad.json.ok, false);
  assert.equal(bad.json.output, null);
  assert.equal(bad.json.errors[0].code, 'unknown_refs');
  assert.equal(bad.json.errors[0].refs[0].id, '(app/typo.rb, 1)');
  assert.ok(!existsSync(join(dir, 'story.validated.json')), '古い検証結果を残さない');

  writeFileSync(join(dir, 'story.json'), '{ broken');
  const broken = await runCli(['validate', '--dir', dir], {}, tmp);
  assert.equal(broken.code, 1);
  assert.equal(broken.json.errors[0].code, 'invalid_json');

  writeFileSync(join(dir, 'story.json'), JSON.stringify(validStory()));
  const ok = await runCli(['validate', '--dir', dir], {}, tmp);
  assert.equal(ok.code, 0);
  assert.equal(ok.json.ok, true);
  assert.equal(ok.json.output, join(dir, 'story.validated.json'));
  assert.deepEqual(ok.json.coverage, { indexed: 8, placed: 8, preplaced: 1, auto_filled: 0, ratio: 1 });

  const rendered = await runCli(['render', '--dir', dir], {}, tmp);
  assert.equal(rendered.code, 0, rendered.err);
  assert.equal(rendered.json.comment_md, join(dir, 'comment.md'));
  assert.equal(rendered.json.data, 'full');
  assert.ok(readFileSync(join(dir, 'comment.md'), 'utf8').startsWith('<!-- pr-story:v1 head='));
});

async function readyToPost(opts = {}) {
  const { json, tmp } = await prepared(opts);
  writeFileSync(join(json.dir, 'story.json'), JSON.stringify(validStory()));
  assert.equal((await runCli(['validate', '--dir', json.dir], opts, tmp)).code, 0);
  assert.equal((await runCli(['render', '--dir', json.dir], opts, tmp)).code, 0);
  return { dir: json.dir, tmp };
}

const existing = [{ id: 11, created_at: '2026-01-01T00:00:00Z', html_url: 'u11', body: `${markerLine(HEAD, '0')}\n古い` }];

test('post は既存コメントがあれば PATCH する', async () => {
  const { dir, tmp } = await readyToPost();
  const r = await runCli(['post', '--dir', dir], { comments: existing }, tmp);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json, { ok: true, action: 'updated', comment_url: 'https://github.com/octo/demo/pull/7#issuecomment-11', comment_id: 11 });
  const patch = r.calls.find((c) => c.args.includes('PATCH'));
  assert.deepEqual(patch.args, ['api', '--method', 'PATCH', 'repos/octo/demo/issues/comments/11', '--input', '-']);
  assert.equal(JSON.parse(patch.input).body, readFileSync(join(dir, 'comment.md'), 'utf8'));
  assert.ok(!r.calls.some((c) => c.args.includes('POST')));
});

test('post は既存コメントがなければ POST する', async () => {
  const { dir, tmp } = await readyToPost();
  const r = await runCli(['post', '--dir', dir], {}, tmp);
  assert.equal(r.code, 0);
  assert.equal(r.json.action, 'created');
  assert.equal(r.json.comment_id, 12);
  assert.ok(r.calls.some((c) => c.args.join(' ') === 'api --method POST repos/octo/demo/issues/7/comments --input -'));
});

test('post は head が動いていたら exit 1 で何も書き込まない', async () => {
  const { dir, tmp } = await readyToPost();
  const r = await runCli(['post', '--dir', dir], { currentHead: 'e'.repeat(40) }, tmp);
  assert.equal(r.code, 1);
  assert.deepEqual(r.json, { ok: false, error: 'head_moved', prep_head: HEAD, current_head: 'e'.repeat(40) });
  assert.ok(!r.calls.some((c) => c.args.includes('--method')));
});

test('post は PATCH が失敗しても POST に切り替えず exit 3', async () => {
  const { dir, tmp } = await readyToPost();
  const r = await runCli(['post', '--dir', dir], { comments: existing, patchFails: true }, tmp);
  assert.equal(r.code, 3);
  assert.match(r.err, /HTTP 403/);
  assert.ok(!r.calls.some((c) => c.args.includes('POST')));
});

test('findStoryComment はマーカーで始まる最新のコメントを選ぶ', () => {
  const m = markerLine(HEAD, '0');
  const c = findStoryComment([
    { id: 1, created_at: '2026-01-02T00:00:00Z', body: `${m}\n` },
    { id: 2, created_at: '2026-01-01T00:00:00Z', body: `${m}\n` },
    { id: 3, created_at: '2026-01-03T00:00:00Z', body: `引用\n${m}` },
  ]);
  assert.equal(c.id, 1);
});

test('エントリを直接実行すると引数なしで exit 2', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /使い方/);
  assert.equal(r.stdout, '');
  // import しただけでは main が走らないこと
  execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(SCRIPT)})`]);
});
