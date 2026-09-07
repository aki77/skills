#!/usr/bin/env bash
# verify.sh — pr-review-guide が生成した HTML の自己完結性と骨格を検証する。
#
# 壊れた HTML は無いより悪い（レビュアーが artifact を開いて白紙を見る）。
# 生成後に必ずこれを実行し、違反があれば報告せずに修正して再検証する。
#
# 使い方: ./scripts/verify.sh <html-file>
#   実行権限とシェバンを持つので bash を介さず直接呼ぶ。SKILL.md の allowed-tools は
#   スクリプトのパスだけを許可しており、bash 前置では許可に一致せず headless で止まる。
#
# 終了コード:
#   0 = 全項目 OK
#   1 = 違反あり（違反項目と修正方法を stderr に列挙）
#   2 = 使い方が違う / ファイルが読めない
#
# 実装上の制約: macOS 標準の bash 3.2 と BSD grep で動くこと。
#   - grep は -c / -o / -E / -i のみ使う（GNU 固有のフラグを使わない）
#   - grep -c は「マッチした行数」を数えるので個数の比較には使えない。
#     1 行に 2 個あっても 1 と数えてしまうため、個数は必ず
#     `grep -o ... | wc -l` で数える。
#   - 連想配列（declare -A）や mapfile は bash 3.2 に無いので使わない
#   - set -e / pipefail は使わない。`grep -o | wc -l` は 0 件のとき
#     grep が終了コード 1 を返すため、途中で死んでしまう。
#   - python3 は「矢印の接続」検証だけに使う任意依存。無い環境ではその
#     項目だけをスキップし、他の検証と終了コードには影響させない。

set -u

F="${1:-}"

if [ -z "$F" ]; then
  echo "使い方: $0 <html-file>" >&2
  exit 2
fi
if [ ! -f "$F" ]; then
  echo "ファイルが見つからない: $F" >&2
  exit 2
fi
if [ ! -r "$F" ]; then
  echo "ファイルが読めない: $F" >&2
  exit 2
fi

NG=0
CHECKED=0

# 違反を記録する。$1 = 検査名, $2 = 何が問題か, $3 = どう直すか
fail() {
  NG=$((NG + 1))
  {
    echo "NG [$1] $2"
    echo "     修正: $3"
  } >&2
}

pass() { CHECKED=$((CHECKED + 1)); }

# パターンの出現「個数」を数える。行数ではない。
cnt() {
  grep -o -i -E "$1" "$F" 2>/dev/null | wc -l | tr -d ' '
}

# 大文字小文字を区別して数える。差し込みスロットの検出には必ずこちらを使う。
# cnt() は -i を付けるため、FILL: が CSS の fill: に誤マッチしてしまう。
cnt_cs() {
  grep -o -E "$1" "$F" 2>/dev/null | wc -l | tr -d ' '
}

# ------------------------------------------------------------
# 1. 外部リソースの読み込みと script の混入がないこと
# ------------------------------------------------------------
n=$(cnt '<script')
if [ "$n" -ne 0 ]; then
  fail "script なし" "script 要素が ${n} 個ある（自己完結 HTML には含められない）" \
       "script 要素をすべて削除する。図は手書きのインライン SVG で描き、mermaid を使わない。コード例として本文に載せたい場合は削除せず &lt;script&gt; のようにエスケープする。"
else pass; fi

# script / iframe と同じくタグ名のプレフィックスだけで数える。直後の1文字を
# 空白や '>' に限定すると、grep は行単位なのでタグが複数行に折り返された
# <link\n  rel="stylesheet" href="https://..."> を取りこぼす。
n=$(cnt '<link')
if [ "$n" -ne 0 ]; then
  fail "link なし" "link 要素が ${n} 個ある（外部 CSS / フォントの読み込み）" \
       "link 要素を削除し、必要なスタイルは head 内の style 要素に直接書く。コード例として載せたい場合はエスケープする。"
else pass; fi

n=$(cnt '<iframe')
if [ "$n" -ne 0 ]; then
  fail "iframe なし" "iframe 要素が ${n} 個ある" \
       "iframe を削除する。埋め込みたい内容は本文かインライン SVG で表現する。コード例として載せたい場合はエスケープする。"
else pass; fi

