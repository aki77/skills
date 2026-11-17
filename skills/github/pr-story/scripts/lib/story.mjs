import { NO_HUNK_LABELS, compareIds, hunkIdString, hunkKey, indexHunks } from './diff.mjs';

export const MAX_TITLE = 48;
export const MAX_GLOSSARY = 5;
export const PLACED_FLOOR = 0.5;
export const RESERVED_CHAPTER_IDS = new Set(['overview', 'support']);
export const REASON_PREPLACED = 'ロックファイル（機械的な変更）';
export const REASON_AUTO_FILLED = '未分類';

export function truncateTitle(s) {
  const chars = Array.from(s);
  if (chars.length <= MAX_TITLE) return s;
  return chars.slice(0, MAX_TITLE - 3).join('') + '...';
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';

function stringList(v) {
  return Array.isArray(v) ? v.filter(nonEmptyString).map((s) => s.trim()) : null;
}

// story.json を prep の索引に照らして検証・正規化する。
// 誤りは最初の 1 件で止めず全種類を集めて返す（Claude が 1 回で直せるように）
export function validateStory(story, prep) {
  const errors = [];
  const warnings = [];
  const err = (code, message, extra = {}) => errors.push({ code, message, ...extra });
  const warn = (code, message, extra = {}) => warnings.push({ code, message, ...extra });

  const indexed = indexHunks(prep.hunks);
  const preplacedKeys = new Set((prep.preplaced ?? []).map((r) => hunkKey(r.file_path, r.old_start)));

  if (!isObject(story)) {
    err('invalid_story', 'story.json のトップレベルはオブジェクトにする');
    return result(false, errors, warnings, null, null);
  }

  // prologue
  const p = isObject(story.prologue) ? story.prologue : null;
  if (!p) err('invalid_prologue', 'prologue がない', { path: 'prologue' });
  const prologue = {};
  if (p) {
    for (const key of ['title', 'overview']) {
      if (!nonEmptyString(p[key])) err('invalid_prologue', `prologue.${key} は空でない文字列にする`, { path: `prologue.${key}` });
    }
    for (const key of ['key_changes', 'risks']) {
      const list = stringList(p[key]);
      if (!list || list.length === 0) err('invalid_prologue', `prologue.${key} は空でない文字列を 1 つ以上含む配列にする`, { path: `prologue.${key}` });
    }
    prologue.title = nonEmptyString(p.title) ? truncateTitle(p.title.trim()) : '';
    prologue.overview = nonEmptyString(p.overview) ? p.overview.trim() : '';
    prologue.key_changes = stringList(p.key_changes) ?? [];
    prologue.risks = stringList(p.risks) ?? [];
    prologue.diagram = typeof p.diagram === 'string' ? p.diagram.trim() : '';

    const m = isObject(p.motivation) ? p.motivation : null;
    prologue.motivation = {};
    for (const key of ['problem', 'approach', 'rationale']) {
      if (!m || !nonEmptyString(m[key])) {
        err('invalid_motivation', `prologue.motivation.${key} は空でない文字列にする（根拠がなければ「記載なし」）`, { path: `prologue.motivation.${key}` });
      }
      prologue.motivation[key] = m && nonEmptyString(m[key]) ? m[key].trim() : '';
    }

    if (p.impact !== undefined && !Array.isArray(p.impact)) {
      err('invalid_impact', 'prologue.impact は文字列の配列にする', { path: 'prologue.impact' });
    }
    prologue.impact = stringList(p.impact) ?? [];

    let glossary = [];
    if (p.glossary !== undefined) {
      if (!Array.isArray(p.glossary)) {
        err('invalid_glossary', 'prologue.glossary は {term, description} の配列にする', { path: 'prologue.glossary' });
      } else {
        p.glossary.forEach((g, i) => {
          if (!isObject(g) || !nonEmptyString(g.term) || !nonEmptyString(g.description)) {
            err('invalid_glossary', `prologue.glossary[${i}] は term と description を持つオブジェクトにする`, { path: `prologue.glossary[${i}]` });
          } else {
            glossary.push({ term: g.term.trim(), description: g.description.trim() });
          }
        });
      }
    }
    if (glossary.length > MAX_GLOSSARY) {
      warn('glossary_truncated', `glossary が ${glossary.length} 件あったので先頭 ${MAX_GLOSSARY} 件に切り詰めた`);
      glossary = glossary.slice(0, MAX_GLOSSARY);
    }
    prologue.glossary = glossary;
  }

  // 参照の収集
  const occurrences = new Map(); // key -> {ref, locations}
  const unknown = new Map();
  const removedPreplaced = new Map();

  function normalizeRefs(refs, where) {
    if (!Array.isArray(refs)) {
      err('invalid_ref', `${where}.hunk_refs は配列にする`, { path: `${where}.hunk_refs` });
      return [];
    }
    const out = [];
    refs.forEach((r, i) => {
      const loc = `${where}.hunk_refs[${i}]`;
      let oldStart = r?.old_start;
      if (typeof oldStart === 'string' && /^\d+$/.test(oldStart)) {
        warn('old_start_coerced', `${loc}.old_start が文字列だったので数値として扱った`, { path: loc });
        oldStart = Number(oldStart);
      }
      if (!isObject(r) || !nonEmptyString(r.file_path) || !Number.isInteger(oldStart) || oldStart < 0) {
        err('invalid_ref', `${loc} は {file_path: 文字列, old_start: 0 以上の整数} にする`, { path: loc, value: r ?? null });
        return;
      }
      const ref = { file_path: r.file_path, old_start: oldStart };
      const key = hunkKey(ref.file_path, ref.old_start);
      if (preplacedKeys.has(key)) {
        if (!removedPreplaced.has(key)) removedPreplaced.set(key, { ...ref, locations: [] });
        removedPreplaced.get(key).locations.push(loc);
        return;
      }
      if (!indexed.has(key)) {
        if (!unknown.has(key)) unknown.set(key, { ...ref, locations: [] });
        unknown.get(key).locations.push(loc);
        return;
      }
      if (!occurrences.has(key)) occurrences.set(key, { ...ref, locations: [] });
      occurrences.get(key).locations.push(loc);
      out.push(ref);
    });
    return out;
  }

  // chapters
  const chapters = [];
  if (!Array.isArray(story.chapters)) {
    err('invalid_chapter', 'chapters は配列にする', { path: 'chapters' });
  } else {
    const seenIds = new Set();
    story.chapters.forEach((c, i) => {
      const where = `chapters[${i}]`;
      if (!isObject(c)) {
        err('invalid_chapter', `${where} はオブジェクトにする`, { path: where });
        return;
      }
      const id = c.id;
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id) || RESERVED_CHAPTER_IDS.has(id)) {
        err('invalid_chapter_id', `${where}.id は [A-Za-z0-9_-]+ で、overview と support 以外にする`, { path: `${where}.id`, value: id ?? null });
      } else if (seenIds.has(id)) {
        err('duplicate_chapter_id', `${where}.id "${id}" が重複している`, { path: `${where}.id`, value: id });
      } else {
        seenIds.add(id);
      }
      if (!nonEmptyString(c.title)) err('invalid_chapter', `${where}.title は空でない文字列にする`, { path: `${where}.title` });
      const label = typeof id === 'string' ? `chapters[${i}](id=${id})` : where;
      const refs = normalizeRefs(c.hunk_refs, label);
      chapters.push({
        id: typeof id === 'string' ? id : '',
        title: nonEmptyString(c.title) ? truncateTitle(c.title.trim()) : '',
        summary: typeof c.summary === 'string' ? c.summary.trim() : '',
        hunk_refs: refs,
        diagram: typeof c.diagram === 'string' ? c.diagram.trim() : '',
      });
    });
  }

  // support
  const support = [];
  if (story.support !== undefined && !Array.isArray(story.support)) {
    err('invalid_support', 'support は配列にする', { path: 'support' });
  } else {
    (story.support ?? []).forEach((s, i) => {
      const where = `support[${i}]`;
      if (!isObject(s)) {
        err('invalid_support', `${where} はオブジェクトにする`, { path: where });
        return;
      }
      const refs = normalizeRefs(s.hunk_refs, where);
      if (refs.length > 0) support.push({ hunk_refs: refs, reason: typeof s.reason === 'string' ? s.reason.trim() : '' });
    });
  }

  if (removedPreplaced.size > 0) {
    warn('preplaced_ref_removed', 'ロックファイルの hunk は配置済みなので story.json 側の参照を取り除いた', {
      refs: [...removedPreplaced.values()].sort(compareIds).map(withId),
    });
  }
  if (unknown.size > 0) {
    err('unknown_refs', 'prep.txt の hunk 一覧にない参照がある。file_path と old_start を prep.txt の見出しどおりに直す', {
      refs: [...unknown.values()].sort(compareIds).map(withId),
    });
  }
  const duplicated = [...occurrences.values()].filter((o) => o.locations.length > 1).sort(compareIds);
  if (duplicated.length > 0) {
    err('duplicate_refs', '同じ hunk を複数の箇所に配置している。どれか 1 か所だけに残す', { refs: duplicated.map(withId) });
  }

  // 配置率（preplaced を配置済みとして数える）
  const total = prep.hunks.length;
  const placedKeys = new Set([...occurrences.keys(), ...preplacedKeys]);
  const missing = prep.hunks
    .filter((h) => !placedKeys.has(hunkKey(h.file_path, h.old_start)))
    .map((h) => ({ file_path: h.file_path, old_start: h.old_start }))
    .sort(compareIds);
  const placed = total - missing.length;
  const ratio = total === 0 ? 1 : placed / total;
  const coverage = { indexed: total, placed, preplaced: preplacedKeys.size, auto_filled: 0, ratio: Math.round(ratio * 1000) / 1000 };

  if (missing.length > 0 && ratio < PLACED_FLOOR) {
    err('below_floor', `配置した hunk が ${placed}/${total} で半分に満たない。未配置の hunk を章か support に入れる`, { refs: missing.map(withId) });
  }

  for (const c of chapters) {
    if (c.hunk_refs.length === 0) warn('empty_chapter', `章 "${c.id}" に hunk がない`, { path: `chapters(id=${c.id})` });
  }

  if (errors.length > 0) return result(false, errors, warnings, coverage, null);

  if (preplacedKeys.size > 0) {
    support.push({ hunk_refs: [...prep.preplaced].map(({ file_path, old_start }) => ({ file_path, old_start })).sort(compareIds), reason: REASON_PREPLACED });
  }
  if (missing.length > 0) {
    support.push({ hunk_refs: missing, reason: REASON_AUTO_FILLED });
    coverage.auto_filled = missing.length;
    warn('auto_filled', `未配置の hunk ${missing.length} 件を support（${REASON_AUTO_FILLED}）に補填した`, { refs: missing.map(withId) });
  }

  return result(true, errors, warnings, coverage, { prologue, chapters, support });
}

