#!/usr/bin/env python3
"""旧国境 (CODH「旧国・旧郡境界データセット」, 江戸末期の国境) を取得し、data/kyukoku.geojson にまとめる。

使い方: python scripts/fetch_kyukoku.py
  1回だけ実行すれば良い(結果は data/ に保存され、サイトはそれを読む)。
  配布URLは .../kg/geojson/K19.geojson の形式(Qiita の実例による)。念のため候補を順に試し、成功した形式で全85国を取得する。
  どれも失敗したときは、そのまま出力を教えてください(URL形式を調べ直します)。
ライセンスは「CC BY-NC」「CC BY 4.0」の記載がページにより異なるため、公開前に
  https://geoshape.ex.nii.ac.jp/kg/ で最新の条件を確認し、クレジット(map.html のフッター)を保つこと。
"""
import json
import time
import urllib.request

from wdlib import DATA, UA

BASE = "https://geoshape.ex.nii.ac.jp/kg"
# (URLテンプレート, Accept)。上から順に K31(陸奥)で試す。
CANDIDATES = [
    (BASE + "/geojson/{id}.geojson", "application/json"),   # Qiita の実例 (下総 K19) で使われている形式
    (BASE + "/geojson/resource/{id}.geojson", "application/json"),
    (BASE + "/resource/{id}.geojson", "application/json"),
    (BASE + "/resource/{id}", "application/geo+json"),
    (BASE + "/resource/{id}.json", "application/json"),
]


def get(url, accept):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def rnd(c, n=4):
    """座標を小数4桁(約10m)に丸めてファイルを軽くする。国境の表示にはこれで十分。"""
    return round(c, n) if isinstance(c, float) else [rnd(x, n) for x in c]


def main():
    tpl = None
    for url, accept in CANDIDATES:
        try:
            get(url.format(id="K31"), accept)
            tpl = (url, accept)
            print("OK:", url)
            break
        except Exception as e:  # noqa: BLE001 - どの形式が通るかを探る試行
            print("NG:", url, "->", e)
    if not tpl:
        raise SystemExit("取得できる形式が見つかりませんでした。上の NG の内容を教えてください。")
    feats = []
    for i in range(1, 86):
        kid = f"K{i:02d}"
        try:
            gj = get(tpl[0].format(id=kid), tpl[1])
        except Exception as e:  # noqa: BLE001
            print(kid, "取得失敗:", e)
            continue
        items = gj["features"] if gj.get("type") == "FeatureCollection" else [gj]
        for f in items:
            f["geometry"]["coordinates"] = rnd(f["geometry"]["coordinates"])
            f.setdefault("properties", {})["kuni_id"] = kid
            feats.append(f)
        time.sleep(1.0)   # 節度あるリクエスト
    out = DATA / "kyukoku.geojson"
    out.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False), encoding="utf-8")
    print(f"{len(feats)} 件 -> {out}")
    if feats:
        print("属性の例:", feats[0]["properties"])


if __name__ == "__main__":
    main()
