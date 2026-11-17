import { execFileSync } from 'node:child_process';
import { MARKER_PREFIX } from './render.mjs';

const MAX_BUFFER = 1024 * 1024 * 1024;
const PR_FIELDS = 'number,url,title,body,headRefOid,baseRefOid,baseRefName,headRefName,commits';

export class UsageError extends Error {}

export class CommandError extends Error {
  constructor(message, { stderr = '', status = null } = {}) {
    super(message);
    this.stderr = stderr;
    this.status = status;
  }
}

// シェルを介さずに実行し、stdout を Buffer で返す
export function defaultExec(cmd, args, { input } = {}) {
  try {
    return execFileSync(cmd, args, { maxBuffer: MAX_BUFFER, input, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString('utf8').trim() : e.message;
    throw new CommandError(`${cmd} ${args.slice(0, 2).join(' ')} が失敗した: ${stderr}`, { stderr, status: e.status ?? null });
  }
}

export function parsePrSpec(spec) {
  if (spec === undefined || spec === null || spec === '') return { arg: null };
  if (/^\d+$/.test(spec)) return { arg: spec };
  if (/^https?:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/\d+/.test(spec)) return { arg: prFromUrl(spec).url };
  throw new UsageError(`PR 番号または PR URL の形式ではない: ${spec}`);
}

export function prFromUrl(url) {
  const m = String(url).match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) throw new CommandError(`PR の URL を解釈できない: ${url}`);
  return { host: m[1], owner: m[2], repo: m[3], number: Number(m[4]), url: `https://${m[1]}/${m[2]}/${m[3]}/pull/${m[4]}` };
}

// 複数あれば作成日時（同時なら id）が最新のものを使う
export function findStoryComment(comments) {
  const found = comments.filter((c) => typeof c.body === 'string' && c.body.startsWith(MARKER_PREFIX));
  found.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id);
  return found[found.length - 1] ?? null;
}

export function createGitHub(exec = defaultExec) {
  const json = (buf) => JSON.parse(buf.toString('utf8'));
  const repoArg = (pr) => (pr.host === 'github.com' ? `${pr.owner}/${pr.repo}` : `${pr.host}/${pr.owner}/${pr.repo}`);
  const hostArgs = (pr) => (pr.host === 'github.com' ? [] : ['--hostname', pr.host]);

  function viewPr(spec) {
    const { arg } = parsePrSpec(spec);
    let data;
    try {
      data = json(exec('gh', ['pr', 'view', ...(arg ? [arg] : []), '--json', PR_FIELDS]));
    } catch (e) {
      if (!arg && e instanceof CommandError) {
        throw new CommandError(`現在のブランチに紐づく PR が見つからない。PR 番号または PR URL を指定すること（${e.stderr || e.message}）`, e);
      }
      throw e;
    }
    return { ...prFromUrl(data.url), data };
  }

  function currentHead(pr) {
    return json(exec('gh', ['pr', 'view', String(pr.number), '-R', repoArg(pr), '--json', 'headRefOid'])).headRefOid;
  }

  function gitDiff(base, head) {
    for (const sha of [base, head]) exec('git', ['cat-file', '-e', `${sha}^{commit}`]);
    const mergeBase = exec('git', ['merge-base', base, head]).toString('utf8').trim();
    return exec('git', [
      '-c', 'core.quotePath=true',
      'diff', '--no-color', '--no-ext-diff', '--no-textconv', '-M', '-U3',
      '--src-prefix=a/', '--dst-prefix=b/',
      mergeBase, head,
    ]);
  }

  // 主経路は gh pr diff。失敗したら base と head がローカルにある場合だけ git diff に切り替える
  function fetchDiff(pr, { base, head }) {
    try {
      return { diff: exec('gh', ['pr', 'diff', String(pr.number), '-R', repoArg(pr), '--color', 'never']), source: 'gh' };
    } catch (ghError) {
      try {
        return { diff: gitDiff(base, head), source: 'git' };
      } catch (gitError) {
        throw new CommandError(`diff を取得できない。gh: ${ghError.message} / git: ${gitError.message}`);
      }
    }
  }

  function listComments(pr) {
    const pages = json(exec('gh', ['api', ...hostArgs(pr), '--paginate', '--slurp', `repos/${pr.owner}/${pr.repo}/issues/${pr.number}/comments`]));
    return pages.flat();
  }

  // head のファイル一覧（blob のみ）。大きいリポジトリでは truncated になり、一部しか返らない
  function listTree(pr, sha) {
    const data = json(exec('gh', ['api', ...hostArgs(pr), `repos/${pr.owner}/${pr.repo}/git/trees/${sha}?recursive=1`]));
    const paths = (data.tree ?? []).filter((t) => t.type === 'blob').map((t) => t.path);
    return { truncated: data.truncated === true, paths };
  }

  function updateComment(pr, id, body) {
    return json(exec('gh', ['api', ...hostArgs(pr), '--method', 'PATCH', `repos/${pr.owner}/${pr.repo}/issues/comments/${id}`, '--input', '-'], { input: JSON.stringify({ body }) }));
  }

  function createComment(pr, body) {
    return json(exec('gh', ['api', ...hostArgs(pr), '--method', 'POST', `repos/${pr.owner}/${pr.repo}/issues/${pr.number}/comments`, '--input', '-'], { input: JSON.stringify({ body }) }));
  }

  return { viewPr, currentHead, fetchDiff, listComments, listTree, updateComment, createComment };
}