n=$(cnt '@import')
if [ "$n" -ne 0 ]; then
  fail "CSS import なし" "CSS の import 規則が ${n} 個ある（外部スタイルシートの読み込み）" \
       "import 規則を削除し、スタイルを style 要素に直接書く。"
else pass; fi

n=$(cnt 'url\(["'"'"'[:space:]]*https?:')
if [ "$n" -ne 0 ]; then
  fail "CSS の外部 URL なし" "CSS の url() が外部 URL を ${n} 個参照している" \
       "外部 URL を削除する。画像が必要なら data URI にする。SVG マーカーの url(#arrow) のような同一文書内参照は問題ない。"
else pass; fi

# 読み込みを伴う要素のみ検査する。a 要素の href は何も読み込まないので対象外
# （ヘッダーは意図的に PR の URL にリンクしており、これを違反にすると毎回必ず失敗する）。
# タグと URL を別々に数える。1 つのパターンでタグ名から属性までを繋げて照合すると、
# grep は行単位なので <img\n  src="https://..."> のような折り返しを取りこぼす（<link と同じ罠）。
# ここでは (a) 読み込み系タグの存在 と (b) src/href/data に付いた外部 URL を独立に検査する。
# タグ・属性名・URL が別々の行に折り返されても取り逃がさないよう、
# check_figure と同じく改行を潰してから数える（grep は行単位でしか照合しない）。
flat=$(tr '\n' ' ' < "$F" 2>/dev/null)
# タグの存在自体は違反にしない。data URI の <img> / <image> は自己完結しており
# テンプレートも明示的に許可しているため、タグ名だけで落とすと「data URI に置き換える」
# という修正指示に従っても永久にパスできない状態になる。
# そこで src/href/data が外部 URL を指しているタグだけを数える。
ntag=$(echo "$flat" | grep -o -i -E '<(img|image|video|audio|source|embed|object)[[:space:]][^>]*(src|href|data)[[:space:]]*=[[:space:]]*["'"'"']?https?://' | wc -l | tr -d ' ')
nurl=$(echo "$flat" | grep -o -i -E '(src|href|data)[[:space:]]*=[[:space:]]*["'"'"']?https?://' | wc -l | tr -d ' ')
# a 要素の数え方も行に依存させない。`<a ... href=` を 1 つの正規表現でまたぐと、
# タグが折り返された途端に 0 になり、意図的に許可している PR リンクだけで
# 誤検出が起きる（img / link と同じ罠）。タグ間の改行を潰してから数える。
nlink=$(echo "$flat" | grep -o -i -E '<a[[:space:]][^>]*href[[:space:]]*=[[:space:]]*["'"'"']?https?://' | wc -l | tr -d ' ')
# a 要素の href は何も読み込まないので外部 URL の総数から除外する
# （ヘッダーは意図的に PR の URL にリンクしており、これを違反にすると毎回必ず失敗する）。
nurl_load=$((nurl - nlink))
[ "$nurl_load" -lt 0 ] && nurl_load=0
if [ "$ntag" -ne 0 ] || [ "$nurl_load" -ne 0 ]; then
  fail "外部リソースなし" "外部 URL を読み込む要素 ${ntag} 個 / a 要素以外の外部 URL 参照 ${nurl_load} 個（img / video / source / object など）" \
       "画像は data URI に置き換えるか、インライン SVG で描き直す。動画・音声は載せない。a 要素の href でのリンクは読み込みではないので問題ない。"
else pass; fi

# ------------------------------------------------------------
# 2. 未置換の差し込みスロットが残っていないこと
# ------------------------------------------------------------
# 崩れたスロット（{{FILL: SVG_MAP}} / 括弧の欠けなど）も取り逃がさないよう、
# 素の FILL: を数える。整った形だけを見ると崩れたものが黙って出荷される。
n=$(cnt_cs 'FILL:')
if [ "$n" -ne 0 ]; then
  left=$(grep -o -E '.{0,2}FILL:[^ }<"]{0,40}' "$F" 2>/dev/null | sort -u | tr '\n' ' ')
  fail "スロット全埋め" "未置換の差し込みスロットが ${n} 個残っている: ${left}" \
       "残ったスロットを実際の内容に置き換える。使わない任意の figure は figure 要素ごと削除する（中のスロットも一緒に消える）。"
else pass; fi

