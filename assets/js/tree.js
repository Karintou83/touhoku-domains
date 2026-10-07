/* 藩別の家系図ページ。Cytoscape.js + dagre(階層レイアウト hierarchical layout)。 */
(function () {
  const { el, showError } = Tohoku;
  const UI = Tohoku.GraphUI;
  let model, data, cy;
  const visible = new Set();
  const state = { domainId: null, hideExternal: false };
  // 表示オプション: 養子関係を出さない(既定)と、blood の辺だけを使う。
  function opts() { return { hideExternal: state.hideExternal, bloodOnly: !$("showAdoption").checked, images: $("showImages").checked }; }
  const $ = (id) => document.getElementById(id);

  function layout() {
    if (!cy || cy.elements().length === 0) return;
    try {
      cy.layout({ name: "dagre", rankDir: "TB", nodeSep: 26, rankSep: 72, nodeDimensionsIncludeLabels: true, animate: false, fit: false }).run();
    } catch (err) {
      // dagre の読み込みに失敗した場合の保険(CDN 障害など)。階層は崩れるが、表示は止めない。
      showError("階層レイアウト(dagre)を読み込めなかったため、簡易レイアウトで表示しています。");
      cy.layout({ name: "breadthfirst", directed: true, fit: false }).run();
    }
    cy.fit(cy.elements(), 40);
  }

  function highlight() { UI.applyHighlight(cy, model, { clanId: $("clan").value }); }

  function redraw() {
    cy.elements().remove();
    cy.add(model.elements(visible, opts()));
    highlight();
    layout();
    $("count").textContent = cy.nodes().length + " 人 / " + cy.edges().length + " 本";
  }

  function addIds(ids) { ids.forEach((id) => visible.add(id)); }

  function showDomain(domainId) {
    state.domainId = domainId;
    visible.clear();
    addIds(model.holders(domainId));
    // 実父をたどって N 世代前まで加える(養子は無視)。藩主が他家から入った場合も、実父の家が見える。
    const gens = +$("gens").value;
    if (gens > 0) model.ancestors([...visible], gens, { hideExternal: state.hideExternal }).forEach((id) => visible.add(id));
    redraw();
    renderDomainInfo();
    syncUrl();
  }

  function expand(id) {
    addIds(model.neighbors(id, opts()));
    redraw();
    select(id, false);
  }

  function select(id, center) {
    const n = cy.getElementById(id);
    if (!n || n.empty()) return;
    cy.nodes().unselect();
    n.select();
    if (center) cy.center(n);
    const hidden = [...model.neighbors(id, opts())].filter((x) => !visible.has(x)).length;
    const l = model.lords.get(id);
    const t = model.primaryTenure(id);
    UI.renderInfo($("info"), model, id, {
      actions: hidden > 0 ? [{ text: "親族を展開 (+" + hidden + ")", onclick: () => expand(id) }] : [],
      onClan: (clanId) => { $("clan").value = clanId; highlight(); },
      // 「地図で見る」は藩主だけ(地図は藩の位置に藩主を出すもので、藩主でない人物には行き先が無いため)。
      links: (t ? [{ text: "地図で見る", href: "map.html?lord=" + encodeURIComponent(l.id) }] : [])
        .concat([{ text: "全体の系図で見る", href: "all.html?lord=" + encodeURIComponent(l.id) }]),
    });
    syncUrl(id);
  }

  function renderDomainInfo() {
    const d = model.domains.get(state.domainId);
    const box = $("domainInfo");
    box.replaceChildren();
    if (!d) return;
    const bits = [];
    if (d.first_year || d.last_year) bits.push((d.first_year || "?") + "–" + (d.last_year || "?") + " 年");
    if (d.coord && d.coord.precision !== "exact") bits.push("座標は概略/仮置き");
    box.append(el("p", { class: "sub", text: bits.join(" ・ ") }));
    const ids = new Set([d.id, ...d.positions]);
    const ws = data.warnings.filter((w) => ids.has(w.subject));
    if (ws.length) {
      const ul = el("ul", { class: "warnings" });
      ws.forEach((w) => ul.append(el("li", { class: w.level, text: (w.level === "warn" ? "⚠ " : "ℹ ") + w.message })));
      box.append(ul);
    }
    box.append(el("p", { class: "links" }, [el("a", { href: "map.html?domain=" + encodeURIComponent(d.id), text: "この藩を地図で見る" })]));
  }

  function syncUrl(focus) {
    const p = new URLSearchParams();
    if (state.domainId) p.set("domain", state.domainId);
    if (focus) p.set("lord", focus);
    history.replaceState(null, "", "?" + p.toString());
  }

  async function init() {
    try { data = await Tohoku.loadData("data/"); } catch (err) { showError(String(err)); return; }
    if (typeof cytoscape === "undefined") { showError("Cytoscape.js を読み込めませんでした(ネットワークを確認してください)。"); return; }
    model = TreeModel.build(data);
    UI.syncAdoptionUI(data);
    UI.fillDomainSelect(model, data, $("domain"), false);
    UI.fillClanSelect(model, $("clan"));

    cy = cytoscape({ container: $("cy"), elements: [], style: UI.style(), wheelSensitivity: 0.3,
                     minZoom: 0.1, maxZoom: 2.5, boxSelectionEnabled: false });
    cy.on("tap", "node", (ev) => select(ev.target.id(), false));
    cy.on("dbltap", "node", (ev) => expand(ev.target.id()));
    cy.on("tap", (ev) => { if (ev.target === cy) { cy.nodes().unselect(); $("info").replaceChildren(el("p", { class: "sub", text: "人物をクリックすると詳細を表示します。" })); } });

    $("domain").addEventListener("change", () => showDomain($("domain").value));
    $("clan").addEventListener("change", highlight);
    $("gens").addEventListener("change", () => showDomain(state.domainId));
    $("showAdoption").addEventListener("change", () => showDomain(state.domainId));
    $("hideExternal").addEventListener("change", (ev) => { state.hideExternal = ev.target.checked; redraw(); });
    $("showImages").addEventListener("change", redraw);
    UI.bindSearch(model, $("q"), $("results"), (l) => {
      visible.add(l.id);
      if (state.hideExternal && l.external) { state.hideExternal = false; $("hideExternal").checked = false; }
      redraw();
      select(l.id, true);
    });
    $("clanAdd").addEventListener("click", () => {
      const c = model.clans.get($("clan").value);
      if (!c) return;
      c.members.forEach((id) => { const l = model.lords.get(id); if (l && !l.external) visible.add(id); });
      redraw();
    });
    $("reset").addEventListener("click", () => showDomain(state.domainId));

    const p = new URLSearchParams(location.search);
    const first = data.domains.find((d) => d.name === "松前藩") || data.domains[0];
    const start = model.domains.has(p.get("domain")) ? p.get("domain") : first.id;
    $("domain").value = start;
    showDomain(start);
    const focus = p.get("lord");
    if (focus && model.lords.has(focus)) { visible.add(focus); redraw(); select(focus, true); }
    $("generated").textContent = (data.meta && data.meta.generated_at) ? "データ生成: " + data.meta.generated_at.slice(0, 10) : "";
  }

  document.addEventListener("DOMContentLoaded", init);
})();
