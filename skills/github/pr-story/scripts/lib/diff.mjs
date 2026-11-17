import { createHash } from 'node:crypto';

export const LOCKFILES = new Set([
  'Gemfile.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'Cargo.lock',
  'go.sum',
  'poetry.lock',
  'composer.lock',
  'uv.lock',
]);

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

// 不正な UTF-8 は置換文字にする（例外にしない）
export function decodeDiff(buf) {
  if (typeof buf === 'string') return buf;
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

const ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

// git の C 形式クォート（"a/\346\227\245.md"）を解除する。クォートなしはそのまま返す
export function unquotePath(s) {
  if (!(s.length >= 2 && s.startsWith('"') && s.endsWith('"'))) return s;
  const inner = s.slice(1, -1);
  const bytes = [];
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c !== '\\') {
      for (const b of Buffer.from(c, 'utf8')) bytes.push(b);
      continue;
    }
    const next = inner[i + 1];
    if (/[0-7]/.test(next ?? '')) {
      const m = inner.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)[0];
      bytes.push(parseInt(m, 8) & 0xff);
      i += m.length;
    } else if (next in ESCAPES) {
      bytes.push(ESCAPES[next]);
      i += 1;
    } else {
      bytes.push(92);
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.from(bytes));
}

function stripPrefix(p, prefix) {
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

// "--- a/path\t" のような行からパスを取り出す。/dev/null は null
function headerPath(rest, prefix) {
  let p = rest.replace(/\t.*$/, '');
  if (p === '/dev/null') return null;
  p = unquotePath(p);
  return stripPrefix(p, prefix);
}

// "diff --git a/x b/y" からパスの組を取り出す（バイナリやモード変更のみの場合に使う）
function parseGitLine(rest) {
  const tokens = [];
  let i = 0;
  while (i < rest.length && tokens.length < 2) {
    if (rest[i] === ' ') {
      i++;
      continue;
    }
    if (rest[i] === '"') {
      let j = i + 1;
      while (j < rest.length && rest[j] !== '"') j += rest[j] === '\\' ? 2 : 1;
      tokens.push(rest.slice(i, j + 1));
      i = j + 1;
    } else if (tokens.length === 0 && !rest.includes('"')) {
      // クォートなし: 同じパスなら半分に割る。違えば " b/" で割る
      const half = (rest.length - 1) / 2;
      if (Number.isInteger(half) && rest[half] === ' ' && stripPrefix(rest.slice(0, half), 'a/') === stripPrefix(rest.slice(half + 1), 'b/')) {
        return [stripPrefix(rest.slice(0, half), 'a/'), stripPrefix(rest.slice(half + 1), 'b/')];
      }
      const k = rest.indexOf(' b/');
      if (k >= 0) return [stripPrefix(rest.slice(0, k), 'a/'), stripPrefix(rest.slice(k + 1), 'b/')];
      return [rest, rest];
    } else {
      const j = rest.indexOf(' ', i);
      const end = j < 0 ? rest.length : j;
      tokens.push(rest.slice(i, end));
      i = end;
    }
  }
  const [a = '', b = a] = tokens;
  return [stripPrefix(unquotePath(a), 'a/'), stripPrefix(unquotePath(b), 'b/')];
}

function finishFile(f) {
  const [gitOld, gitNew] = f.gitPaths;
  const oldPath = f.renameFrom ?? f.minusPath ?? (f.deleted || !f.added ? gitOld : null);
  const newPath = f.renameTo ?? f.plusPath ?? (f.added || !f.deleted ? gitNew : null);
  let status = 'modified';
  if (f.added) status = 'added';
  else if (f.deleted) status = 'deleted';
  else if (f.renameFrom != null || f.renameTo != null) status = 'renamed';
  const path = status === 'deleted' ? oldPath : newPath;
  let reason = null;
  if (f.hunks.length === 0) {
    if (f.binary) reason = 'binary';
    else if (status === 'renamed') reason = 'rename';
    else if (f.modeChange) reason = 'mode';
    else reason = 'empty';
  }
  return {
    path,
    old_path: oldPath,
    new_path: newPath,
    status,
    binary: f.binary,
    no_hunk_reason: reason,
    hunks: f.hunks.map(({ lines, ...h }) => ({ ...h, body: lines.length ? lines.join('\n') + '\n' : '' })),
  };
}

// unified diff を解析する。ファイル境界は "diff --git " だけで判定し、
// "---" / "+++" は最初の "@@" より前でだけ見る
export function parseDiff(input) {
  const text = decodeDiff(input).replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const files = [];
  let cur = null;
  let hunk = null;
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (cur) files.push(finishFile(cur));
      cur = {
        gitPaths: parseGitLine(line.slice('diff --git '.length)),
        hunks: [],
        added: false,
        deleted: false,
        binary: false,
        modeChange: false,
      };
      hunk = null;
      continue;
    }
    if (!cur) continue;
    const m = line.match(HUNK_HEADER);
    if (m) {
      hunk = {
        old_start: Number(m[1]),
        old_count: m[2] === undefined ? 1 : Number(m[2]),
        new_start: Number(m[3]),
        new_count: m[4] === undefined ? 1 : Number(m[4]),
        header: line,
        lines: [],
      };
      cur.hunks.push(hunk);
      continue;
    }
    if (hunk) {
      hunk.lines.push(line);
      continue;
    }
    if (line.startsWith('--- ')) cur.minusPath = headerPath(line.slice(4), 'a/');
    else if (line.startsWith('+++ ')) cur.plusPath = headerPath(line.slice(4), 'b/');
    else if (line.startsWith('new file mode')) cur.added = true;
    else if (line.startsWith('deleted file mode')) cur.deleted = true;
    else if (line.startsWith('rename from ')) cur.renameFrom = unquotePath(line.slice('rename from '.length));
    else if (line.startsWith('rename to ')) cur.renameTo = unquotePath(line.slice('rename to '.length));
    else if (line.startsWith('old mode') || line.startsWith('new mode')) cur.modeChange = true;
    else if (line.startsWith('Binary files ') || line === 'GIT binary patch') cur.binary = true;
  }
  if (cur) files.push(finishFile(cur));
  return files;
}

