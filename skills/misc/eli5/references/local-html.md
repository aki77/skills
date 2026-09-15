# Writing a standalone HTML file (`--local`)

Read this only when the user passed `--local`. Without it you are publishing an
artifact and none of this applies.

## `--local`: the skeleton

Write exactly this shape. The artifact runtime normally supplies charset, viewport and a
small reset; none of that exists in a local file, so it is all spelled out here.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>…</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; }
    img { max-width: 100%; }
    [hidden] { display: none !important; }
    /* your styles */
  </style>
</head>
<body>
  …
</body>
</html>
```

Local-file caveats:

- `charset` is mandatory — without it non-ASCII text breaks over `file://`.
- No CDN allowlist applies, but an offline machine won't fetch webfonts. Give every
  font a thick fallback stack, or inline what you need.
- `localStorage` and `window.claude.*` behave differently or don't exist over `file://`.
  Don't rely on them.

## `--local`: verify before reporting done

Opening it in a browser proves nothing — browsers silently accept broken markup. After
writing the file, check it:

```bash
python3 - "$FILE" <<'EOF'
import sys
from html.parser import HTMLParser

VOID = {"area","base","br","col","embed","hr","img","input","link","meta","source","track","wbr"}

class Check(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack, self.errors, self.seen_doctype = [], [], False
    def handle_decl(self, decl):
        if decl.lower().startswith("doctype html"):
            self.seen_doctype = True
    def handle_starttag(self, tag, attrs):
        if tag not in VOID:
            self.stack.append(tag)
    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if not self.stack:
            self.errors.append(f"stray </{tag}>")
        elif self.stack[-1] != tag:
            self.errors.append(f"</{tag}> closes <{self.stack[-1]}>")
            if tag in self.stack:
                while self.stack and self.stack.pop() != tag:
                    pass
        else:
            self.stack.pop()

src = open(sys.argv[1], encoding="utf-8").read()
c = Check()
c.feed(src)
if not c.seen_doctype:
    c.errors.append("missing <!doctype html>")
for t in ("html", "head", "body"):
    if f"<{t}" not in src.lower():
        c.errors.append(f"missing <{t}>")
if c.stack:
    c.errors.append(f"unclosed: {', '.join(c.stack)}")
print("\n".join(c.errors) if c.errors else "OK")
EOF
```

Fix anything it reports, then re-run until it prints `OK`. Tell the user the path you
wrote to, and whether that path is gitignored.
