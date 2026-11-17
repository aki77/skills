import { gunzipSync, gzipSync } from 'node:zlib';
import { NO_HUNK_LABELS, fileUrl, hunkKey, hunkUrl, indexHunks } from './diff.mjs';

export const MARKER_PREFIX = '<!-- pr-story:v1 ';
export const DATA_PREFIX = '<!-- pr-story-data:';
export const DEFAULT_LIMITS = { total: 60000, hunkLines: 60, data: 8000 };

// GitHub のコメント上限の測り方はここに閉じ込める（UTF-16 のコード単位数。コードポイント数以上になる）
export function measure(s) {
  return s.length;
}

export function byteLength(s) {
  return Buffer.byteLength(s, 'utf8');
}

export function markerLine(head, fp) {
  return `${MARKER_PREFIX}head=${head} fingerprint=${fp} -->`;
}

export function parseMarker(body) {
  const first = (body ?? '').split('\n', 1)[0].replace(/\r$/, '');
  const m = first.match(/^<!-- pr-story:v1 head=([0-9a-f]+) fingerprint=([0-9a-f]+) -->/);
  return m ? { head: m[1], fingerprint: m[2] } : null;
}

export function encodeStoryData(obj) {
  return gzipSync(Buffer.from(JSON.stringify(obj), 'utf8')).toString('base64');
}

export function decodeStoryData(b64) {
  return JSON.parse(gunzipSync(Buffer.from(b64, 'base64')).toString('utf8'));
}

export function dataLine(obj) {
  return `${DATA_PREFIX}${encodeStoryData(obj)} -->`;
}

// 隠しデータはコメントの末尾行からだけ取り出す（diff 本文中の同じ文字列は拾わない）
export function extractStoryData(body) {
  const lines = (body ?? '').replace(/\r/g, '').split('\n').map((l) => l.trimEnd());
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  const last = lines[lines.length - 1] ?? '';
  const m = last.match(/^<!-- pr-story-data:([A-Za-z0-9+/=]+) -->$/);
  if (!m) return null;
  try {
    return decodeStoryData(m[1]);
  } catch {
    return null;
  }
}

