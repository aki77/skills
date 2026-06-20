---
name: icon-generator
description: Generate raster icon assets (PNG) from a single SVG source using the `resvg` CLI. Use whenever the user needs application icons, app/extension assets, favicons, or any multi-size PNG export from an SVG — for Chrome / browser extensions (16/48/128 px for manifest.json), PWA / web app manifests, macOS / Windows / Linux app bundles, favicons (16/32/180/192/512 px), README badges, or any "I need a PNG at size N" task. Trigger on phrases like "create icons", "generate icons", "app icon", "extension icon", "favicon", "アイコン画像を作って", "SVGからPNGを生成", or when a project's manifest references icon files that don't yet exist. Prefer this skill over hand-drawing in Canvas, using browser screenshots, or pulling in heavy Node tooling like `sharp` — it produces clean, deterministic, hash-stable output and leaves no build-time dependencies in the project.
license: MIT
---

# Icon Generator

Generate crisp, deterministic PNG icons from a single SVG master, using the `resvg` CLI (a Rust-based renderer based on tiny-skia / usvg). The advantage over hand-rolling a Node script with `sharp` is that `resvg` is a single static binary, runs in well under a second per size, and renders SVGs with predictable text/shape handling. Because it's a one-shot CLI invocation, no build dependency is added to the project — only the generated PNGs are committed.

## When to use this skill

- The user asks to create app, extension, or web icons in multiple sizes
- A `manifest.json` (Chrome extension, PWA, web app) references icon files that don't exist yet
- The user provides an SVG and asks for PNG exports at specific sizes
- The user wants favicons or social-share images derived from an SVG logo

## Required tool: `resvg`

Check first:

```bash
which resvg && resvg --version
```

If missing, install via Cargo (the user must have `cargo` from a Rust toolchain). Confirm with the user before installing global tools:

```bash
cargo install resvg
```

This places the binary at `~/.cargo/bin/resvg`. Compilation takes ~15–30 seconds on a modern Mac.

## Standard sizes

Choose the size set that matches the target platform. If the user doesn't specify, default to the **Chrome extension** triple (16/48/128) when the project is a browser extension, otherwise ask.

| Target | Sizes (px) |
|--------|-----------|
| Chrome / Edge extension (MV3) | 16, 48, 128 |
| Firefox extension (WebExtension) | 48, 96 |
| PWA / web app manifest | 192, 512 (often add 144, 384) |
| Favicon (basic) | 16, 32 |
| Favicon (apple-touch / Android) | 180, 192, 512 |
| macOS app icon (.icns base) | 16, 32, 64, 128, 256, 512, 1024 |
| Windows app icon (.ico base) | 16, 32, 48, 256 |
| GitHub social preview | 1280 × 640 (single, not square) |

### Bundling PNGs into `.icns` (macOS) or `.ico` (Windows)

`resvg` only emits PNGs. To ship a real macOS / Windows app icon you need one more step.

**macOS `.icns`** uses Apple's `iconutil` (ships with Xcode Command Line Tools). The input is a directory named `*.iconset/` containing PNGs with this exact naming — note that `@2x` means double the physical pixels of the base name:

| Filename | Physical px |
|---|---|
| `icon_16x16.png` | 16 |
| `icon_16x16@2x.png` | 32 |
| `icon_32x32.png` | 32 |
| `icon_32x32@2x.png` | 64 |
| `icon_128x128.png` | 128 |
| `icon_128x128@2x.png` | 256 |
| `icon_256x256.png` | 256 |
| `icon_256x256@2x.png` | 512 |
| `icon_512x512.png` | 512 |
| `icon_512x512@2x.png` | 1024 |

Generate the 7 physical sizes with `resvg`, then `cp` the duplicates (`icon_32x32.png` and `icon_16x16@2x.png` are bit-identical), then run `iconutil -c icns AppIcon.iconset -o AppIcon.icns`.

