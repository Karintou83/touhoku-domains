#!/usr/bin/env python3
"""data/*.json の整合性チェック。 python scripts/validate.py

build_data.py が「Wikidata の欠落・食い違い」を warnings.json に書くのに対し、
こちらは「生成した JSON 自体がサイトで安全に使えるか」を確かめる(参照切れ・循環・範囲外など)。
  error  → 終了コード 1(サイトに載せてはいけない)
  warn   → 表示のみ(データ側の確認事項。画面上の警告アイコンの元になる)
"""
import json
import sys
from collections import Counter, defaultdict

from wdlib import DATA, ROOT

CONFIG = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
Y0, Y1 = CONFIG["year_range"]
BB = CONFIG["japan_bbox"]


def load(n):
    return json.loads((DATA / n).read_text(encoding="utf-8"))


def main():
    domains, lords = load("domains.json"), load("lords.json")
    tenures, rels, warns = load("tenures.json"), load("relations.json"), load("warnings.json")
    D = {d["id"]: d for d in domains}
    L = {l["id"]: l for l in lords}
    errors, notes = [], []

    # 1. ID の重複・参照切れ(Cytoscape や Leaflet に渡すと実行時エラーになるため、ここで止める)
    for name, items in (("domains", domains), ("lords", lords), ("tenures", tenures), ("relations", rels)):
        dup = [k for k, v in Counter(i["id"] for i in items).items() if v > 1]
        if dup:
            errors.append(f"{name}: ID重複 {dup[:5]}")
    for t in tenures:
        if t["lord"] not in L:
            errors.append(f"tenure {t['id']}: 藩主 {t['lord']} が lords.json にありません")
        if t["domain"] not in D:
            errors.append(f"tenure {t['id']}: 藩 {t['domain']} が domains.json にありません")
        if t["start"] and t["end"] and t["start"] > t["end"]:
            errors.append(f"tenure {t['id']}: 開始年 > 終了年")
        for y in (t["start"], t["end"]):
            if y and not Y0 <= y <= Y1:
                notes.append(f"tenure {t['id']}: 年 {y} が想定範囲 {Y0}–{Y1} の外です")
    for e in rels:
        for k in ("source", "target"):
            if e[k] not in L:
                errors.append(f"relation {e['id']}: {k} {e[k]} が lords.json にありません")

    # 2. 家系の循環(階層レイアウト dagre は有向非循環グラフ DAG を前提とするため)
    graph = defaultdict(list)
    for e in rels:
        if e["type"] != "adoption_unknown":
            graph[e["source"]].append(e["target"])
    state = {}

    def dfs(u, path):
        state[u] = 1
        for v in graph.get(u, []):
            if state.get(v) == 1:
                errors.append("家系に循環: " + " → ".join(L[x]["name"] for x in path[path.index(v):] + [v] if x in L)
                              if v in path else f"家系に循環: {u} → {v}")
            elif v not in state:
                dfs(v, path + [v])
        state[u] = 2
    for n in list(graph):
        if n not in state:
            dfs(n, [n])

    # 2b. 実父は1人のはず(母を「実父」として拾っていないかの検査。build_data.py が女性を除いている)
    nfather = Counter(e["target"] for e in rels if e["type"] == "blood")
    multi = [L[c]["name"] for c, n in nfather.items() if n > 1 and c in L]
    for n in multi[:10]:
        notes.append(f"{n}: 実父(blood の辺)が複数あります")

    # 3. 座標の範囲(緯度経度の入れ替え・桁の誤りを検出)
    for d in domains:
        c = d.get("coord")
        if c and not (BB["lat"][0] <= c["lat"] <= BB["lat"][1] and BB["lon"][0] <= c["lon"] <= BB["lon"][1]):
            errors.append(f"domain {d['name']}: 座標 ({c['lat']}, {c['lon']}) が日本の範囲外です")

    # 4. 同一藩の在任の重なり・空白・代数の重複(別人の在任が複数年にわたって重なる場合のみ。交代年の重なりは許容)
    by_dom = defaultdict(list)
    for t in tenures:
        if t["start"]:
            by_dom[t["domain"]].append(t)
    overlap = gaps = dup_ord = 0
    for d, ts in by_dom.items():
        ts.sort(key=lambda t: (t["start"], t["end"] or 9999))
        for a, b in zip(ts, ts[1:]):
            if a["lord"] != b["lord"] and a["end"] and b["start"] < a["end"]:
                overlap += 1
                notes.append(f"{D[d]['name']}: {L[a['lord']]['name']}({a['start']}–{a['end']}) と "
                             f"{L[b['lord']]['name']}({b['start']}–{b['end']}) が重なっています")
            elif a["end"] and b["start"] > a["end"] + 1:
                gaps += 1
                notes.append(f"{D[d]['name']}: {a['end']}–{b['start']} 年に在任者の空白があります")
        ords = Counter((t["ord"]) for t in ts if t["ord"])
        for o, n in ords.items():
            if n > 1 and len({t["lord"] for t in ts if t["ord"] == o}) > 1:
                dup_ord += 1
                notes.append(f"{D[d]['name']}: {o}代が複数の人物に付いています")

    # 5. 表示まわり
    miss_coord = [d["name"] for d in domains if d["scope"] == "tohoku" and not d.get("coord")]
    approx = [d["name"] for d in domains if (d.get("coord") or {}).get("precision") == "approx"]
    tl = [l for l in lords if l["scope"] == "tohoku"]
    no_wp = [l["name"] for l in tl if "no_wikipedia" in l["flags"]]

    print(f"domains={len(domains)} lords={len(lords)}(東北 {len(tl)} / 外部 {len(lords) - len(tl)}) "
          f"tenures={len(tenures)} relations={len(rels)}")
    print("氏の出所(東北の藩主):", dict(Counter(l["clan_source"] or "none" for l in tl)))
    print(f"座標なし(東北の藩): {len(miss_coord)}  概略位置: {len(approx)}")
    print(f"実父が複数ある人物: {len(multi)}")
    print(f"在任の重なり: {overlap} / 空白: {gaps} / 代数の重複: {dup_ord}")
    print("警告の内訳:", dict(Counter(f"{w['level']}/{w['kind']}" for w in warns)))
    if no_wp:
        print(f"日本語版Wikipedia記事なし(東北の藩主): {len(no_wp)}人")
    for n in notes[:30]:
        print("  [注意]", n)
    if len(notes) > 30:
        print(f"  …ほか {len(notes) - 30} 件")
    for e in errors:
        print("  [ERROR]", e)
    print("結果:", "NG" if errors else "OK(errorなし)")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
