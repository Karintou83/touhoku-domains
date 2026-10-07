#!/usr/bin/env python3
"""P1039(関係)の値などのQIDに、日本語ラベルを付けて表示する小さなスクリプト。

WDQS ではなく wbgetentities (Wikidata API) を使う理由: ラベルだけなら軽く、50件まとめて取れる。
使い方: python scripts/fetch_labels.py
"""
import json, urllib.parse, urllib.request
from collections import Counter
from pathlib import Path

UA = "touhoku-domains/0.1 (https://github.com/Karintou83/touhoku-domains; Wikidata editor tool)"
RAW = Path(__file__).resolve().parent.parent / "data" / "raw"

fam = json.loads((RAW / "family.json").read_text(encoding="utf-8"))
cnt = Counter(r["rel"].rsplit("/", 1)[-1] for r in fam if r["kind"] == "P1038" and r.get("rel"))
ids = list(cnt)
url = "https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode({
    "action": "wbgetentities", "ids": "|".join(ids[:50]), "props": "labels|descriptions",
    "languages": "ja|en", "format": "json"})
with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
    ents = json.load(r)["entities"]
out = {}
for i in ids:
    lb = ents.get(i, {}).get("labels", {})
    ds = ents.get(i, {}).get("descriptions", {})
    out[i] = {"count": cnt[i], "ja": lb.get("ja", {}).get("value"), "en": lb.get("en", {}).get("value"),
              "desc_ja": ds.get("ja", {}).get("value")}
    print(i, cnt[i], out[i]["ja"], "/", out[i]["en"], "/", out[i]["desc_ja"])
(RAW / "p1039_labels.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
