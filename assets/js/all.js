/* 全体の家系図ページ: 東北諸藩の全員を1つのグラフとして表示する。
   dagre を全体に一度かけると、つながりのない一族が横一列に並んで極端に横長になるため、
   「一族(連結成分)ごとに階層レイアウト → 全体を2次元に敷き詰める」という2段階で配置する。 */
(function () {
  const { el, showError } = Tohoku;
  const UI = Tohoku.GraphUI;
  let model, data, cy;
  const $ = (id) => document.getElementById(id);

  function layoutAll(hideExternal) {
    const comps = model.components(new Set(data.lords.map((l) => l.id)), { hideExternal });
    const placed = [];
    // 1) 一族ごとに dagre で階層レイアウトし、外接矩形を測る
    comps.forEach((ids) => {
      const set = new Set(ids);
      const nodes = cy.nodes().filter((n) => set.has(n.id()));
      const eles = nodes.union(nodes.connectedEdges());
      try {
        eles.layout({ name: "dagre", rankDir: "TB", nodeSep: 18, rankSep: 56, nodeDimensionsIncludeLabels: true, animate: false, fit: false }).run();
      } catch (err) {
        showError("階層レイアウト(dagre)を読み込めなかったため、簡易レイアウトで表示しています。");
        eles.layout({ name: "grid", fit: false }).run();
      }
      const bb = eles.boundingBox();
      placed.push({ nodes, bb, rect: { id: placed.length, w: bb.w + 30, h: bb.h + 30 } });
    });
    // 2) 一族の矩形を2次元に敷き詰め、各ノードの座標を平行移動する
    const pack = model.packRects(placed.map((p) => p.rect), 3200, 50);
    cy.batch(() => {
      pack.positions.forEach((pos, i) => {
        const { nodes, bb } = placed[i];
        const dx = pos.x - bb.x1, dy = pos.y - bb.y1;
        nodes.positions((n) => ({ x: n.position("x") + dx, y: n.position("y") + dy }));
      });
    });
    return comps.length;
  }

  function highlight() { UI.applyHighlight(cy, model, { clanId: $("clan").value, domainId: $("domain").value }); }

  function redraw() {
    const hideExternal = $("hideExternal").checked;
    cy.elements().remove();
    cy.add(model.allElements({ hideExternal, images: $("showImages").checked }));
    const n = layoutAll(hideExternal);
    cy.fit(cy.elements(), 30);
    highlight();
    $("count").textContent = cy.nodes().length + " 人 / " + cy.edges().length + " 本 / " + n + " 組の一族";
  }

  // 選んだ人物とその直接の親族以外を薄くして、つながりを追いやすくする
  function focusNode(id) {
    const n = cy.getElementById(id);
    if (!n || n.empty()) return;
    cy.elements().removeClass("faded");
    cy.elements().not(n.closedNeighborhood()).addClass("faded");
    cy.nodes().unselect();
    n.select();
    const l = model.lords.get(id);
    const t = model.primaryTenure(id);
    UI.renderInfo($("info"), model, id, {
      onClan: (clanId) => { $("clan").value = clanId; highlight(); },
      links: [{ text: "藩別の家系図で見る", href: "tree.html?" + (t ? "domain=" + encodeURIComponent(t.domain) + "&" : "") + "lord=" + encodeURIComponent(l.id) },
             ].concat(t ? [{ text: "地図で見る", href: "map.html?lord=" + encodeURIComponent(l.id) }] : []),
    });
    history.replaceState(null, "", "?lord=" + encodeURIComponent(id));
  }

  function clearFocus() {
    cy.elements().removeClass("faded");
    cy.nodes().unselect();
    $("info").replaceChildren(el("p", { class: "sub", text: "人物をクリックすると、その人と親族だけが濃く表示されます。" }));
  }

  async function init() {
    try { data = await Tohoku.loadData("data/"); } catch (err) { showError(String(err)); return; }
    if (typeof cytoscape === "undefined") { showError("Cytoscape.js を読み込めませんでした(ネットワークを確認してください)。"); return; }
    model = TreeModel.build(data);
    UI.syncAdoptionUI(data);
    UI.fillDomainSelect(model, data, $("domain"), true);
    UI.fillClanSelect(model, $("clan"));

    // 辺は曲線(bezier)にする。一族の中は階層で整うが、一族をまたぐ線は無いので taxi でも良いが、
    // 全体表示では斜めの線のほうが混み合った箇所で追いやすい。
    cy = cytoscape({ container: $("cy"), elements: [], style: UI.style({ curved: true, round: true }), wheelSensitivity: 0.3,
                     minZoom: 0.03, maxZoom: 2.5, boxSelectionEnabled: false, textureOnViewport: true });
    cy.on("tap", "node", (ev) => focusNode(ev.target.id()));
    cy.on("tap", (ev) => { if (ev.target === cy) clearFocus(); });

    $("clan").addEventListener("change", highlight);
    $("domain").addEventListener("change", () => {
      highlight();
      const dom = $("domain").value;
      const hit = cy.nodes().filter((n) => { const t = model.primaryTenure(n.id()); return t && t.domain === dom; });
      if (dom && !hit.empty()) cy.fit(hit, 60);
    });
    $("hideExternal").addEventListener("change", redraw);
    $("showImages").addEventListener("change", redraw);
    $("fit").addEventListener("click", () => cy.fit(cy.elements(), 30));
    UI.bindSearch(model, $("q"), $("results"), (l) => {
      if ($("hideExternal").checked && l.external) { $("hideExternal").checked = false; redraw(); }
      focusNode(l.id);
      cy.center(cy.getElementById(l.id));
    });

    // 凡例: 藩の色
    const legend = $("domainLegend");
    data.domains.filter((d) => d.scope === "tohoku").sort((a, b) => a.name.localeCompare(b.name, "ja")).forEach((d) => {
      const c = model.colors.get(d.id);
      legend.append(el("li", {}, [el("span", { class: "chip", style: "background:" + c.fill + ";border-color:" + c.border }), d.name]));
    });

    redraw();
    const focus = new URLSearchParams(location.search).get("lord");
    if (focus && model.lords.has(focus)) { focusNode(focus); cy.center(cy.getElementById(focus)); cy.zoom(0.9); }
    $("generated").textContent = (data.meta && data.meta.generated_at) ? "データ生成: " + data.meta.generated_at.slice(0, 10) : "";
  }

  document.addEventListener("DOMContentLoaded", init);
})();