# ------------------------------------------------------------
# 3. 空の figure が残っていないこと
# ------------------------------------------------------------
nfig=$(cnt '<figure')
# figure の外にあるマーカー定義用 svg（骨格に常に1個ある）を除外する。
# ファイル全体の <svg> を数えると常に1個多く見え、未知の id を持つ空 figure が
# 1 個だけ紛れ込んだときに帳尻が合って検出をすり抜ける。
nsvg=$(awk '/<figure/,/<\/figure>/' "$F" 2>/dev/null | grep -o -i -E '<svg' | wc -l | tr -d ' ')
if [ "$nfig" -gt "$nsvg" ]; then
  fail "空 figure なし" "figure 要素 ${nfig} 個に対し svg 要素が ${nsvg} 個しかない" \
       "図を入れない figure は figure 要素ごと削除する。空の枠を残してはならない。"
else pass; fi

# ------------------------------------------------------------
# 4. セクションの id と順序が骨格どおりであること
# ------------------------------------------------------------
# セクションは 6 つすべて必須（順序固定）。落とせるのは任意の図だけで、
# セクション本体は落とさない — SKILL.md / diagrams.md / template.html の指示と一致させる。
REQUIRED_SECS="sec-summary sec-why sec-map sec-impact sec-path sec-skip"
ALL_SECS="sec-summary sec-why sec-map sec-impact sec-path sec-skip"

actual=$(grep -o -E 'id="sec-[a-z-]+"' "$F" 2>/dev/null \
         | sed 's/id="//; s/"//' | tr '\n' ' ' | sed 's/ $//')

expected=""
for s in $ALL_SECS; do
  for a in $actual; do
    if [ "$s" = "$a" ]; then
      expected="${expected}${s} "
      break
    fi
  done
done
expected=$(echo "$expected" | sed 's/ $//')

missing=""
for s in $REQUIRED_SECS; do
  found=0
  for a in $actual; do
    if [ "$s" = "$a" ]; then found=1; break; fi
  done
  if [ "$found" -eq 0 ]; then missing="${missing}${s} "; fi
done

if [ -n "$missing" ]; then
  fail "必須セクション" "必須セクションが無い: ${missing}" \
       "テンプレートの骨格どおりに section 要素を復元する。sec-summary / sec-why / sec-map / sec-impact / sec-path / sec-skip の 6 つすべてが必須（落とせるのは任意の図だけ）。"
elif [ "$actual" != "$expected" ]; then
  fail "セクション順序" "セクションの並びが規定と違う（実際: ${actual} / 期待: ${expected}）" \
       "section 要素を sec-summary → sec-why → sec-map → sec-impact → sec-path → sec-skip の順に戻す。重複や規定外の sec-* id も無くす。"
else pass; fi

