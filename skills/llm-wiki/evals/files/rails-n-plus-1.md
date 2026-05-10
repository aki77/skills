---
title: RailsのN+1問題とEager Loading
source_url: https://example.com/rails-n-plus-1
clipped: 2024-01-16
---

# RailsのN+1問題とEager Loading

N+1問題は、1件のクエリでN件のレコードを取得した後、各レコードに対して追加クエリが発生するパターン。100件の投稿があれば101回クエリが走る。

## 問題のパターン

```ruby
# N+1が発生するコード
posts = Post.all
posts.each do |post|
  puts post.user.name  # 各ループでユーザーを取得するクエリが走る
end
```

## 解決策: includes

`includes` はデフォルトで関連レコードを事前に読み込む（プリロード）。

```ruby
posts = Post.includes(:user)
posts.each do |post|
  puts post.user.name  # 追加クエリなし
end
```

## includes / preload / eager_load の違い

**preload**: 常に別クエリ2本で取得。シンプルだが関連テーブルの条件指定不可。

```ruby
Post.preload(:comments)
# SELECT * FROM posts
# SELECT * FROM comments WHERE post_id IN (1,2,3,...)
```

**eager_load**: JOINで取得。関連テーブルのカラムでWHEREやORDER BY できる。

```ruby
Post.eager_load(:comments).where(comments: { approved: true })
# SELECT posts.*, comments.* FROM posts
#   LEFT OUTER JOIN comments ON comments.post_id = posts.id
#   WHERE comments.approved = true
```

**includes**: 賢く自動選択。条件なしなら `preload` 相当（2クエリ）、関連テーブルに条件があれば `eager_load`（JOIN）に切り替わる。

基本は `includes` を使い、関連テーブルをWHEREで絞る場合のみ `eager_load` を明示する。

## bulletgem

開発環境でN+1を自動検出するgemとして `bullet` が定番。

```ruby
# Gemfile
gem 'bullet', group: :development
```

```ruby
# config/environments/development.rb
config.after_initialize do
  Bullet.enable = true
  Bullet.alert = true
  Bullet.rails_logger = true
end
```

## ネストした関連のEager Loading

```ruby
# 投稿 → コメント → コメント投稿者 を一度にロード
Post.includes(comments: :user)
```

## countとsizeの違い

`count` は常にSQLを発行する。`size` はすでにロード済みの場合はSQLを発行しない。

```ruby
posts = Post.includes(:comments)
post.comments.size   # ロード済みなのでSQLなし
post.comments.count  # 常にSQLを発行
```
