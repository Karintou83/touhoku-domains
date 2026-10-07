#!/usr/bin/env python3
"""Step 1 (続き): 家系 (P22/P40/P1038+P1039) の調査。

explore_wikidata.py の family クエリが 504 (timeout) になったため、書き直したもの。
原因: 「全藩主役職の全在任者」を起点にした重いクエリ + UNION で、WDQS の60秒制限を超えた。
対策:
  1. 起点を、すでに保存済みの data/raw/p39.json から「近世大名(Q24887524)の役職の在任者」だけに絞る。
  2. その人物QIDを VALUES で 60人ずつに分割して投げる(1リクエストが軽く、失敗しても再開できる)。
  3. 504/429 は待ってリトライ(指数バックオフ)。取得済みチャンクは data/raw/family_chunks/ に
     保存し、再実行時はスキップする(節度あるリクエスト数)。
使い方: python scripts/explore_family.py
"""
import json, time, urllib.parse, urllib.request, urllib.error
from collections import Counter, defaultdict
from pathlib import Path

ENDPOINT = "https://query.wikidata.org/sparql"
UA = "touhoku-domains/0.1 (https://github.com/Karintou83/touhoku-domains; Wikidata editor tool)"
RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
CH = RAW / "family_chunks"
CH.mkdir(parents=True, exist_ok=True)
KINSEI = "Q24887524"
CHUNK = 60


def qid(u):
    return u.rsplit("/", 1)[-1] if u else None


def sparql(query):
    url = ENDPOINT + "?" + urllib.parse.urlencode({"query": query, "format": "json"})
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/sparql-results+json"})
    for wait in (5, 20, 60, 120):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                rows = json.load(r)["results"]["bindings"]
            return [{k: v["value"] for k, v in row.items()} for row in rows]
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504):
                raise
            print(f"  HTTP {e.code}: {wait}秒待ってリトライ")
            time.sleep(wait)
    raise RuntimeError("リトライ上限")


# 1人物につき: 実父(P22)・子(P40)・養子関係(P1038+P1039)・氏(P53)・その相手のP39(役職)
# SAMPLE/GROUP_CONCAT で相手の複数値を1行にまとめる → 行の直積(cartesian product)による水増しを防ぐ。
def family_query(ids):
    vals = " ".join(f"wd:{i}" for i in ids)
    return f"""
SELECT ?person ?kind ?other ?otherLabel ?rel
       (GROUP_CONCAT(DISTINCT STR(?opos); separator="|") AS ?otherPos)
       (GROUP_CONCAT(DISTINCT STR(?oclan); separator="|") AS ?otherClan) WHERE {{
  VALUES ?person {{ {vals} }}
  {{ ?person wdt:P22 ?other . BIND("P22" AS ?kind) }}
  UNION {{ ?person wdt:P40 ?other . BIND("P40" AS ?kind) }}
  UNION {{ ?person p:P1038 ?st . ?st ps:P1038 ?other . OPTIONAL {{ ?st pq:P1039 ?rel }} BIND("P1038" AS ?kind) }}
  OPTIONAL {{ ?other wdt:P39 ?opos }}
  OPTIONAL {{ ?other wdt:P53 ?oclan }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "ja,en". }}
}} GROUP BY ?person ?kind ?other ?otherLabel ?rel
"""


def main():
    pos = json.loads((RAW / "positions.json").read_text(encoding="utf-8"))
    kinsei = {qid(r["pos"]) for r in pos if qid(r.get("p279")) == KINSEI}
    p39 = json.loads((RAW / "p39.json").read_text(encoding="utf-8"))
    persons = sorted({qid(r["person"]) for r in p39 if qid(r["pos"]) in kinsei})
    print("対象: 近世大名の役職", len(kinsei), "/ 藩主個人", len(persons))

    rows = []
    for i in range(0, len(persons), CHUNK):
        f = CH / f"{i // CHUNK:03d}.json"
        if f.exists():
            rows += json.loads(f.read_text(encoding="utf-8")); continue
        part = sparql(family_query(persons[i:i + CHUNK]))
        f.write_text(json.dumps(part, ensure_ascii=False), encoding="utf-8")
        rows += part
        print(f"chunk {i // CHUNK}: {len(part)} rows"); time.sleep(3)
    (RAW / "family.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")

    pset = set(persons)
    p22 = {(qid(r["person"]), qid(r["other"])) for r in rows if r["kind"] == "P22"}          # (子,父)
    p40 = {(qid(r["other"]), qid(r["person"])) for r in rows if r["kind"] == "P40"}          # (親,子)
    has_father = {c for c, _ in p22}
    print("\n=== 家系の欠落 ===")
    print("実父P22あり:", len(has_father & pset), "/ なし:", len(pset - has_father))
    print("P22はあるが、親側にP40が無い(親が藩主なら要追記):",
          sum(1 for c, f in p22 if f in pset and (f, c) not in p40))
    print("P40はあるが、子側にP22が無い(子が藩主なら要追記):",
          sum(1 for p, c in p40 if c in pset and (c, p) not in p22))
    # 実父のうち、藩主データ(P39)の外にいる人 = 外部ノード候補
    other_pos = defaultdict(set)
    for r in rows:
        if r["kind"] == "P22" and r.get("otherPos"):
            other_pos[qid(r["other"])] |= {qid(x) for x in r["otherPos"].split("|")}
    fathers = {f for _, f in p22}
    outside = fathers - pset
    print("実父のうち上記の藩主個人でない人:", len(outside),
          "(うち何らかの役職P39あり:", sum(1 for f in outside if f in other_pos), ")")
    adopt = [r for r in rows if r["kind"] == "P1038"]
    print("P1038(養子等)の声明:", len(adopt), "/ P1039の値:", Counter(r.get("rel") and qid(r["rel"]) for r in adopt).most_common(8))
    print("P1038なのにP1039なし:", sum(1 for r in adopt if not r.get("rel")))
    print("\n生データ: data/raw/family.json")


if __name__ == "__main__":
    main()
