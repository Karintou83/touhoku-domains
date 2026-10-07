/* 画像クレジット一覧: lords.json から、表示している肖像の作者・ライセンスを一覧にする。 */
(async function () {
  const { el, wikipediaUrl, showError } = Tohoku;
  let lords;
  try { lords = await (await fetch("data/lords.json")).json(); } catch (e) { showError(String(e)); return; }
  const shown = lords.filter((l) => l.image && l.image.display).sort((a, b) => a.name.localeCompare(b.name, "ja"));
  document.getElementById("credit-count").textContent = "(" + shown.length + "点)";
  const ul = document.getElementById("credits");
  shown.forEach((l) => {
    const im = l.image;
    const page = im.page_url || "https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(im.file.replace(/ /g, "_"));
    const lic = im.license_url ? el("a", { href: im.license_url, target: "_blank", rel: "noopener", text: im.license })
                               : el("span", { text: im.license || "" });
    const thumb = Tohoku.imageUrl(im, 128);
    ul.append(el("li", {}, [
      el("img", { src: thumb, alt: l.name + "の肖像", loading: "lazy", width: "64", height: "80" }),
      el("div", {}, [
        el("b", {}, [l.wikipedia ? el("a", { href: wikipediaUrl(l.wikipedia), target: "_blank", rel: "noopener", text: l.name }) : l.name]),
        el("a", { href: page, target: "_blank", rel: "noopener", text: im.file }),
        el("div", { text: "作者: " + (im.author || "不明") }),
        el("div", {}, ["ライセンス: ", lic]),
      ]),
    ]));
  });
})();
