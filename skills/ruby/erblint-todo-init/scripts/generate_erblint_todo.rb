#!/usr/bin/env ruby
# frozen_string_literal: true

# bundle exec erblint app --format json の出力から、.erb_lint_todo.yml と
# .erb-lint-rubocop-todo.yml をプロジェクトルート（実行時のカレントディレクトリ）に生成する。
#
# 使い方:
#     bundle exec erblint app --format json | ruby generate_erblint_todo.rb
#     ruby generate_erblint_todo.rb <json_path>
#
# 引数:
#     json_path  erblint --format json の出力ファイルパス（省略時は標準入力から読む）
#
# NOTE: 本体 .erb_lint.yml に既存 exclude を持つリンターがあれば todo に移設・統合する判断は
# ここでは機械化しない（deep_merge 上書き対策の設計判断そのもののため、人間/エージェントが行う）。

require 'json'
require 'date'

json_source = ARGV[0] ? File.read(ARGV[0]) : $stdin.read
data = JSON.parse(json_source)

by_cop = Hash.new { |h, k| h[k] = [] }
by_linter = Hash.new { |h, k| h[k] = [] }

data.fetch('files').each do |file|
  path = file.fetch('path')
  file.fetch('offenses').each do |offense|
    linter = offense.fetch('linter')
    if linter == 'Rubocop'
      match = offense.fetch('message').match(%r{\A([\w/]+):})
      next unless match

      by_cop[match[1]] << path
    else
      by_linter[linter] << path
    end
  end
end

generated_on = Date.today.iso8601

# NOTE: 違反ゼロの種別は todo を書き出さない（かつ再生成時に古い todo が残らないよう既存を削除する）。
# 空の todo（rubocop なら cop なし、独自リンターなら linters が空）は inherit_from で読ませても
# 何も除外しない無意味なファイルで、これを生成すると「空 todo を参照する」余計な運用が残るため。
def write_or_remove(path, has_entries, lines)
  if has_entries
    File.write(path, "#{lines.join("\n")}\n")
    warn "Wrote #{path}"
  elsif File.exist?(path)
    File.delete(path)
    warn "Removed #{path} (no offenses; existing todo deleted)"
  else
    warn "Skipped #{path} (no offenses)"
  end
end

rubocop_todo = [
  '# erblint の Rubocop リンター用 todo（cop×ファイル単位の Exclude）。',
  '# .erb_lint.yml の Rubocop.rubocop_config.inherit_from から読まれる。',
  "# 対応が済んだら該当行を削除して違反を復活させ、修正すること（生成: #{generated_on}）。",
]
by_cop.keys.sort.each do |cop|
  rubocop_todo << "#{cop}:"
  rubocop_todo << '  Exclude:'
  by_cop[cop].uniq.sort.each { |path| rubocop_todo << "    - #{path}" }
end
write_or_remove('.erb-lint-rubocop-todo.yml', by_cop.any?, rubocop_todo)

erblint_todo = [
  '# bundle exec erblint app の既存違反をファイル単位で無効化した todo。',
  "# 対応が済んだら該当行を削除して違反を復活させ、修正すること（生成: #{generated_on}）。",
  'linters:',
]
by_linter.keys.sort.each do |linter|
  erblint_todo << "  #{linter}:"
  erblint_todo << '    exclude:'
  by_linter[linter].uniq.sort.each { |path| erblint_todo << "      - #{path}" }
end
write_or_remove('.erb_lint_todo.yml', by_linter.any?, erblint_todo)
