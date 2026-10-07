/* 地図ページ。Leaflet で藩の陣屋(城)位置にマーカーを置き、年スライダーで藩主の氏による色分けを切り替える。 */
(function () {
  const { el, loadData, showError, wikipediaUrl, wikidataUrl, CLAN_SOURCE_LABEL } = Tohoku;
  const $ = (id) => document.getElementById(id);
  const PRECISION_LABEL = {
    exact: "藩の所在地の座標(Wikidata P625 または 城・陣屋)",
    approx: "概略位置: 藩の所在地(市町村)の座標で、陣屋の位置ではありません",
    branch: "仮置き: 本藩の陣屋の近くに置いています(実際の位置ではありません)",
  };

  function init() {
    loadData().then(start).catch((e) => showError("データの読み込みに失敗しました: " + e.message));
  }

  function start(data) {
    const M = Tohoku.MapModel.build(data);
    const [Y0, Y1] = [1590, 1871];
    const state = { year: 1750, showExternal: false, showFaces: true, clan: "", selected: null };
    const thumb = (l) => Tohoku.imageUrl(l.image, 240);

    const map = L.map("map", { zoomControl: true }).setView([39.2, 140.6], 7);
    // 地図タイル(国土地理院)。既定は文字のない「白地図」。出典の表示が必要なので attribution に必ず入れる。
    // 白地図タイルのズームは 5–14。淡色地図は地名が多いので、必要なときだけ切り替える。
    const GSI = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>';
    const blank = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png", { minZoom: 5, maxZoom: 14, attribution: GSI + "(白地図)" });
    const pale = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", { minZoom: 5, maxZoom: 18, attribution: GSI + "(淡色地図)" });
    blank.addTo(map);
    const layerCtl = L.control.layers({ "白地図(文字なし)": blank, "淡色地図": pale }, {}, { collapsed: true }).addTo(map);

    // 旧国境(任意): data/kyukoku.geojson があれば重ねる。国名は常時表示せず、マウスを載せたときだけ出す(文字が邪魔にならないように)。
    fetch("data/kyukoku.geojson").then((r) => (r.ok ? r.json() : null)).then((gj) => {
      if (!gj) { $("kyukokuNote").hidden = false; return; }
      const nameOf = (p) => p.name || p.NAME || p["名称"] || p.label || p.kuni || Object.values(p).find((v) => typeof v === "string") || "";
      const layer = L.geoJSON(gj, {
        style: { color: "#8a6f4d", weight: 1.3, fill: true, fillOpacity: 0, dashArray: "5 3", interactive: true },
        onEachFeature: (f, l) => { l.bindTooltip(nameOf(f.properties || {}), { sticky: true, direction: "top" }); },
      }).addTo(map);
      layer.bringToBack();
      layerCtl.addOverlay(layer, "旧国境(江戸末期)");
      $("kyukokuCredit").hidden = false;
    }).catch(() => { $("kyukokuNote").hidden = false; });

    const markers = new Map();
    const faces = new Map();     // 藩ID → 顔写真マーカー(藩主が変わるたびにアイコンを作り直す)
    const faceKey = new Map();
    const placeable = data.domains.filter((d) => d.coord);
    placeable.forEach((d) => {
      const m = L.circleMarker([d.coord.lat, d.coord.lon], { radius: 9, weight: 2.5, fillOpacity: 0.92 });
      m.on("click", () => select(d.id));
      m.bindTooltip(d.name, { direction: "top", offset: [0, -6] });
      markers.set(d.id, m);
    });

    function visible(d) { return d.scope === "tohoku" || state.showExternal; }

    function paint() {
      const y = state.year;
      const present = new Map(); // 氏 → 数
      let holders = 0, gaps = 0;
      placeable.forEach((d) => {
        const m = markers.get(d.id);
        const st = M.stateAt(d.id, y);
        if (!visible(d) || st.status === "outside") { if (map.hasLayer(m)) map.removeLayer(m); dropFace(d.id); return; }
        if (!map.hasLayer(m)) m.addTo(map);
        let color = M.NO_CLAN, dashed = d.coord.precision !== "exact", opacity = 0.9, clanId = null;
        if (st.status === "holder") {
          holders++;
          const c = M.clanOf(st.tenure.lord);
          clanId = c && c.id;
          if (c) { color = M.clanColor.get(c.id); present.set(c.id, (present.get(c.id) || 0) + 1); }
          else present.set("", (present.get("") || 0) + 1);
          if (c && c.source !== "wikidata") dashed = true; // 氏が推定のものは破線の縁で区別
        } else { gaps++; color = { fill: "#ffffff", border: "#6f6f6f" }; present.set("gap", (present.get("gap") || 0) + 1); }
        if (state.clan && state.clan !== clanId) opacity = 0.18;
        m.setStyle({ fillColor: color.fill, color: color.border, fillOpacity: opacity, opacity: opacity > 0.5 ? 1 : 0.35,
                     dashArray: dashed ? "3 3" : null, weight: d.id === state.selected ? 4 : 2 });
        if (d.id === state.selected) m.bringToFront();
        // 顔写真: 在任者に表示可能な画像があれば、円形の肖像アイコンを重ねる(縁の色は氏の色)。
        const face = st.status === "holder" ? M.lords.get(st.tenure.lord) : null;
        if (state.showFaces && face && face.image && face.image.display) showFace(d, face, color, opacity);
        else dropFace(d.id);
      });
      $("yearLabel").textContent = y + "年";
      renderLegend(present);
      $("summary").textContent = "この年に存在する藩(表示中): " + (holders + gaps) + "(うち在任者データなし " + gaps + ")";
      if (state.selected) renderDetail(state.selected);
    }

    function dropFace(id) { const f = faces.get(id); if (f && map.hasLayer(f)) map.removeLayer(f); }
    function showFace(d, lord, color, opacity) {
      let f = faces.get(d.id);
      const key = lord.id + "|" + color.border + "|" + (d.id === state.selected);
      if (!f || faceKey.get(d.id) !== key) {
        if (f && map.hasLayer(f)) map.removeLayer(f);
        const icon = L.divIcon({ className: "face-icon", iconSize: [44, 44], iconAnchor: [22, 22],
          html: '<span style="background-image:url(\'' + thumb(lord) + '\');--c:' + color.border + '"></span>' });
        f = L.marker([d.coord.lat, d.coord.lon], { icon, keyboard: false, zIndexOffset: d.id === state.selected ? 1000 : 0 });
        f.on("click", () => select(d.id));
        f.bindTooltip(d.name + " " + lord.name, { direction: "top", offset: [0, -20] });
        faces.set(d.id, f); faceKey.set(d.id, key);
      }
      if (!map.hasLayer(f)) f.addTo(map);
      const el_ = f.getElement && f.getElement();
      if (el_) el_.style.opacity = opacity;
    }

    function renderLegend(present) {
      const box = $("legend"); box.textContent = "";
      const items = [...present.entries()].sort((a, b) => b[1] - a[1]);
      items.forEach(([id, n]) => {
        const label = id === "" ? "氏の情報なし" : id === "gap" ? "在任者データなし" : M.clanName.get(id);
        const col = id === "" ? M.NO_CLAN : id === "gap" ? { fill: "#fff", border: "#6f6f6f" } : M.clanColor.get(id);
        const real = id !== "" && id !== "gap";
        const b = el("button", { type: "button", class: "lg" + (state.clan === id && real ? " on" : ""), "aria-pressed": state.clan === id && real ? "true" : "false",
          onclick: () => { if (!real) return; state.clan = state.clan === id ? "" : id; paint(); } }, [
          el("span", { class: "chip", style: "background:" + col.fill + ";border-color:" + col.border }),
          el("span", { text: label + " " + n }),
        ]);
        box.append(b);
      });
    }

    function select(id) { state.selected = id; paint(); }

    function renderDetail(id) {
      const d = M.domains.get(id), box = $("detail"); box.textContent = "";
      const st = M.stateAt(id, state.year);
      box.append(el("h3", {}, [d.wikipedia ? el("a", { href: wikipediaUrl(d.wikipedia), target: "_blank", rel: "noopener", text: d.name }) : d.name]));
      // 座標のない藩も ?domain= で選べるので、その場合は地図に出せない理由を示す。
      box.append(d.coord
        ? el("p", { class: "sub", text: PRECISION_LABEL[d.coord.precision] + (d.coord.source_label ? "(" + d.coord.source_label + ")" : "") })
        : el("p", { class: "warn-note", text: "この藩は座標のデータがないため、地図上には表示していません。" }));
      if (st.status === "holder") {
        const l = M.lords.get(st.tenure.lord), c = M.clanOf(l.id);
        if (l.image) box.append(Tohoku.GraphUI.imageBlock(l));
        box.append(el("p", {}, [el("b", { text: state.year + "年の藩主: " }), lordLink(l, st.tenure),
          c ? el("span", { class: "sub", text: "(" + c.name + (c.source !== "wikidata" ? "・" + (CLAN_SOURCE_LABEL[c.source] || "推定") : "") + (c.multiple ? "・複数の氏あり" : "") + ")" }) : el("span", { class: "sub", text: "(氏の情報なし)" })]));
        if (st.others.length) box.append(el("p", { class: "sub", text: "この年に交代: 前任 " + st.others.map((t) => M.lords.get(t.lord).name).join("、") }));
      } else if (st.status === "gap") {
        box.append(el("p", { class: "warn-note", text: state.year + "年の在任者はデータにありません(Wikidata 上の空白)。" }));
      }
      box.append(el("h4", { text: "歴代藩主" }));
      const ul = el("ul", { class: "lords" });
      M.tenuresOf(id).forEach((t) => {
        const l = M.lords.get(t.lord); if (!l) return;
        const cur = st.status === "holder" && st.tenure === t;
        ul.append(el("li", { class: cur ? "cur" : "" }, [
          el("span", { class: "ord", text: t.ord ? t.ord + "代" : "–" }), lordLink(l, t),
          el("span", { class: "sub", text: " " + (t.start || "?") + "–" + (t.end || "?") })]));
      });
      box.append(ul);
      box.append(el("p", {}, [el("a", { class: "btn", href: "tree.html?domain=" + encodeURIComponent(id), text: "この藩の家系図を見る" }), " ",
        el("a", { href: wikidataUrl(id), target: "_blank", rel: "noopener", class: "sub", text: "Wikidata" })]));
    }
    function lordLink(l, t) {
      return el("a", { href: "tree.html?domain=" + encodeURIComponent(t.domain) + "&lord=" + encodeURIComponent(l.id), text: l.name });
    }

    // 座標を持たない藩は地図に出せないので、隠さずに一覧する。
    const missing = data.domains.filter((d) => !d.coord && d.scope === "tohoku").sort((a, b) => a.name.localeCompare(b.name, "ja"));
    $("missingCount").textContent = missing.length;
    missing.forEach((d) => $("missing").append(el("li", {}, [el("a", { href: "tree.html?domain=" + encodeURIComponent(d.id), text: d.name }),
      el("span", { class: "sub", text: " " + (d.first_year || "?") + "–" + (d.last_year || "?") })])));

    const slider = $("year");
    slider.min = Y0; slider.max = Y1; slider.value = state.year;
    slider.addEventListener("input", () => { state.year = +slider.value; paint(); });
    document.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => {
      state.year = Math.min(Y1, Math.max(Y0, state.year + +b.dataset.step)); slider.value = state.year; paint(); }));
    // 自動再生: 一定間隔で年を進める。年は小数で持ち(acc)、表示するときだけ整数に丸める。
    // 理由: 「8年/秒」を 100ms ごとの整数加算で表すと端数が出るため、時間に比例して進める。
    let timer = null, acc = state.year, last = 0;
    const playBtn = $("play");
    function setPlaying(on) {
      if (on === !!timer) return;
      if (on) {
        if (state.year >= Y1) { state.year = Y0; slider.value = Y0; paint(); }   // 終端から押したら最初に戻る
        acc = state.year; last = performance.now();
        timer = setInterval(() => {
          const now = performance.now();
          acc += (now - last) / 1000 * +$("speed").value; last = now;
          const y = Math.min(Y1, Math.floor(acc));
          if (y !== state.year) { state.year = y; slider.value = y; paint(); }
          if (acc >= Y1) setPlaying(false);
        }, 80);
      } else { clearInterval(timer); timer = null; }
      playBtn.textContent = on ? "⏸ 停止" : "▶ 再生";
      playBtn.setAttribute("aria-pressed", on ? "true" : "false");
    }
    playBtn.addEventListener("click", () => setPlaying(!timer));
    // 手動で年を動かしたら再生は止める(スライダー・±ボタン)。
    slider.addEventListener("pointerdown", () => setPlaying(false));
    document.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => setPlaying(false)));
    document.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(document.activeElement.tagName)) { e.preventDefault(); setPlaying(!timer); }
    });
    $("showFaces").addEventListener("change", (e) => { state.showFaces = e.target.checked; paint(); });
    $("showExternal").addEventListener("change", (e) => { state.showExternal = e.target.checked; paint(); });
    $("clearClan").addEventListener("click", () => { state.clan = ""; paint(); });

    // URL の指定を反映する: ?domain=藩のQID / ?lord=人物のQID / ?year=年。
    // 家系図ページの「地図で見る」「この藩を地図で見る」から来たときに、その藩を選び、その人が藩主だった年に合わせる。
    (function applyUrl() {
      const p = new URLSearchParams(location.search);
      const clamp = (y) => Math.min(Y1, Math.max(Y0, y));
      let domId = p.get("domain");
      let year = parseInt(p.get("year"), 10);          // 指定が無ければ NaN
      const lord = M.lords.get(p.get("lord"));
      if (lord) {
        // その人の在任のうち、地図に出せる(座標がある)東北の藩を優先し、その中で最も早いものを選ぶ。
        const ts = data.tenures.filter((t) => t.lord === lord.id && M.domains.has(t.domain) && (!domId || t.domain === domId));
        const rank = (t) => { const d = M.domains.get(t.domain); return (d.coord ? 0 : 2) + (d.scope === "tohoku" ? 0 : 1); };
        ts.sort((a, b) => rank(a) - rank(b) || (a.start || 9999) - (b.start || 9999));
        if (ts.length) {
          domId = ts[0].domain;
          if (isNaN(year)) year = ts[0].start || ts[0].end || NaN;
        } else if (!domId) {
          $("detail").replaceChildren(el("p", { class: "warn-note", text: lord.name + " は藩主としての在任がデータにないため、地図上の位置がありません。" }));
        }
      }
      if (!isNaN(year)) state.year = clamp(year);
      const d = M.domains.get(domId);
      if (!d) return;
      // 年の指定が無く、既定の年にその藩の藩主がいないときは、その藩の最初の年に合わせる(藩が地図に出るように)。
      if (isNaN(year) && M.stateAt(d.id, state.year).status !== "holder" && d.first_year) state.year = clamp(d.first_year);
      if (d.scope !== "tohoku") { state.showExternal = true; $("showExternal").checked = true; }
      state.selected = d.id;
      if (d.coord) map.setView([d.coord.lat, d.coord.lon], 9);
    })();
    slider.value = state.year;
    paint();

    // 肖像の先読み: 再生中に藩主が替わるたび画像を取りに行くと、表示が遅れる。
    // 最初の描画のあと、地図に出る藩の歴代藩主の肖像を、同時4本までで裏で読み込んでおく(ブラウザのキャッシュに載る)。
    // 現在の年の藩主を先頭にして、次に年代順で読み込む。
    (function preload() {
      const urls = [];
      const seen = new Set();
      const add = (lord) => {
        if (!lord || !lord.image || !lord.image.display) return;
        const u = thumb(lord);
        if (!seen.has(u)) { seen.add(u); urls.push(u); }
      };
      placeable.forEach((d) => { const st = M.stateAt(d.id, state.year); if (st.status === "holder") add(M.lords.get(st.tenure.lord)); });
      placeable.forEach((d) => M.tenuresOf(d.id).forEach((t) => add(M.lords.get(t.lord))));
      let next = 0, active = 0;
      const pump = () => {
        while (active < 4 && next < urls.length) {
          const img = new Image();
          active++;
          img.onload = img.onerror = () => { active--; pump(); };
          img.src = urls[next++];
        }
      };
      window.addEventListener("load", () => setTimeout(pump, 300));
      if (document.readyState === "complete") setTimeout(pump, 300);
    })();
    $("generated").textContent = (data.meta && data.meta.generated_at) ? "データ生成: " + data.meta.generated_at.slice(0, 10) : "";
  }

  document.addEventListener("DOMContentLoaded", init);
})();