export function hunkIdString(filePath, oldStart) {
  return `(${filePath}, ${oldStart})`;
}

export function hunkKey(filePath, oldStart) {
  return `${filePath}\u0000${oldStart}`;
}

function compareCodeUnits(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function indexHunks(hunks) {
  return new Map(hunks.map((h) => [hunkKey(h.file_path, h.old_start), h]));
}

// hunk のないファイルの理由（no_hunk_reason）の表示名
export const NO_HUNK_LABELS = { rename: 'リネームのみ', binary: 'バイナリ', mode: 'モード変更のみ', empty: '内容の変更なし' };

export function compareIds(a, b) {
  return compareCodeUnits(a.file_path, b.file_path) || a.old_start - b.old_start;
}

export function isLockfile(path) {
  const base = path.split('/').pop();
  return LOCKFILES.has(base);
}

// 解析結果から hunk 索引・preplaced・hunk のないファイルを作る
export function buildIndex(files) {
  const hunks = [];
  const preplaced = [];
  const filesWithoutHunks = [];
  for (const f of files) {
    if (f.hunks.length === 0) {
      filesWithoutHunks.push({ file_path: f.path, old_path: f.old_path, status: f.status, reason: f.no_hunk_reason });
      continue;
    }
    for (const h of f.hunks) {
      const entry = {
        file_path: f.path,
        old_start: h.old_start,
        old_count: h.old_count,
        new_start: h.new_start,
        new_count: h.new_count,
        status: f.status,
        header: h.header,
        body: h.body,
      };
      hunks.push(entry);
      if (isLockfile(f.path)) preplaced.push({ file_path: f.path, old_start: h.old_start });
    }
  }
  return { hunks, preplaced, files_without_hunks: filesWithoutHunks };
}

// hunk の ID と本文を ID 順に連結した sha256
export function fingerprint(hunks) {
  const sorted = [...hunks].sort(compareIds);
  const sum = createHash('sha256');
  for (const h of sorted) {
    sum.update(hunkIdString(h.file_path, h.old_start));
    sum.update('\u0000');
    sum.update(h.header);
    sum.update('\n');
    sum.update(h.body);
    sum.update('\u0000');
  }
  return sum.digest('hex');
}

export function pathAnchor(path) {
  return 'diff-' + createHash('sha256').update(path, 'utf8').digest('hex');
}

// 削除のみの hunk は旧側（L）、それ以外は新側（R）の行へリンクする
export function hunkAnchor(h) {
  const side = h.new_count === 0 ? `L${h.old_start}` : `R${h.new_start}`;
  return `${pathAnchor(h.file_path)}${side}`;
}

export function hunkUrl(prUrl, h) {
  return `${prUrl}/files#${hunkAnchor(h)}`;
}

export function fileUrl(prUrl, path) {
  return `${prUrl}/files#${pathAnchor(path)}`;
}