# ------------------------------------------------------------
# 5. 図が実際に描かれていること（「文章の壁」への退化を検出する）
# ------------------------------------------------------------
# figure の範囲を抜き出し、svg 要素が 1 つあり viewBox を持つことを確認する。
# viewBox が無いと CSS の width:100% が効かず図が潰れる。
check_figure() {
  local fid required label range opentags nsvg_fig hits
  fid="$1"      # figure の id
  required="$2" # yes = 必須図

  if [ "$required" = "yes" ]; then
    label="必須図 ${fid}"
  else
    label="任意図 ${fid}"
  fi

  hits=$(grep -o -E "id=\"${fid}\"" "$F" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$hits" -eq 0 ]; then
    if [ "$required" = "yes" ]; then
      fail "必須図 ${fid}" "必須の図 ${fid} が無い" \
           "このガイドの価値の中心は大きな図であって文章ではない。${fid} の figure 要素を復元し、viewBox 付きのインライン SVG を描く。"
    else
      pass
    fi
    return
  fi

  range=$(awk "/id=\"${fid}\"/,/<\/figure>/" "$F" 2>/dev/null)
  # svg の開始タグは複数行にまたがることがあるので改行を潰してから見る
  opentags=$(echo "$range" | tr '\n' ' ' | grep -o -E '<svg[^>]*>' 2>/dev/null)
  nsvg_fig=$(echo "$opentags" | grep -c -E '<svg' 2>/dev/null | tr -d ' ')
  if [ -z "$opentags" ]; then nsvg_fig=0; fi

  if [ "$nsvg_fig" -eq 0 ]; then
    if [ "$required" = "yes" ]; then
      fail "$label" "${fid} に svg 要素が無い（図のかわりに文章だけになっている）" \
           "このガイドの価値の中心は大きな図であって文章ではない。${fid} に viewBox 付きのインライン SVG を描く。図を描けないなら題材の切り方を見直す。"
    else
      fail "$label" "${fid} の figure が空になっている" \
           "任意の図は使わないなら figure 要素ごと削除する（空の枠を残さない）。描くなら viewBox 付きのインライン SVG を入れる。"
    fi
    return
  fi
  if [ "$nsvg_fig" -ne 1 ]; then
    fail "$label" "${fid} の中に svg 要素が ${nsvg_fig} 個ある（1 つだけにする）" \
         "1 つの figure には 1 つの図・1 つのメッセージ。複数あるなら figure を分けるか統合する。"
    return
  fi
  if ! echo "$opentags" | grep -o -E 'viewBox' >/dev/null 2>&1; then
    fail "$label" "${fid} の svg に viewBox が無い" \
         "svg に viewBox=\"0 0 1000 H\" を付ける。width / height 属性は付けない。viewBox が無いと CSS の width:100% が効かず図が全幅表示されない。"
    return
  fi
  # viewBox があっても width / height 属性が残っていると全幅表示にならない。
  # 「viewBox を付ける」と「width/height を付けない」は全幅保証の両輪なので両方を検証する。
  if echo "$opentags" | grep -o -E '(^|[[:space:]])(width|height)=' >/dev/null 2>&1; then
    fail "$label" "${fid} の svg に width / height 属性が付いている" \
         "svg の width / height 属性を削除し、大きさは viewBox だけで決める。属性が残っていると CSS の width:100%; height:auto が上書きされ、図が全幅表示されない。"
    return
  fi
  pass
}

# 必須図
check_figure "fig-summary" yes
check_figure "fig-map"     yes
check_figure "fig-path"    yes
# 任意図（無くてもよいが、あるなら同じ条件を満たすこと）
check_figure "fig-why"     no
check_figure "fig-impact"  no

# ------------------------------------------------------------
# 6. head SHA が載っていること（鮮度を判断する唯一の手段）
# ------------------------------------------------------------
# 短縮 SHA は複数コミットに曖昧になりうるため 40 桁のフル SHA だけを合格とする
# （SKILL.md の「head SHA は 40 桁のまま載せる」契約と一致させる）。
# 骨格には class="sha" のスロットがヘッダーとフッターの 2 箇所ある。
# 「1 箇所でもあれば合格」にすると、片方だけ短縮 SHA や別コミットの値になって
# いるケース（未置換ではないので FILL: チェックにも掛からない）が素通りする。
# そのためスロット総数と 40 桁 SHA の数が一致することを要求する。
nslot=$(grep -o -E 'class="sha">' "$F" 2>/dev/null | wc -l | tr -d ' ')
n=$(grep -o -E 'class="sha">[0-9a-fA-F]{40}<' "$F" 2>/dev/null | wc -l | tr -d ' ')
if [ "$n" -lt 1 ] || [ "$n" -ne "$nslot" ]; then
  fail "head SHA" "class=\"sha\" のスロット ${nslot} 箇所のうち 40 桁の head SHA が入っているのは ${n} 箇所" \
       "ヘッダーとフッターの class=\"sha\" のスロットに PR の head SHA を 40 桁のまま入れる（短縮しない。短縮 SHA は複数コミットに曖昧になりうる）。レビュアーがこのガイドの鮮度を判断する唯一の手段。"
else pass; fi

# ------------------------------------------------------------
# 7. ファイルサイズ（ライブラリ混入の検出）
# ------------------------------------------------------------
bytes=$(wc -c < "$F" | tr -d ' ')
if [ "$bytes" -ge 2000000 ]; then
  fail "サイズ" "ファイルが ${bytes} バイト（2,000,000 バイト以上）" \
       "ライブラリや巨大な data URI が混入していないか確認する。図は手書きのインライン SVG に留める。"
else pass; fi

# ------------------------------------------------------------
# 8. 矢印の端点が箱に接していること（宙に浮いた矢印の検出）
# ------------------------------------------------------------
# ブリーフの SVG 例から箱だけを差し替え、矢印の d="M ..." を写したまま
# 残すと、矢印が何も指していない図ができる。構造の検証（viewBox・svg の
# 個数）は通ってしまううえ、読み手には「存在しない関係」が見えるので、
# 図が無いより悪い。ここで機械的に捕まえる。
#
# 判定: class に edge を含む path / line の始点と終点が、いずれかの箱
#   (band を除く rect / circle / ellipse) の輪郭または内側から
#   ${EDGE_TOL} ユーザー単位以内にあること。
#   marker-end:none の線（シーケンス図のライフライン・区切り線）は矢印で
#   はないので端点を検査せず、逆に「接続先」として扱う。
#
# 許容値の根拠（1000 幅の座標系で実測）: 正しい図の端点は箱から最大 6
#   単位。ブリーフの例を写して壊れた実例は 20.4 単位。15 は正常値の
#   2.5 倍あり、誤検出を出さずに壊れた矢印を捕まえられる。誤検出は
#   「正しい矢印を消させる」ので見逃しより有害。安易に緩めないこと。
EDGE_TOL=15

if ! command -v python3 >/dev/null 2>&1; then
  echo "注意: python3 が無いため矢印の接続検証をスキップした（図の矢印が箱に接しているかは目視で確認する）" >&2
else
  edge_out=$(python3 - "$F" "$EDGE_TOL" 2>/dev/null <<'PYEDGE'
import math, re, sys

NUM = r'-?\d+(?:\.\d+)?'


def attr(tag, name):
    m = re.search(r'\b' + name + r'\s*=\s*"([^"]*)"', tag)
    return m.group(1) if m else None


def fnum(tag, name):
    try:
        return float(attr(tag, name))
    except (TypeError, ValueError):
        return None


def parse_d(d):
    """d 属性を M/L/H/V（相対含む）だけ辿って通過点を返す。
    曲線コマンドを含むものは None（見逃す方に倒す＝誤検出を出さない）。"""
    if re.search(r'[^MmLlHhVvZz0-9.,\s+-]', d):
        return None
    toks = re.findall(r'[MmLlHhVvZz]|' + NUM, d)
    pts = []
    cx = cy = 0.0
    cmd = None
    i = 0
    while i < len(toks):
        t = toks[i]
        if re.match(r'^[A-Za-z]$', t):
            cmd = None if t in 'Zz' else t
            i += 1
            continue
        if cmd is None:
            return None
        try:
            if cmd in 'ML':
                cx, cy = float(toks[i]), float(toks[i + 1])
                i += 2
            elif cmd in 'ml':
                cx, cy = cx + float(toks[i]), cy + float(toks[i + 1])
                i += 2
            elif cmd == 'H':
                cx = float(toks[i]); i += 1
            elif cmd == 'h':
                cx += float(toks[i]); i += 1
            elif cmd == 'V':
                cy = float(toks[i]); i += 1
            elif cmd == 'v':
                cy += float(toks[i]); i += 1
            else:
                return None
        except (IndexError, ValueError):
            return None
        pts.append((cx, cy))
    return pts if len(pts) >= 2 else None


def dist_box(px, py, x, y, w, h):
    # 箱の「輪郭」までの距離を返す。内部に潜り込んだ点を距離 0 とみなすと、
    # 箱を広げたあとに古い端点が塗りの中に埋もれた矢印（先端が見えない＝
    # 何も指していないのと同じ壊れ方）を検出できないため、内部では最も近い
    # 辺までの距離を返す。辺の上・辺のすぐ外側は従来どおり 0 に近い値になる。
    if x <= px <= x + w and y <= py <= y + h:
        return min(px - x, (x + w) - px, py - y, (y + h) - py)
    dx = max(x - px, 0.0, px - (x + w))
    dy = max(y - py, 0.0, py - (y + h))
    return math.hypot(dx, dy)


def dist_seg(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    L = vx * vx + vy * vy
    if L == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * vx + (py - ay) * vy) / L))
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))