function longestBacktickRun(s) {
  return (s.match(/`+/g) ?? []).reduce((n, r) => Math.max(n, r.length), 0);
}

export function fenceFor(content, min = 3) {
  return '`'.repeat(Math.max(min, longestBacktickRun(content) + 1));
}

function inlineCode(s) {
  const tick = '`'.repeat(longestBacktickRun(s) + 1);
  const pad = s.startsWith('`') || s.endsWith('`') ? ' ' : '';
  return `${tick}${pad}${s}${pad}${tick}`;
}

// @name が通知付きのメンションにならないようにする
function breakMentions(s) {
  return s.replace(/(^|[^A-Za-z0-9_`/])@(?=[A-Za-z0-9])/g, '$1@​');
}

function neutralizeLine(line) {
  return breakMentions(line.replace(/<!--/g, '&lt;!--').replace(/-->/g, '--&gt;'));
}

// 散文の無害化。コードフェンスの中は触らない
export function sanitizeProse(text) {
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
      return neutralizeLine(line);
    })
    .join('\n');
}

function oneLine(s) {
  return sanitizeProse(String(s).replace(/\s*\n\s*/g, ' ').trim());
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function summaryText(s) {
  return breakMentions(escapeHtml(String(s).replace(/\s*\n\s*/g, ' ').trim()));
}

function details(summary, body, open = false) {
  return [`<details${open ? ' open' : ''}>`, `<summary>${summary}</summary>`, '', body.trimEnd(), '', '</details>'].join('\n');
}

function codeBlock(lang, content) {
  const fence = fenceFor(content);
  return `${fence}${lang}\n${content.replace(/\n$/, '')}\n${fence}`;
}

function bodyLines(h) {
  return h.body === '' ? [] : h.body.replace(/\n$/, '').split('\n');
}

function hunkLabel(h) {
  const line = h.new_count === 0 ? `旧 ${h.old_start} 行目` : `${h.new_start} 行目`;
  return `${inlineCode(h.file_path)} ${line}`;
}

function hunkSection(prep, h, mode, hunkLines) {
  const out = [`**[${hunkLabel(h)}](${hunkUrl(prep.url, h)})**`];
  if (mode === 'link') {
    out.push('', '（diff の埋め込みは省略。リンク先で確認）');
    return out.join('\n');
  }
  const lines = bodyLines(h);
  const shown = lines.slice(0, hunkLines);
  out.push('', codeBlock('diff', [h.header, ...shown].join('\n')));
  if (lines.length > shown.length) out.push('', `（残り ${lines.length - shown.length} 行はリンク先で確認）`);
  return out.join('\n');
}

function minimalData(story) {
  return { chapters: story.chapters.map(({ id, title, hunk_refs }) => ({ id, title, hunk_refs })) };
}

function build(prep, story, state, limits, index, dataLines) {
  const lookup = (r) => index.get(hunkKey(r.file_path, r.old_start));
  const p = story.prologue;
  const parts = [];

  parts.push(markerLine(prep.head, prep.fingerprint));
  parts.push(`## ${oneLine(p.title)}`);
  parts.push(`> このコメントは変更内容の説明であり、修正依頼ではありません。対象コミット: [${inlineCode(prep.head.slice(0, 7))}](${prep.url}/commits/${prep.head})`);
  parts.push(sanitizeProse(p.overview));

  parts.push(
    [
      '### なぜ',
      '',
      `- **課題**: ${oneLine(p.motivation.problem)}`,
      `- **手段**: ${oneLine(p.motivation.approach)}`,
      `- **理由**: ${oneLine(p.motivation.rationale)}`,
    ].join('\n'),
  );
  parts.push(['### 主な変更', '', ...p.key_changes.map((s) => `- ${oneLine(s)}`)].join('\n'));
  parts.push(['### 注意して見る点', '', ...p.risks.map((s) => `- ${oneLine(s)}`)].join('\n'));

  const supportCount = story.support.reduce((n, s) => n + s.hunk_refs.length, 0);
  const toc = story.chapters.map((c, i) => `${i + 1}. ${oneLine(c.title)}（${c.hunk_refs.length} hunk）`);
  const noHunk = prep.files_without_hunks ?? [];
  if (supportCount > 0 || noHunk.length > 0) {
    toc.push(`- 補助的な変更（${supportCount} hunk${noHunk.length ? `、hunk のないファイル ${noHunk.length} 件` : ''}）`);
  }
  parts.push(['### 章の目次', '', ...toc].join('\n'));

  if (p.impact.length > 0) parts.push(details('影響範囲', p.impact.map((s) => `- ${oneLine(s)}`).join('\n')));
  if (p.glossary.length > 0) {
    parts.push(details('用語集', p.glossary.map((g) => `- **${oneLine(g.term)}**: ${oneLine(g.description)}`).join('\n')));
  }
  if (p.diagram) parts.push(codeBlock('mermaid', p.diagram));

  story.chapters.forEach((c, i) => {
    const body = [];
    if (c.summary) body.push(sanitizeProse(c.summary));
    if (c.diagram) body.push(codeBlock('mermaid', c.diagram));
    for (const r of c.hunk_refs) {
      const h = lookup(r);
      if (!h) continue;
      body.push(hunkSection(prep, h, state.linkOnly.has(hunkKey(h.file_path, h.old_start)) ? 'link' : 'embed', limits.hunkLines));
    }
    if (body.length === 0) body.push('（hunk なし）');
    parts.push(details(`第${i + 1}章 ${summaryText(c.title)}（${c.hunk_refs.length} hunk）`, body.join('\n\n'), i === 0));
  });

  if (supportCount > 0 || noHunk.length > 0) {
    const body = [];
    for (const s of story.support) {
      body.push(`- ${s.reason ? oneLine(s.reason) : '理由の記載なし'}`);
      for (const r of s.hunk_refs) {
        const h = lookup(r);
        if (h) body.push(`  - [${hunkLabel(h)}](${hunkUrl(prep.url, h)})`);
      }
    }
    if (noHunk.length > 0) {
      body.push('- hunk のないファイル');
      for (const f of noHunk) {
        const label = NO_HUNK_LABELS[f.reason] ?? f.reason;
        const from = f.status === 'renamed' && f.old_path && f.old_path !== f.file_path ? `（${inlineCode(f.old_path)} から）` : '';
        body.push(`  - [${inlineCode(f.file_path)}](${fileUrl(prep.url, f.file_path)}) ${label}${from}`);
      }
    }
    parts.push(details(`補助的な変更（${supportCount} hunk${noHunk.length ? `、ファイル ${noHunk.length} 件` : ''}）`, body.join('\n')));
  }

  if (state.data !== 'omitted') parts.push(dataLines[state.data]);
  return parts.join('\n\n') + '\n';
}

export class RenderSizeError extends Error {
  constructor(message, stats) {
    super(message);
    this.stats = stats;
  }
}

// markdown を組み立て、上限を超える場合は段階的に縮小する
export function renderComment(prep, story, limitsIn = {}) {
  const limits = { ...DEFAULT_LIMITS, ...limitsIn };
  const state = { linkOnly: new Set(), data: 'full' };
  const reductions = [];

  // 縮小で作り直しても変わらないものは 1 回だけ計算する
  const index = indexHunks(prep.hunks);
  const dataLines = { full: dataLine(story), minimal: dataLine(minimalData(story)) };
  const rebuild = () => build(prep, story, state, limits, index, dataLines);

  if (measure(dataLines.full) > limits.data) {
    state.data = 'minimal';
    reductions.push('data_minimal');
  }

  let md = rebuild();

  if (measure(md) > limits.total) {
    const embedded = story.chapters
      .flatMap((c) => c.hunk_refs)
      .map((r) => index.get(hunkKey(r.file_path, r.old_start)))
      .filter(Boolean)
      .map((h) => ({ key: hunkKey(h.file_path, h.old_start), size: measure(hunkSection(prep, h, 'embed', limits.hunkLines)) }))
      .sort((a, b) => b.size - a.size);
    let i = 0;
    while (measure(md) > limits.total && i < embedded.length) {
      let over = measure(md) - limits.total;
      while (over > 0 && i < embedded.length) {
        state.linkOnly.add(embedded[i].key);
        over -= embedded[i].size;
        i++;
      }
      md = rebuild();
    }
    if (state.linkOnly.size > 0) reductions.push('link_only');
  }

  if (measure(md) > limits.total && state.data !== 'omitted') {
    state.data = 'omitted';
    reductions.push('data_omitted');
    md = rebuild();
  }

  const totalRefs = story.chapters.reduce((n, c) => n + c.hunk_refs.length, 0);
  const stats = {
    chars: measure(md),
    bytes: byteLength(md),
    limit: limits.total,
    embedded_hunks: totalRefs - state.linkOnly.size,
    link_only_hunks: state.linkOnly.size,
    data: state.data,
    reductions,
  };
  if (measure(md) > limits.total) {
    throw new RenderSizeError(`縮小しても ${stats.chars} 文字で上限 ${limits.total} を超える`, stats);
  }
  return { markdown: md, stats };
}
