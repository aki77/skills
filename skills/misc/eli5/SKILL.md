---
description: Explain a topic like I'm a 5 year old. Use when the user types /eli5 <topic> or asks for a dead-simple picture explainer of how something works. Pass --local to write a standalone HTML file instead of publishing an artifact.
name: eli5
disable-model-invocation: true
license: MIT
argument-hint: "[--local] <topic>"
---
# eli5

Explain like I'm someone who knows nothing about this topic, using big pictures and few words.

## Output target (decide this first)

Parse `--local` out of the arguments before anything else. The remaining text is the topic.

- **No `--local`** → publish as an HTML artifact. The Artifact tool wraps your file in
  `<!doctype html><head>…</head><body>`, so do **not** write `<!DOCTYPE>`, `<html>`,
  `<head>` or `<body>` yourself. Put `<title>` and `<style>` at the top of the file.
- **`--local`** → write a complete, standalone HTML file to disk. Nothing wraps it for you,
  so you must write the whole document. Follow
  [references/local-html.md](references/local-html.md) — it has the required skeleton,
  the local-only caveats, and a validator to run before you report done.

The difference is only "fragment vs complete document", but browsers render an
invalid fragment just fine — so get it right by construction, not by eyeballing it.

Topic: $ARGUMENTS
