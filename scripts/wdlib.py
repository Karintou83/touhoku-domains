"""Wikidata 取得まわりの共通部品。build_data.py / validate.py から使う。

ここに共通化する理由: SPARQL のリトライ・User-Agent・キャッシュの規約を1か所に集めておくと、
「節度あるリクエスト数」というルールを全スクリプトで同じように守れるため。
"""
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
DATA = ROOT / "data"

ENDPOINT = "https://query.wikidata.org/sparql"
API = "https://www.wikidata.org/w/api.php"
# 連絡先は GitHub の URL のみ。公開リポジトリに個人のメールアドレスを残さないため。
UA = "touhoku-domains/0.1 (https://github.com/Karintou83/touhoku-domains; Wikidata editor tool)"


def qid(uri):
    """'http://www.wikidata.org/entity/Q123' → 'Q123'。None はそのまま None。"""
    return uri.rsplit("/", 1)[-1] if uri else None


def year(s):
    """'1607-01-01T00:00:00Z' → 1607。年のみの精度なので月日は捨てる。"""
    m = re.match(r"^(-?\d{1,4})-", s or "")
    return int(m.group(1)) if m else None


def parse_point(s):
    """WKT 'Point(経度 緯度)' → (緯度, 経度)。WKT は lon, lat の順なので入れ替える。"""
    m = re.match(r"^Point\((-?[\d.]+) (-?[\d.]+)\)$", s or "")
    return (float(m.group(2)), float(m.group(1))) if m else None


def chunks(seq, n):
    seq = list(seq)
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def _get(url, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    for wait in (5, 20, 60, 120):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504):
                raise
            print(f"  HTTP {e.code}: {wait}秒待ってリトライ")
            time.sleep(wait)
    raise RuntimeError("リトライ上限に達しました: " + url[:120])


def sparql(query, pause=3):
    url = ENDPOINT + "?" + urllib.parse.urlencode({"query": query, "format": "json"})
    rows = _get(url)["results"]["bindings"]
    time.sleep(pause)  # 連続リクエストを避ける
    return [{k: v["value"] for k, v in row.items()} for row in rows]


COMMONS_API = "https://commons.wikimedia.org/w/api.php"


def api(_endpoint=None, **params):
    """MediaWiki API (既定は Wikidata)。Commons を呼ぶときは _endpoint=COMMONS_API を渡す。"""
    params["format"] = "json"
    return _get((_endpoint or API) + "?" + urllib.parse.urlencode(params), timeout=60)


def cached(name, producer):
    """data/raw/<name> があればそれを使い、無ければ producer() で取得して保存する。
    取得し直したいときは、そのファイルを消す。"""
    RAW.mkdir(parents=True, exist_ok=True)
    path = RAW / name
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    rows = producer()
    path.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[fetch] {name}: {len(rows) if hasattr(rows, '__len__') else ''}")
    return rows


def dump(name, obj):
    DATA.mkdir(parents=True, exist_ok=True)
    # 並び順を固定し、indent を付ける: git の差分が小さく、レビューしやすい。
    (DATA / name).write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
