import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildIndex, fingerprint, parseDiff } from '../scripts/lib/diff.mjs';

export function fixture(name) {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
}

export function prepFrom(name, extra = {}) {
  const index = buildIndex(parseDiff(fixture(name)));
  return {
    version: 1,
    host: 'github.com',
    owner: 'octo',
    repo: 'demo',
    number: 7,
    url: 'https://github.com/octo/demo/pull/7',
    title: 'サンプル PR',
    body: '本文',
    base_ref: 'main',
    head_ref: 'feature',
    base: 'b'.repeat(40),
    head: 'a'.repeat(40),
    diff_source: 'gh',
    fingerprint: fingerprint(index.hunks),
    commits: [{ oid: 'c'.repeat(40), headline: 'feat: サンプル', body: '詳細' }],
    ...index,
    ...extra,
  };
}

// basic.diff の lockfile 以外の hunk を全部章に入れた正しい story
export function validStory() {
  return {
    prologue: {
      title: 'サンプルの変更',
      overview: '複数のファイルを変更する。',
      key_changes: ['multi.rb を変更'],
      risks: ['削除ファイルの参照元'],
      diagram: '',
      motivation: { problem: '課題', approach: '手段', rationale: '記載なし' },
      impact: ['呼び出し元 A'],
      glossary: [{ term: 'hunk', description: '差分の塊' }],
    },
    chapters: [
      {
        id: 'ch1',
        title: '本体の変更',
        summary: 'multi.rb と new.rb',
        hunk_refs: [
          { file_path: 'app/multi.rb', old_start: 2 },
          { file_path: 'app/multi.rb', old_start: 47 },
          { file_path: 'app/new.rb', old_start: 0 },
        ],
        diagram: '',
      },
      {
        id: 'ch2',
        title: 'ライブラリ',
        summary: '',
        hunk_refs: [
          { file_path: 'lib/after.rb', old_start: 7 },
          { file_path: 'lib/old.rb', old_start: 1 },
          { file_path: 'lib/tricky.txt', old_start: 1 },
        ],
      },
    ],
    support: [{ hunk_refs: [{ file_path: 'docs/日本語.md', old_start: 1 }], reason: '文言のみ' }],
  };
}
