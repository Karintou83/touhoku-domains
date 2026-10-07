/* 地図ページの純粋ロジック(DOM・Leaflet に依存しない)。Node でも単体テストできるように分けている。
   ここでは「ある年に、ある藩を誰が治めていたか」と「その氏の色」だけを決める。 */
(function (root) {
  const NO_CLAN = { fill: "#bdbdbd", border: "#6f6f6f" };

  function build(data) {
    const lords = new Map(data.lords.map((l) => [l.id, l]));
    const domains = new Map(data.domains.map((d) => [d.id, d]));
    const byDomain = new Map();
    data.tenures.forEach((t) => {
      if (!byDomain.has(t.domain)) byDomain.set(t.domain, []);
      byDomain.get(t.domain).push(t);
    });
    byDomain.forEach((ts) => ts.sort((a, b) => (a.start || 0) - (b.start || 0) || (a.ord || 0) - (b.ord || 0)));

    // 氏の色: 氏を名前順に並べ、黄金角(137.5°)ずつ色相をずらす。隣り合う氏が似た色になりにくい。
    // 氏の数が多いので完全に区別できる色数ではない。凡例と、クリックでの強調で補う。
    const clanIds = [...new Set(data.lords.flatMap((l) => l.clans.map((c) => c.id)))];
    const clanName = new Map(data.lords.flatMap((l) => l.clans.map((c) => [c.id, c.name])));
    clanIds.sort((a, b) => clanName.get(a).localeCompare(clanName.get(b), "ja"));
    const clanColor = new Map(clanIds.map((id, i) => {
      const h = Math.round((i * 137.508) % 360);
      const s = 44 + (i % 3) * 7, l = 50 + ((i >> 1) % 3) * 5;
      return [id, { fill: "hsl(" + h + "," + s + "%," + l + "%)", border: "hsl(" + h + ",42%,26%)" }];
    }));

    // lord の「表示する氏」: clans の先頭。複数ある人は先頭だけを使い、複数あることは popup で示す。
    function clanOf(lordId) {
      const l = lords.get(lordId);
      if (!l || !l.clans.length) return null;
      return { id: l.clans[0].id, name: l.clans[0].name, source: l.clan_source || "none", multiple: l.clans.length > 1 };
    }

    // year 時点の在任者。藩主交代の年は、新旧どちらも在任として重なるので「新しい方(start が遅い方)」を主とし、
    // 旧藩主は others に入れる。start も end も不明な在任は年が決められないので対象外。
    // 戻り値 status: "holder"(在任者あり) / "gap"(藩の存続期間内だが在任者データなし) / "outside"(藩の存続期間外)
    function stateAt(domainId, year) {
      const d = domains.get(domainId);
      const ts = (byDomain.get(domainId) || []).filter((t) => t.start);
      const active = ts.filter((t) => t.start <= year && (t.end == null || year <= t.end));
      if (active.length) {
        active.sort((a, b) => b.start - a.start);
        // end 不明の在任が、次の在任の start 以降まで続くことはないので、end==null は「次の start の前年まで」とみなす。
        const t = active.find((x) => x.end != null || !ts.some((y) => y.start > x.start && y.start <= year)) || active[0];
        return { status: "holder", tenure: t, others: active.filter((x) => x !== t) };
      }
      const first = d && d.first_year, last = d && d.last_year;
      if (first != null && last != null && year >= first && year <= last) return { status: "gap" };
      return { status: "outside" };
    }

    function tenuresOf(domainId) { return byDomain.get(domainId) || []; }

    return { lords, domains, clanColor, clanName, clanOf, stateAt, tenuresOf, NO_CLAN };
  }

  const api = { build, NO_CLAN };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Tohoku = Object.assign(root.Tohoku || {}, { MapModel: api });
})(typeof window !== "undefined" ? window : globalThis);