def is_edge(tag):
    return any('edge' in c for c in (attr(tag, 'class') or '').split())


src = open(sys.argv[1], encoding='utf-8', errors='replace').read()
tol = float(sys.argv[2])

for sm in re.finditer(r'<svg\b[^>]*>.*?</svg>', src, re.S):
    svg = sm.group(0)
    figid = None
    for fm in re.finditer(r'<figure[^>]*\bid="([^"]+)"', src[:sm.start()]):
        figid = fm.group(1)
    if figid is None:
        figid = attr(svg, 'aria-label') or '(id 不明)'

    boxes = []
    for m in re.finditer(r'<(?:rect|circle|ellipse)\b[^>]*>', svg):
        tag = m.group(0)
        if 'band' in (attr(tag, 'class') or '').split():
            continue      # band は図全体を覆うので接続先にならない
        if tag.startswith('<rect'):
            x, y, w, h = (fnum(tag, 'x'), fnum(tag, 'y'),
                          fnum(tag, 'width'), fnum(tag, 'height'))
            if None not in (x, y, w, h):
                boxes.append((x, y, w, h))
        else:
            cx, cy = fnum(tag, 'cx'), fnum(tag, 'cy')
            r = fnum(tag, 'r')
            rx = r if r is not None else fnum(tag, 'rx')
            ry = r if r is not None else fnum(tag, 'ry')
            if None not in (cx, cy, rx, ry):
                boxes.append((cx - rx, cy - ry, 2 * rx, 2 * ry))

    lifelines = []
    arrows = []
    for m in re.finditer(r'<(?:path|line)\b[^>]*>', svg):
        tag = m.group(0)
        if not is_edge(tag):
            continue
        if tag.startswith('<line'):
            x1, y1, x2, y2 = (fnum(tag, 'x1'), fnum(tag, 'y1'),
                              fnum(tag, 'x2'), fnum(tag, 'y2'))
            if None in (x1, y1, x2, y2):
                continue
            pts = [(x1, y1), (x2, y2)]
            label = 'x1=%g y1=%g x2=%g y2=%g' % (x1, y1, x2, y2)
        else:
            d = attr(tag, 'd')
            pts = parse_d(d) if d else None
            if pts is None:
                continue
            label = d
        if re.search(r'marker-end\s*:\s*none', attr(tag, 'style') or ''):
            lifelines.append(pts)   # ライフライン・区切り線: 矢印ではなく接続先
        else:
            arrows.append((label, pts))

    if not arrows or (not boxes and not lifelines):
        continue      # 検査対象なし（箱のない図など）は黙って飛ばす

    for label, pts in arrows:
        for which, (px, py) in (('始点', pts[0]), ('終点', pts[-1])):
            best = None
            for b in boxes:
                dd = dist_box(px, py, *b)
                if best is None or dd < best:
                    best = dd
            for poly in lifelines:
                for i in range(len(poly) - 1):
                    dd = dist_seg(px, py, poly[i][0], poly[i][1],
                                  poly[i + 1][0], poly[i + 1][1])
                    if best is None or dd < best:
                        best = dd
            if best is not None and best > tol:
                print('%s\t%s\t%s\t%g\t%g\t%.1f'
                      % (figid, label, which, px, py, best))