**Windows `.ico`** is a multi-resolution container. Generate the four PNGs with `resvg`, then bundle with ImageMagick: `magick icon-16.png icon-32.png icon-48.png icon-256.png icon.ico`. (If `magick` isn't available, `brew install imagemagick`.) `.ico` is itself a one-shot artifact, so don't add ImageMagick as a project dependency either.

## Workflow

### 1. Decide on a layout for the SVG

The SVG should use `viewBox="0 0 N N"` (square, e.g. `0 0 128 128`) so it scales cleanly to any size. Avoid:

- Stroke widths under 1 unit at 128-viewBox — they vanish at 16 px
- Text that relies on system fonts being installed (`resvg` can use a font dir, but it's simpler to convert text to paths)
- External assets (`<image href="...">`, external CSS); embed everything inline

For a square icon viewBox, design the focal element to occupy roughly the central 70% so it survives platform rounding/masking (especially on iOS/Android maskable icons).

**Non-square targets** (GitHub social preview 1280×640, OG images, banners): match the SVG's viewBox to the target aspect ratio, e.g. `viewBox="0 0 1280 640"`. `resvg --width N` infers height from the viewBox, so a square SVG passed through `--width 1280` outputs 1280×1280, not 1280×640. If you want to reuse a square logo inside a wider canvas, write a wrapper SVG with the target viewBox and embed the logo inline (`<g transform="translate(... ) scale(...)">…logo children…</g>`); do not use `<image href="...">` or external `<use>` since those break inlining.

### 2. Place the source SVG

Put the source SVG somewhere the project keeps assets. For Chrome extensions with Vite/webpack, `public/icons/icon.svg` is conventional (the bundler copies `public/` verbatim into the build output). If the project has no asset convention, ask.

### 3. Generate PNGs

Invoke `resvg` once per target size. The `--width N` flag also sets the height for square SVGs:

```bash
resvg --width 16  public/icons/icon.svg public/icons/icon-16.png
resvg --width 48  public/icons/icon.svg public/icons/icon-48.png
resvg --width 128 public/icons/icon.svg public/icons/icon-128.png
```

Verify the output:

```bash
file public/icons/icon-*.png
# Expect: PNG image data, NxN, 8-bit/color RGBA, non-interlaced
```

Use the `Read` tool on the largest PNG to visually confirm the design renders as intended before committing.

### 4. Wire into the project

For a **Chrome extension manifest** (Manifest V3):

```json
{
  "icons": {
    "16":  "icons/icon-16.png",
    "48":  "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "action": {
    "default_icon": {
      "16":  "icons/icon-16.png",
      "48":  "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  }
}
```

`icons` is the extension's own icon (Extensions page, install dialog). `action.default_icon` is what shows in the toolbar. They can point to the same files.

For a **PWA manifest**:

```json
{
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

For **HTML favicons**:

```html
<link rel="icon" type="image/png" sizes="16x16" href="/icons/icon-16.png">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32.png">
<link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180.png">
```

### 5. Decide what to commit

Always commit:
- The source SVG (`icon.svg`) — it's the master file; regenerate from it whenever sizes change
- The generated PNGs — they're the actual shipped assets

Usually exclude from the bundled output (`dist/`, `build/`):
- The source SVG, if it's not referenced at runtime. With Vite, `public/icons/icon.svg` gets copied to `dist/icons/icon.svg` by default — add a postbuild step to delete it if you don't want it shipped.

Do NOT add `resvg` to the project's package.json — it's a one-shot generator, not a runtime or build dependency.

## Common pitfalls

- **`resvg --width 16 --height 16`**: redundant for square SVGs and may cause confusion. Pass `--width N` only; `resvg` infers height from the SVG's aspect ratio.
- **Tiny icons look muddy**: at 16 px many designs degrade. Consider a simplified mark for ≤32 px (more whitespace, thicker strokes) and a richer mark for ≥48 px. If both are needed, keep two SVG sources (`icon-small.svg`, `icon.svg`) rather than fighting one source through all sizes.
- **Maskable icons (PWA/Android)**: the OS may clip a circle / squircle out of the icon. Keep critical content inside a 40% safe zone centered in the canvas. Generate a separate `*-maskable.png` with this padding rather than reusing the regular icon.
- **`resvg` can't render `<foreignObject>`** (HTML inside SVG). Avoid it.
- **Cargo install fails**: confirm the user has Rust installed (`rustup --version`). If not, the alternative is `brew install librsvg` then `rsvg-convert -w 16 -h 16 -f png icon.svg -o icon-16.png` — same idea, different binary.

## Example: Chrome extension icon (the canonical case)

A minimal "pen + sparkle" mark, blue background with rounded corners, white pen diagonally placed, yellow sparkles. Designed at viewBox 128 so the same SVG renders cleanly at 16/48/128:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect x="0" y="0" width="128" height="128" rx="24" ry="24" fill="#1a73e8"/>
  <g transform="translate(64 64) rotate(-45) translate(-64 -64)">
    <rect x="58" y="30" width="12" height="60" fill="#ffffff"/>
    <polygon points="58,90 70,90 64,108" fill="#ffffff"/>
  </g>
  <g transform="translate(94 34)" fill="#fbbc04">
    <path d="M0 -16 L4 -4 L16 0 L4 4 L0 16 L-4 4 L-16 0 L-4 -4 Z"/>
  </g>
</svg>
```

Generate:

```bash
resvg --width 16  icon.svg icon-16.png
resvg --width 48  icon.svg icon-48.png
resvg --width 128 icon.svg icon-128.png
```

Done. Three PNGs, no project dependencies added, source SVG kept for future tweaks.