function withId(r) {
  return { id: hunkIdString(r.file_path, r.old_start), ...r };
}

function result(ok, errors, warnings, coverage, story) {
  return { ok, errors, warnings, coverage, story };
}

// Claude が読むための prep.txt を組み立てる
export function buildPrepText(prep) {
  const out = [];
  out.push('=== PR ===');
  out.push(`url: ${prep.url}`);
  out.push(`title: ${prep.title}`);
  out.push(`base: ${prep.base_ref} (${prep.base})`);
  out.push(`head: ${prep.head_ref} (${prep.head})`);
  out.push(`hunks: ${prep.hunks.length}（うち配置済み ${prep.preplaced.length}）`);
  out.push('');
  out.push('=== BODY ===');
  out.push(prep.body && prep.body.trim() ? prep.body.replace(/\r\n/g, '\n').trimEnd() : '（本文なし）');
  out.push('');
  if (prep.commits.length > 0) {
    out.push('=== COMMITS ===');
    for (const c of prep.commits) {
      out.push(`${c.oid.slice(0, 7)} ${c.headline}`);
      if (c.body && c.body.trim()) out.push(...c.body.replace(/\r\n/g, '\n').trimEnd().split('\n').map((l) => `    ${l}`));
    }
    out.push('');
  }
  if (prep.files_without_hunks.length > 0) {
    out.push('=== FILES WITHOUT HUNKS ===');
    out.push('# hunk がないファイル。補助的な変更欄にファイル単位のリンクで自動的に載るので story.json には書かない');
    for (const f of prep.files_without_hunks) {
      const from = f.status === 'renamed' && f.old_path !== f.file_path ? ` ← ${f.old_path}` : '';
      out.push(`${f.file_path}${from} [${NO_HUNK_LABELS[f.reason] ?? f.reason}]`);
    }
    out.push('');
  }
  if (prep.preplaced.length > 0) {
    out.push('=== PREPLACED ===');
    out.push('# ロックファイルの hunk。support に配置済みなので story.json に書かない（本文は省略）');
    for (const r of prep.preplaced) out.push(`--- ${hunkIdString(r.file_path, r.old_start)} [preplaced]`);
    out.push('');
  }
  out.push('=== HUNKS ===');
  out.push('# 各 hunk は見出しの (file_path, old_start) で参照する。全 hunk を章か support にちょうど 1 回入れる');
  const preplacedKeys = new Set(prep.preplaced.map((r) => hunkKey(r.file_path, r.old_start)));
  for (const h of prep.hunks) {
    if (preplacedKeys.has(hunkKey(h.file_path, h.old_start))) continue;
    out.push(`--- ${hunkIdString(h.file_path, h.old_start)} [${h.status}]`);
    out.push(h.header);
    if (h.body) out.push(h.body.replace(/\n$/, ''));
    out.push('');
  }
  return out.join('\n') + '\n';
}
