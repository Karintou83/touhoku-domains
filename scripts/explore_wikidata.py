#!/usr/bin/env python3
"""Step 1: Wikidata の現状調査 (exploration) スクリプト。

目的: 「私の記憶ベースのモデル」が実データと合っているかを確認し、欠落を数える。
  - 標準ライブラリ(urllib)だけで動かす → 依存ゼロで、誰の環境でも再実行できる。
  - 1クエリ=1リクエスト、間に sleep → Wikidata Query Service (WDQS) への負荷を抑える。
  - 生の結果を data/raw/*.json に保存 → 後の build_data.py は、この形を踏まえて設計する。
  - User-Agent には GitHub の URL を入れる(個人メールは公開リポジトリに残さない)。

使い方:  python scripts/explore_wikidata.py
"""
import json, time, urllib.parse, urllib.request
from collections import Counter, defaultdict
from pathlib import Path

ENDPOINT = "https://query.wikidata.org/sparql"
UA = "touhoku-domains/0.1 (https://github.com/Karintou83/touhoku-domains; Wikidata editor tool)"
RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
RAW.mkdir(parents=True, exist_ok=True)

# 東北6県+北海道(松前藩)。QIDを記憶で書くと誤りやすいので、P131(所在地)のラベルで判定する。
REGION_LABELS = {"青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "北海道"}


def sparql(query: str, name: str) -> list[dict]:
    url = ENDPOINT + "?" + urllib.parse.urlencode({"query": query, "format": "json"})
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/sparql-results+json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        rows = json.load(r)["results"]["bindings"]
    flat = [{k: v["value"] for k, v in row.items()} for row in rows]
    (RAW / f"{name}.json").write_text(json.dumps(flat, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[{name}] {len(flat)} rows")
    time.sleep(3)
    return flat


def qid(uri: str | None) -> str | None:
    return uri.rsplit("/", 1)[-1] if uri else None


# --- Q1: 藩主役職項目 (P31=Q114962596) とその藩 (P2389) -------------------------
# OPTIONAL を使う理由: 「P2389が無い役職」「藩側にP2388が無い」という欠落そのものを検出したいから。
Q_POSITIONS = """
SELECT ?pos ?posLabel ?p279 ?domain ?domainLabel ?back ?coord
       (GROUP_CONCAT(DISTINCT ?locLabel; separator="|") AS ?locs) WHERE {
  ?pos wdt:P31 wd:Q114962596 .
  OPTIONAL { ?pos wdt:P279 ?p279 }
  OPTIONAL { ?pos wdt:P2389 ?domain .
             OPTIONAL { ?domain wdt:P2388 ?back }
             OPTIONAL { ?domain wdt:P625 ?coord }
             OPTIONAL { ?domain wdt:P131* ?loc . ?loc rdfs:label ?locLabel FILTER(LANG(?locLabel)="ja") } }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". }
} GROUP BY ?pos ?posLabel ?p279 ?domain ?domainLabel ?back ?coord
"""

# --- Q2: 藩の座標フォールバック用: 藩が持つ「城・陣屋」候補 -------------------------
# どのプロパティで城を指しているか未確認なので、藩から出る全プロパティのうち
# 値が座標(P625)を持つ項目を拾い、プロパティIDごとに集計する(=実データでどれが使われているか確認)。
Q_DOMAIN_SEATS = """
SELECT ?domain ?prop ?seat ?seatLabel ?coord WHERE {
  ?pos wdt:P31 wd:Q114962596 ; wdt:P2389 ?domain .
  ?domain ?p ?seat .
  ?seat wdt:P625 ?coord .
  FILTER(STRSTARTS(STR(?p), "http://www.wikidata.org/prop/direct/"))
  BIND(REPLACE(STR(?p), "^.*/", "") AS ?prop)
  FILTER(?seat != ?domain)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". }
}
"""

# --- Q3: P39 側の在任 (藩主個人) -----------------------------------------------
# statement ノード (p:P39 / ps:P39 / pq:*) を使う理由: 修飾子(開始・終了年, 前任/後任)は
# 声明(statement)に付いているので、wdt: の簡易形では取れない。
Q_P39 = """
SELECT ?person ?personLabel ?pos ?start ?end ?prev ?next ?clan ?clanLabel WHERE {
  ?pos wdt:P31 wd:Q114962596 .
  ?person p:P39 ?st . ?st ps:P39 ?pos .
  OPTIONAL { ?st pq:P580 ?start }  OPTIONAL { ?st pq:P582 ?end }
  OPTIONAL { ?st pq:P1365 ?prev }  OPTIONAL { ?st pq:P1366 ?next }
  OPTIONAL { ?person wdt:P53 ?clan }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". }
}
"""

# --- Q4: 役職側 (P1308) の在任。P39側と突き合わせて食い違いを調べる ----------------
Q_P1308 = """
SELECT ?pos ?person ?ord ?start ?end WHERE {
  ?pos wdt:P31 wd:Q114962596 .
  ?pos p:P1308 ?st . ?st ps:P1308 ?person .
  OPTIONAL { ?st pq:P1545 ?ord }
  OPTIONAL { ?st pq:P580 ?start }  OPTIONAL { ?st pq:P582 ?end }
}
"""

# --- Q5: 家系 (実父P22・子P40・養子関係P1038+P1039) ------------------------------
# 藩主本人 + その実父/子まで1段(東北外の実父を拾うため、親側は藩主でなくても取る)。
Q_FAMILY = """
SELECT ?person ?kind ?other ?otherLabel ?rel ?relLabel WHERE {
  { SELECT DISTINCT ?person WHERE { ?pos wdt:P31 wd:Q114962596 . ?person wdt:P39 ?pos } }
  { ?person wdt:P22 ?other BIND("P22" AS ?kind) }
  UNION { ?person wdt:P40 ?other BIND("P40" AS ?kind) }
  UNION { ?person p:P1038 ?st . ?st ps:P1038 ?other . OPTIONAL { ?st pq:P1039 ?rel } BIND("P1038" AS ?kind) }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". }
}
"""

# --- Q6: 親族側が藩主(任意の P39 が Q114962596 系)かどうか = 「東北外の実父」判定の材料 ----
Q_OTHER_POS = """
SELECT DISTINCT ?other ?pos ?domain WHERE {
  { SELECT DISTINCT ?other WHERE {
      ?pos0 wdt:P31 wd:Q114962596 . ?person wdt:P39 ?pos0 . ?person wdt:P22|wdt:P40 ?other } }
  ?other wdt:P39 ?pos . ?pos wdt:P31 wd:Q114962596 .
  OPTIONAL { ?pos wdt:P2389 ?domain }
}
"""


def main() -> None:
    pos = sparql(Q_POSITIONS, "positions")
    seats = sparql(Q_DOMAIN_SEATS, "domain_seats")
    p39 = sparql(Q_P39, "p39")
    p1308 = sparql(Q_P1308, "p1308")
    fam = sparql(Q_FAMILY, "family")
    oth = sparql(Q_OTHER_POS, "other_positions")

    # ---- 東北フィルタ: 藩の所在地チェーンのラベルで判定 ----
    tohoku_pos = {}
    for r in pos:
        locs = set(r.get("locs", "").split("|"))
        if locs & REGION_LABELS:
            tohoku_pos[qid(r["pos"])] = r
    print("\n=== 概要 ===")
    print("藩主役職項目(全体):", len({qid(r['pos']) for r in pos}), "/ 東北+北海道と判定:", len(tohoku_pos))
    print("P279=Q24887524 でない役職:", sorted(qid(r["pos"]) for r in tohoku_pos.values()
          if qid(r.get("p279")) != "Q24887524"))
    print("P2389(藩)が無い役職:", sorted(k for k, r in tohoku_pos.items() if not r.get("domain")))
    print("藩側にP2388が無い/別役職を指す:", sorted(
        (k, qid(r["domain"])) for k, r in tohoku_pos.items()
        if r.get("domain") and qid(r.get("back")) != k))

    # ---- 座標の有無 (藩P625 → 無ければ城候補) ----
    seat_by_domain = defaultdict(list)
    for r in seats:
        seat_by_domain[qid(r["domain"])].append((r["prop"], r.get("seatLabel")))
    no_coord = []
    for k, r in tohoku_pos.items():
        d = qid(r.get("domain"))
        if d and not r.get("coord"):
            no_coord.append((r.get("domainLabel"), d, seat_by_domain.get(d, [])))
    print("\n藩P625なし:", len(no_coord), "件(うち城候補すら無いもの:",
          sum(1 for x in no_coord if not x[2]), ")")
    for lab, d, cands in sorted(no_coord):
        print("  -", lab, d, "候補:", cands[:3])
    print("藩から城を指すプロパティの使用頻度:", Counter(p for v in seat_by_domain.values() for p, _ in v).most_common(8))

    # ---- 藩主個人 ----
    tpos = set(tohoku_pos)
    t39 = [r for r in p39 if qid(r["pos"]) in tpos]
    persons = {qid(r["person"]) for r in t39}
    print("\n藩主個人(P39,東北):", len(persons), "人 / 在任声明:", len(t39))
    print("開始年なし:", sum(1 for r in t39 if not r.get("start")), "/ 終了年なし:", sum(1 for r in t39 if not r.get("end")))
    print("P53(氏)なし:", len({qid(r['person']) for r in t39 if not r.get("clan")}), "人")
    # 日付精度の確認用に生値を数件
    print("日付の生値サンプル:", [r.get("start") for r in t39 if r.get("start")][:3])

    # ---- P39 と P1308 の食い違い ----
    a = {(qid(r["pos"]), qid(r["person"])) for r in t39}
    b = {(qid(r["pos"]), qid(r["person"])) for r in p1308 if qid(r["pos"]) in tpos}
    print("\nP39のみ:", len(a - b), "/ P1308のみ:", len(b - a), "/ 一致:", len(a & b))
    for x in sorted(a - b)[:10]: print("  P39のみ", x)
    for x in sorted(b - a)[:10]: print("  P1308のみ", x)

    # ---- 家系 ----
    fam_t = [r for r in fam if qid(r["person"]) in persons]
    p22 = {(qid(r["person"]), qid(r["other"])) for r in fam_t if r["kind"] == "P22"}
    p40 = {(qid(r["other"]), qid(r["person"])) for r in fam_t if r["kind"] == "P40"}  # (親,子)
    persons_with_father = {c for _, c in p22}
    print("\n実父(P22)あり:", len(persons_with_father), "/ なし:", len(persons - persons_with_father))
    print("P22のみ(親側にP40なし)のうち親が藩主の組:", len({e for e in p22 if e not in p40}))
    print("P40のみ(子側にP22なし)のうち子が藩主の組:", len({e for e in p40 if e not in p22 and e[1] in persons}))
    fathers = {f for f, _ in p22}
    father_domains = defaultdict(set)
    for r in oth:
        father_domains[qid(r["other"])].add(qid(r.get("domain")))
    outside = [f for f in fathers if f not in persons]
    print("実父のうち東北藩主でない人(=外部ノード候補):", len(outside),
          "(うち他地域の藩主P39を持つ:", sum(1 for f in outside if f in father_domains), ")")
    adopt = [r for r in fam_t if r["kind"] == "P1038"]
    print("P1038(養子等)の声明:", len(adopt), "/ P1039(関係)の値:",
          Counter(r.get("relLabel") for r in adopt).most_common(8))
    print("P1038でP1039なし:", sum(1 for r in adopt if not r.get("rel")))
    print("\n生データは data/raw/ に保存しました。")


if __name__ == "__main__":
    main()
