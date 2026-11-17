import { blobUrl, fileUrl } from './diff.mjs';

// 素のテキスト中のパス形トークン。`/` を 1 つ以上含む ASCII のトークンで、
// 直前が [\w./:@-] のもの（URL の一部やパスの途中）は拾わない。
// render の breakMentions が @ の後に入れるゼロ幅スペース（​）の後も、@scope/pkg の途中なので拾わない。
// （リンク化は無害化後のテキストに対して走るため、ここで ​ を除外する必要がある）
const PLAIN_PATH_RE = /(?<![\w./:@​-])[\w.-]+(?:\/[\w.-]+)+/g;
// 末尾が `.拡張子`（英字を 1 文字以上含む）であること
const PATH_EXT_RE = /\.[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*$/;
// 飛ばす区間（既存の Markdown リンク、URL）と、中身を判定するインラインコード
const SEGMENT_RE = /(!?\[[^\]\n]*\]\([^)\n]*\))|(https?:\/\/[^\s<>]+)|(`+)([^`]|[^`][\s\S]*?[^`])\3(?!`)/g;

function isPathLike(s) {
  return s.includes('/') && !s.startsWith('/') && !s.includes('://') && PATH_EXT_RE.test(s);
}

// インラインコードは中身全体がパス形のときだけ対象にする（日本語などを含むパスも許す）
function isCodePath(s) {
  return /^[^\s`]+$/.test(s) && isPathLike(s);
}

// 1 行の中のパス候補を走査する。linkPaths と findPaths が同じ規則で判定するよう、走査はここだけに置く。
// visit(path, text) は置き換え後の文字列を返す。text はパスを含む元の文字列
// （素のテキストならパス自体、インラインコードならバッククォート込みの全体）
function scanLine(line, visit) {
  const plain = (text) =>
    text.replace(PLAIN_PATH_RE, (token) => {
      // 文末の「.」などは拡張子に含めない
      const path = token.replace(/\.+$/, '');
      return isPathLike(path) ? visit(path, path) + token.slice(path.length) : token;
    });
  let out = '';
  let last = 0;
  for (const m of line.matchAll(SEGMENT_RE)) {
    out += plain(line.slice(last, m.index));
    last = m.index + m[0].length;
    const code = m[4];
    out += code !== undefined && isCodePath(code) ? visit(code, m[0]) : m[0];
  }
  return out + plain(line.slice(last));
}

// 1 行の中のパスを Markdown リンクにする。既存のリンクと URL は触らない。
// urlFor(path) が null を返したパスは元の文字列のまま残す
export function linkPaths(line, urlFor) {
  return scanLine(line, (path, text) => {
    const url = urlFor(path);
    return url ? `[${text}](${url})` : text;
  });
}

// コードフェンスの外の行だけに fn(line) を適用する（フェンスの中は触らない）
export function mapProseLines(text, fn) {
  let fence = null;
  return String(text)
    .split('\n')
    .map((line) => {
      const m = line.match(/^\s*(`{3,}|~{3,})/);
      if (fence) {
        if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
        return line;
      }
      if (m) {
        fence = m[1];
        return line;
      }
      return fn(line);
    })
    .join('\n');
}

// 散文の中でリンク化の対象になるパスを、出現順に重複なく返す（render と同じ規則で判定する）。
// 無害化（メンション・コメント記号）前の素の文章を走査する。無害化は @ の直後と <!-- / --> だけを変え、
// パスの検出結果は変わらない（@ の直後は元から対象外）
export function findPaths(text) {
  const found = new Set();
  mapProseLines(text, (line) =>
    scanLine(line, (path, t) => {
      found.add(path);
      return t;
    }),
  );
  return [...found];
}

// PR 内のファイルは Files タブのアンカー、PR 外で head のツリーにあるファイルは blob URL、
// どちらにもなければ null（リンクにしない）。結果は Map でメモ化する
export function makePathLinker(prep, tree = {}) {
  const inPr = new Set([...(prep.hunks ?? []), ...(prep.files_without_hunks ?? [])].map((f) => f.file_path));
  const inTree = new Set(tree.paths ?? []);
  const cache = new Map();
  return (path) => {
    if (!cache.has(path)) {
      cache.set(path, inPr.has(path) ? fileUrl(prep.url, path) : inTree.has(path) ? blobUrl(prep.url, prep.head, path) : null);
    }
    return cache.get(path);
  };
}