PYEDGE
)
  edge_rc=$?
  if [ "$edge_rc" -ne 0 ]; then
    echo "注意: 矢印の接続検証を実行できなかったためスキップした（python3 が異常終了）" >&2
  else
    if [ -n "$edge_out" ]; then
      while IFS="$(printf '\t')" read -r e_fig e_d e_which e_x e_y e_dist; do
        [ -z "$e_fig" ] && continue
        fail "矢印の接続 ${e_fig}" \
             "${e_fig} の矢印の${e_which}が箱の輪郭から ${e_dist} 単位ずれていて、どの箱の辺にも接していない（空白を指している、または箱の塗りに埋もれている）（${e_x}, ${e_y}）: d=\"${e_d}\"" \
             "この矢印は何も指していない。references/diagrams.md の「座標は流用できない」節のとおり、接続先の箱の x/y/width/height から端点を計算し直す（右辺中点 = (x+w, y+h/2) / 左辺中点 = (x, y+h/2) / 上辺中点 = (x+w/2, y) / 下辺中点 = (x+w/2, y+h)）。例の d= を写したまま箱を動かすと必ずこうなる。"
      done <<EOF
$edge_out
EOF
    else
      pass
    fi
  fi
fi

# ------------------------------------------------------------
# 結果
# ------------------------------------------------------------
if [ "$NG" -eq 0 ]; then
  echo "OK: 全 ${CHECKED} 項目に問題なし（${bytes} バイト / figure ${nfig} 個）"
  exit 0
fi

echo "" >&2
echo "FAIL: ${NG} 件の違反（OK ${CHECKED} 項目）。上記の修正を行って再検証すること。" >&2
exit 1
