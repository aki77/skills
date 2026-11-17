// エントリポイント。Node のバージョン確認より前に lib を読まないよう、lib は動的 import する
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as util from 'node:util';

const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  process.stderr.write(`pr-story: Node.js 18 以上が必要（現在 ${process.versions.node}）\n`);
  process.exit(2);
}
const { parseArgs } = util;
if (typeof parseArgs !== 'function') {
  process.stderr.write(`pr-story: Node.js 18.3 以上が必要（現在 ${process.versions.node}）\n`);
  process.exit(2);
}
const diffLib = await import('./lib/diff.mjs');
const storyLib = await import('./lib/story.mjs');
const renderLib = await import('./lib/render.mjs');
const githubLib = await import('./lib/github.mjs');

const { UsageError, CommandError } = githubLib;

class ContentError extends Error {
  constructor(message, payload) {
    super(message);
    this.payload = payload;
  }
}

const USAGE = `使い方:
  node pr-story.mjs check [PR番号|PR URL]
  node pr-story.mjs prep [PR番号|PR URL]
  node pr-story.mjs validate --dir <作業ディレクトリ>
  node pr-story.mjs render --dir <作業ディレクトリ>
  node pr-story.mjs post --dir <作業ディレクトリ>`;

const WORK_FILES = ['prep.json', 'prep.txt', 'previous-story.json', 'story.json', 'story.validated.json', 'comment.md'];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function toJson(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

function requireDir(values) {
  if (!values.dir) throw new UsageError('--dir <作業ディレクトリ> を指定すること');
  const dir = path.resolve(values.dir);
  if (!fs.existsSync(path.join(dir, 'prep.json'))) throw new UsageError(`${dir} に prep.json がない。先に prep を実行すること`);
  return dir;
}

function removeIfExists(file) {
  fs.rmSync(file, { force: true });
}

// PR の情報と diff から prep.json の中身を作る
export function buildPrep(pr, diffBuf, source) {
  const d = pr.data;
  const index = diffLib.buildIndex(diffLib.parseDiff(diffBuf));
  return {
    version: 1,
    host: pr.host,
    owner: pr.owner,
    repo: pr.repo,
    number: pr.number,
    url: pr.url,
    title: d.title ?? '',
    body: d.body ?? '',
    base_ref: d.baseRefName ?? '',
    head_ref: d.headRefName ?? '',
    base: d.baseRefOid,
    head: d.headRefOid,
    diff_source: source,
    fingerprint: diffLib.fingerprint(index.hunks),
    commits: (d.commits ?? []).map((c) => ({ oid: c.oid, headline: c.messageHeadline ?? '', body: c.messageBody ?? '' })),
    hunks: index.hunks,
    preplaced: index.preplaced,
    files_without_hunks: index.files_without_hunks,
  };
}

function loadPr(gh, spec) {
  const pr = gh.viewPr(spec);
  const { diff, source } = gh.fetchDiff(pr, { base: pr.data.baseRefOid, head: pr.data.headRefOid });
  return { pr, prep: buildPrep(pr, diff, source) };
}

function cmdCheck(ctx, positionals) {
  const { pr, prep } = loadPr(ctx.gh, positionals[0]);
  const comment = githubLib.findStoryComment(ctx.gh.listComments(pr));
  let status = 'absent';
  if (comment) {
    const marker = renderLib.parseMarker(comment.body);
    status = marker && marker.fingerprint === prep.fingerprint ? 'fresh' : 'regenerate';
  }
  return { status, comment_url: comment?.html_url ?? null, head: prep.head, fingerprint: prep.fingerprint };
}

function cmdPrep(ctx, positionals) {
  const { pr, prep } = loadPr(ctx.gh, positionals[0]);
  const dir = path.join(ctx.tmpdir, 'pr-story', `${pr.owner}-${pr.repo}-${pr.number}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of WORK_FILES) removeIfExists(path.join(dir, f));

  const comment = githubLib.findStoryComment(ctx.gh.listComments(pr));
  const previous = comment ? renderLib.extractStoryData(comment.body) : null;

  fs.writeFileSync(path.join(dir, 'prep.json'), toJson(prep));
  fs.writeFileSync(path.join(dir, 'prep.txt'), storyLib.buildPrepText(prep));
  let previousPath = null;
  if (previous) {
    previousPath = path.join(dir, 'previous-story.json');
    fs.writeFileSync(previousPath, toJson(previous));
  }
  return {
    dir,
    prep_txt: path.join(dir, 'prep.txt'),
    previous_story: previousPath,
    story_json: path.join(dir, 'story.json'),
    pr_url: prep.url,
    head: prep.head,
    fingerprint: prep.fingerprint,
    diff_source: prep.diff_source,
    existing_comment_url: comment?.html_url ?? null,
    counts: { hunks: prep.hunks.length, preplaced: prep.preplaced.length, files_without_hunks: prep.files_without_hunks.length },
  };
}

function cmdValidate(ctx, values) {
  const dir = requireDir(values);
  const out = path.join(dir, 'story.validated.json');
  removeIfExists(out);
  removeIfExists(path.join(dir, 'comment.md'));
  const prep = readJson(path.join(dir, 'prep.json'));
  const storyPath = path.join(dir, 'story.json');
  const fail = (code, message) => {
    throw new ContentError(message, { ok: false, errors: [{ code, message }], warnings: [], coverage: null, output: null });
  };
  if (!fs.existsSync(storyPath)) fail('missing_story', `${storyPath} がない`);
  let story;
  try {
    story = readJson(storyPath);
  } catch (e) {
    fail('invalid_json', `story.json を JSON として読めない: ${e.message}`);
  }
  const res = storyLib.validateStory(story, prep);
  const payload = { ok: res.ok, errors: res.errors, warnings: res.warnings, coverage: res.coverage, output: res.ok ? out : null };
  if (!res.ok) throw new ContentError(`story.json の検証に失敗した（${res.errors.length} 件）`, payload);
  fs.writeFileSync(out, toJson(res.story));
  return payload;
}

function cmdRender(ctx, values) {
  const dir = requireDir(values);
  const out = path.join(dir, 'comment.md');
  removeIfExists(out);
  const validated = path.join(dir, 'story.validated.json');
  if (!fs.existsSync(validated)) throw new UsageError(`${validated} がない。先に validate を成功させること`);
  const prep = readJson(path.join(dir, 'prep.json'));
  try {
    const { markdown, stats } = renderLib.renderComment(prep, readJson(validated));
    fs.writeFileSync(out, markdown);
    return { ok: true, comment_md: out, ...stats };
  } catch (e) {
    if (e instanceof renderLib.RenderSizeError) throw new ContentError(e.message, { ok: false, error: 'too_large', comment_md: null, ...e.stats });
    throw e;
  }
}

function cmdPost(ctx, values) {
  const dir = requireDir(values);
  const commentPath = path.join(dir, 'comment.md');
  if (!fs.existsSync(commentPath)) throw new UsageError(`${commentPath} がない。先に render を実行すること`);
  const prep = readJson(path.join(dir, 'prep.json'));
  const body = fs.readFileSync(commentPath, 'utf8');
  if (!body.startsWith(renderLib.MARKER_PREFIX)) {
    throw new ContentError('comment.md の先頭にマーカーがない。render で作り直すこと', { ok: false, error: 'invalid_comment' });
  }
  const pr = { host: prep.host, owner: prep.owner, repo: prep.repo, number: prep.number, url: prep.url };
  const head = ctx.gh.currentHead(pr);
  if (head !== prep.head) {
    throw new ContentError(`prep の後に head が動いた（${prep.head.slice(0, 7)} → ${head.slice(0, 7)}）。prep からやり直すこと`, {
      ok: false,
      error: 'head_moved',
      prep_head: prep.head,
      current_head: head,
    });
  }
  const existing = githubLib.findStoryComment(ctx.gh.listComments(pr));
  // PATCH が失敗しても POST には切り替えない（重複投稿を避ける）
  const res = existing ? ctx.gh.updateComment(pr, existing.id, body) : ctx.gh.createComment(pr, body);
  return { ok: true, action: existing ? 'updated' : 'created', comment_url: res.html_url, comment_id: res.id };
}

export async function run(argv, ctx = {}) {
  const stdout = ctx.stdout ?? ((s) => process.stdout.write(s));
  const stderr = ctx.stderr ?? ((s) => process.stderr.write(s));
  const full = { gh: ctx.gh ?? githubLib.createGitHub(), tmpdir: ctx.tmpdir ?? os.tmpdir() };
  const emit = (obj) => stdout(toJson(obj));
  try {
    const [sub, ...rest] = argv;
    let parsed;
    try {
      parsed = parseArgs({ args: rest, options: { dir: { type: 'string' } }, allowPositionals: true, strict: true });
    } catch (e) {
      throw new UsageError(e.message);
    }
    const { values, positionals } = parsed;
    const takesPr = sub === 'check' || sub === 'prep';
    if (takesPr && (values.dir !== undefined || positionals.length > 1)) throw new UsageError(`${sub} は PR を 1 つだけ受け取る`);
    if (!takesPr && positionals.length > 0) throw new UsageError(`${sub} は位置引数を受け取らない`);
    const handlers = {
      check: () => cmdCheck(full, positionals),
      prep: () => cmdPrep(full, positionals),
      validate: () => cmdValidate(full, values),
      render: () => cmdRender(full, values),
      post: () => cmdPost(full, values),
    };
    if (!handlers[sub]) throw new UsageError(sub ? `不明なサブコマンド: ${sub}` : 'サブコマンドを指定すること');
    emit(handlers[sub]());
    return 0;
  } catch (e) {
    if (e instanceof UsageError) {
      stderr(`pr-story: ${e.message}\n${USAGE}\n`);
      return 2;
    }
    if (e instanceof ContentError) {
      if (e.payload) emit(e.payload);
      stderr(`pr-story: ${e.message}\n`);
      return 1;
    }
    if (e instanceof CommandError) {
      stderr(`pr-story: ${e.message}\n`);
      return 3;
    }
    stderr(`pr-story: 予期しないエラー: ${e.stack ?? e.message}\n`);
    return 1;
  }
}

function isMain() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (process.argv[1] && isMain()) {
  process.exitCode = await run(process.argv.slice(2));
}
