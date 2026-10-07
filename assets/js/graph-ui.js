/* 藩別の家系図(tree.html)と全体の家系図(all.html)で共有する、見た目と詳細パネル・氏の強調・検索。 */
(function (root) {
  const { el, wikipediaUrl, wikidataUrl, CLAN_SOURCE_LABEL } = Tohoku;

  const INK = "#2a2622", EDGE = "#a39a86", VERMILION = "#b43a2c", INDIGO = "#223a5e", GOLD = "#a8801f";

  // Cytoscape のスタイル。色は data(fill)/data(border) から読む(藩ごとの色はモデル側で決める)。
  // 外部の大名家は灰色+破線、氏が確定のノードは金、推定のノードは薄い金の破線、要確認は朱の二重枠。
  function style(opts) {
    const taxi = !(opts && opts.curved);
    // round: 人物を丸で描く(全体の系図用)。丸の中に「藩・代+名前」は収まらないので、名前は丸の下に出す。
    // 配列の最後に足しているのは、形と大きさだけを上書きするため(色・枠・強調の指定は上のものがそのまま効く)。
    const round = !(opts && opts.round) ? [] : [
      { selector: "node", style: {
        "shape": "ellipse", "width": 46, "height": 46, "padding": "0px", "font-size": 11.5,
        "text-valign": "bottom", "text-margin-y": 5, "text-background-color": "#fffdf8", "text-background-opacity": 0.85,
        "text-background-padding": 2, "text-background-shape": "roundrectangle" } },
      { selector: "node[?hasImg]", style: { "width": 66, "height": 66 } },
    ];
    return [
      { selector: "node", style: {
        "shape": "round-rectangle", "corner-radius": 7, "label": "data(label)", "text-wrap": "wrap", "text-max-width": 150,
        "text-valign": "center", "text-halign": "center", "font-size": 12.5, "line-height": 1.3, "color": INK,
        "width": "label", "height": "label", "padding": "11px", "background-color": "data(fill)",
        "border-width": 1.2, "border-color": "data(border)", "min-zoomed-font-size": 6,
        "shadow-blur": 8, "shadow-color": "#5a4620", "shadow-opacity": 0.14, "shadow-offset-x": 0, "shadow-offset-y": 2,
        "font-family": "'Yu Mincho','Hiragino Mincho ProN','Noto Serif JP',serif", "font-weight": 600 } },
      // 肖像のある人物: 顔写真のカードにして、名前はカードの下に出す(Wikimedia Commons の画像)
      { selector: "node[?hasImg]", style: {
        "width": 80, "height": 100, "padding": "0px", "border-width": 2.5, "corner-radius": 5, "background-image": "data(img)", "background-fit": "cover",
        "background-position-y": "0%", "background-image-crossorigin": "null", "background-clip": "node",
        "text-valign": "bottom", "text-margin-y": 6, "text-background-color": "#fffdf8", "text-background-opacity": 0.85,
        "text-background-padding": 2, "text-background-shape": "roundrectangle" } },
      { selector: "node[?external]", style: { "border-style": "dashed", "color": "#555" } },
      { selector: "node[hidden > 0]", style: { "border-width": 3 } },
      { selector: "node[?warn]", style: { "border-width": 3.5, "border-style": "double", "border-color": VERMILION } },
      { selector: "node.hl", style: { "background-color": "#f4d98a", "border-color": GOLD, "border-width": 3, "border-style": "solid" } },
      { selector: "node.hl-inferred", style: { "background-color": "#fbefc9", "border-color": GOLD, "border-width": 3, "border-style": "dashed" } },
      { selector: "node.hl-domain", style: { "border-width": 3.5, "border-color": INDIGO, "border-style": "solid" } },
      { selector: "node.dim, node.faded", style: { "opacity": 0.22 } },
      { selector: "node:selected", style: { "border-width": 4, "border-color": INDIGO, "border-style": "solid",
                                           "underlay-color": INDIGO, "underlay-opacity": 0.15, "underlay-padding": 7 } },
      { selector: "edge", style: Object.assign({
        "width": 1.3, "line-color": EDGE, "target-arrow-shape": "none", "target-arrow-color": EDGE, "arrow-scale": 1.1 },
        taxi ? { "curve-style": "taxi", "taxi-direction": "downward", "taxi-turn": "40%" } : { "curve-style": "bezier" }) },
      // 実親子=実線、養子=点線、婿養子=破線。養子は向き(養親→養子)が重要なので矢印を付ける。
      { selector: "edge[type = 'adoption']", style: { "line-style": "dotted", "width": 2.2, "line-color": "#4f7a52", "target-arrow-shape": "triangle", "target-arrow-color": "#4f7a52" } },
      { selector: "edge[type = 'son_in_law']", style: { "line-style": "dashed", "width": 2.2, "line-color": "#7a4f8a", "target-arrow-shape": "triangle", "target-arrow-color": "#7a4f8a" } },
      { selector: "edge[type = 'adoption_unknown']", style: { "line-style": "dotted", "line-color": "#aaa" } },
      { selector: "edge[?flagged]", style: { "width": 3, "line-color": VERMILION } },
      { selector: "edge.dim, edge.faded", style: { "opacity": 0.12 } },
    ].concat(round);
  }

  function fillClanSelect(model, select) {
    [...model.clans.values()].sort((a, b) => b.members.size - a.members.size).forEach((c) => {
      select.append(el("option", { value: c.id, text: c.name + " (" + c.members.size + ")" }));
    });
  }

  function fillDomainSelect(model, data, select, withNone) {
    if (withNone) select.append(el("option", { value: "", text: "(なし)" }));
    const groups = { tohoku: el("optgroup", { label: "東北" }), external: el("optgroup", { label: "外部(東北外の実父の家)" }) };
    data.domains.slice().sort((a, b) => a.name.localeCompare(b.name, "ja")).forEach((d) => {
      groups[d.scope === "tohoku" ? "tohoku" : "external"].append(el("option", { value: d.id, text: d.name }));
    });
    select.append(groups.tohoku, groups.external);
  }

  // 氏・藩による強調。強調に当たらないノードは薄くする。
  function applyHighlight(cy, model, sel) {
    cy.elements().removeClass("hl hl-inferred hl-domain dim");
    const clan = sel.clanId, dom = sel.domainId;
    if (!clan && !dom) return;
    cy.nodes().forEach((n) => {
      const id = n.id();
      const okClan = !clan || n.data("clanIds").includes(clan);
      const t = model.primaryTenure(id);
      const okDom = !dom || (t && t.domain === dom);
      if (okClan && okDom) {
        n.addClass(clan ? (n.data("clanSource") === "wikidata" ? "hl" : "hl-inferred") : "hl-domain");
      } else n.addClass("dim");
    });
    cy.edges().forEach((e) => { if (e.source().hasClass("dim") || e.target().hasClass("dim")) e.addClass("dim"); });
  }

  // Wikimedia Commons の画像。画像は転載せず Commons のサムネイルを直接参照し、作者・ライセンス・ファイルページへの
  // リンクを必ず添える(CC BY 等の表示義務と、出典の明確さのため)。ライセンスを確認できない画像はリンクのみ。
  function imageBlock(l) {
    const im = l.image;
    const page = im.page_url || "https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(im.file.replace(/ /g, "_"));
    const lic = im.license_url
      ? el("a", { href: im.license_url, target: "_blank", rel: "noopener", text: im.license || "ライセンス" })
      : el("span", { text: im.license || "ライセンス不明" });
    const author = im.author ? (im.author.length > 90 ? im.author.slice(0, 90) + "…" : im.author) : null;
    if (!im.display) {
      return el("p", { class: "sub" }, ["画像あり(ライセンスを確認できないため表示していません): ",
        el("a", { href: page, target: "_blank", rel: "noopener", text: "Wikimedia Commons" })]);
    }
    const img = el("img", { src: Tohoku.imageUrl(im, 240),
                            alt: l.name + "の画像", loading: "lazy" });
    const fig = el("figure", { class: "portrait" }, [
      el("a", { href: page, target: "_blank", rel: "noopener" }, [img]),
      el("figcaption", {}, ["画像: ", el("a", { href: page, target: "_blank", rel: "noopener", text: "Wikimedia Commons" }),
                            author ? " / " + author : "", " / ", lic]),
    ]);
    img.addEventListener("error", () => { fig.replaceChildren(el("span", { class: "sub", text: "画像を読み込めませんでした。" })); });
    return fig;
  }

  // 詳細パネル。ctx.actions: [{text, onclick}] / ctx.links: [{text, href}]
  function renderInfo(box, model, id, ctx) {
    const l = model.lords.get(id);
    box.replaceChildren();
    if (!l) return;
    const title = l.wikipedia
      ? el("a", { href: wikipediaUrl(l.wikipedia), target: "_blank", rel: "noopener", text: l.name })
      : el("span", { text: l.name });
    box.append(el("h3", { class: "person" }, [title]));
    box.append(el("p", { class: "sub", text: l.gen_label || (l.external ? "東北外の大名家(外部)" : "藩主以外") }));
    if (l.image) box.append(imageBlock(l));

    const clanText = l.clans.length
      ? l.clans.map((c) => c.name).join("・")
      : "不明";
    const row = el("p", {}, [el("span", { class: "k", text: "氏 " }), clanText]);
    if (l.clans.length) {
      const src = CLAN_SOURCE_LABEL[l.clan_source] || "出所不明";
      row.append(" ", el("span", { class: "tag" + (l.clan_source === "wikidata" ? "" : " uncertain"), text: src }));
    }
    box.append(row);

    const warnings = model.warningsFor(id);
    if (warnings.length) {
      const ul = el("ul", { class: "warnings" });
      warnings.forEach((w) => ul.append(el("li", { class: w.level, text: (w.level === "warn" ? "⚠ " : "ℹ ") + w.message })));
      box.append(el("h4", { text: "要確認" }), ul);
    }
    const acts = ((ctx && ctx.actions) || []).slice();   // 呼び出し側の配列を書き換えないようコピーする
    if (l.clans.length) acts.push({ text: "この氏を強調", onclick: () => ctx.onClan && ctx.onClan(l.clans[0].id) });
    if (acts.length) {
      const btns = el("div", { class: "buttons" });
      acts.forEach((a) => btns.append(el("button", { type: "button", class: "btn", text: a.text, onclick: a.onclick })));
      box.append(btns);
    }
    const links = el("p", { class: "links" }, [el("a", { href: wikidataUrl(l.id), target: "_blank", rel: "noopener", text: "Wikidata" })]);
    ((ctx && ctx.links) || []).forEach((k) => links.append(" ・ ", el("a", { href: k.href, text: k.text })));
    box.append(links);
  }

  function bindSearch(model, input, list, onPick) {
    input.addEventListener("input", () => {
      list.replaceChildren();
      model.search(input.value, 12).forEach((l) => {
        const label = l.name + (l.gen_label ? " — " + l.gen_label : "") + (l.external ? "(外部)" : "");
        list.append(el("li", {}, [el("button", { type: "button", class: "result", text: label, onclick: () => onPick(l) })]));
      });
    });
  }

  // 養子関係の辺がデータに無いとき(config.json の include_adoption が false)は、養子に関する操作と凡例を隠す。
  // HTML 側で data-adoption を付けた要素が対象。データを見て決めるので、設定を戻して再生成すれば自動で元に戻る。
  function syncAdoptionUI(data) {
    const has = data.relations.some((e) => e.type !== "blood");
    document.querySelectorAll("[data-adoption]").forEach((n) => { n.hidden = !has; });
    return has;
  }

  root.Tohoku.GraphUI = { syncAdoptionUI, style, fillClanSelect, fillDomainSelect, applyHighlight, renderInfo, bindSearch, imageBlock };
})(window);
