/* Povoado · Consulta Territorial — app principal
   Dados: Plataforma Povoado (Tô no Mapa), extração 28/07/2026 */
"use strict";

/* ============================== estado ============================== */
const S = {
  municipios: null,      // FeatureCollection
  comunidades: null,     // array plano
  cerrado: null,
  porCod: new Map(),     // cod -> feature
  bboxes: new Map(),     // cod -> [minx,miny,maxx,maxy]
  abaAtiva: "filtros",
  ufsSel: new Set(),
  munsSel: new Map(),    // cod -> nome
  segsSel: new Set(),
  resultado: null,       // { coms, codsSel, criterios }
  ordem: { col: "nome", asc: true },
};

const DATA_EXTRACAO = "28/07/2026";
const CORES_DONUT = ["#F76707", "#2E8B57", "#556B2F", "#22C55E", "#E85F00", "#FF7A45", "#8a8a8a", "#c9b98a"];

/* ============================== utilidades ============================== */
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const fmt = (n) => n.toLocaleString("pt-BR");
const norm = (s) => (s || "").toString().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/* ============================== geometria ============================== */
// normaliza geometria GeoJSON -> lista de polígonos [ [anelExterno, ...buracos], ... ]
function polysDe(geom) {
  if (!geom) return [];
  if (geom.type === "Polygon") return [geom.coordinates];
  if (geom.type === "MultiPolygon") return geom.coordinates;
  if (geom.type === "GeometryCollection") return (geom.geometries || []).flatMap(polysDe);
  return [];
}
function bboxDePolys(polys) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const poly of polys) for (const [x, y] of poly[0]) {
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
  return [minx, miny, maxx, maxy];
}
const bboxCruza = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

function pontoEmAnel(px, py, anel) {
  let dentro = false;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const xi = anel[i][0], yi = anel[i][1], xj = anel[j][0], yj = anel[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}
function pontoEmPolys(px, py, polys) {
  for (const poly of polys) {
    if (pontoEmAnel(px, py, poly[0])) {
      let emBuraco = false;
      for (let h = 1; h < poly.length; h++) if (pontoEmAnel(px, py, poly[h])) { emBuraco = true; break; }
      if (!emBuraco) return true;
    }
  }
  return false;
}
function segCruza(p1, p2, p3, p4) {
  const d = (a, b, c) => (c[0] - a[0]) * (b[1] - a[1]) - (b[0] - a[0]) * (c[1] - a[1]);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
// teste de interseção entre dois conjuntos de polígonos (com pré-filtro por bbox)
function polysIntersectam(A, B, bbA, bbB) {
  if (!bboxCruza(bbA, bbB)) return false;
  for (const poly of A) for (const [x, y] of poly[0]) if (pontoEmPolys(x, y, B)) return true;
  for (const poly of B) for (const [x, y] of poly[0]) if (pontoEmPolys(x, y, A)) return true;
  for (const pa of A) for (const anelA of pa) {
    for (let i = 0; i < anelA.length - 1; i++) {
      const a1 = anelA[i], a2 = anelA[i + 1];
      const sminx = Math.min(a1[0], a2[0]), smaxx = Math.max(a1[0], a2[0]);
      const sminy = Math.min(a1[1], a2[1]), smaxy = Math.max(a1[1], a2[1]);
      if (smaxx < bbB[0] || sminx > bbB[2] || smaxy < bbB[1] || sminy > bbB[3]) continue;
      for (const pb of B) for (const anelB of pb)
        for (let j = 0; j < anelB.length - 1; j++)
          if (segCruza(a1, a2, anelB[j], anelB[j + 1])) return true;
    }
  }
  return false;
}

/* ============================== mapa ============================== */
let mapa, camadaMunicipios, camadaCerrado, drawnItems, camadaArquivo, drawControl;

function corDensidade(n) {
  if (n === 0) return "rgba(255,122,69,0.18)";
  if (n <= 2) return "rgba(255,122,69,0.4)";
  if (n <= 5) return "rgba(255,122,69,0.6)";
  if (n <= 10) return "rgba(255,122,69,0.8)";
  return "#FF7A45";
}
function estiloMunicipio(f) {
  const cods = S.resultado ? S.resultado.codsSel : null;
  const sel = cods && cods.has(f.properties.cod);
  return {
    color: sel ? "#E85F00" : "#666",
    weight: sel ? 1.6 : 0.3,
    fillColor: corDensidade(f.properties.ncom),
    fillOpacity: cods ? (sel ? 0.95 : 0.12) : 0.85,
  };
}

function traduzDraw() {
  L.drawLocal.draw.toolbar.buttons.polygon = "Desenhar polígono";
  L.drawLocal.draw.toolbar.buttons.rectangle = "Desenhar retângulo";
  L.drawLocal.draw.toolbar.actions = { title: "Cancelar", text: "Cancelar" };
  L.drawLocal.draw.toolbar.finish = { title: "Concluir", text: "Concluir" };
  L.drawLocal.draw.toolbar.undo = { title: "Apagar último ponto", text: "Apagar último ponto" };
  L.drawLocal.draw.handlers.polygon.tooltip = {
    start: "Clique para começar o polígono.",
    cont: "Clique para continuar.",
    end: "Clique no primeiro ponto para fechar.",
  };
  L.drawLocal.draw.handlers.rectangle.tooltip = { start: "Clique e arraste para desenhar." };
  L.drawLocal.draw.handlers.simpleshape = { tooltip: { end: "Solte para concluir." } };
  L.drawLocal.edit.toolbar.buttons = {
    edit: "Editar desenhos", editDisabled: "Nada para editar",
    remove: "Apagar desenhos", removeDisabled: "Nada para apagar",
  };
  L.drawLocal.edit.toolbar.actions = {
    save: { title: "Salvar", text: "Salvar" },
    cancel: { title: "Cancelar", text: "Cancelar" },
    clearAll: { title: "Apagar tudo", text: "Apagar tudo" },
  };
  L.drawLocal.edit.handlers.edit.tooltip = { text: "Arraste os vértices para editar.", subtext: "Clique em Cancelar para desfazer." };
  L.drawLocal.edit.handlers.remove.tooltip = { text: "Clique num desenho para removê-lo." };
}

function iniciaMapa() {
  mapa = L.map("mapa", { preferCanvas: true, zoomControl: true });
  // Esri Light Gray (sem chave). O CARTO passou a exigir chave e devolve um
  // tile-placeholder "API KEY REQUIRED" com HTTP 200. Ordem Esri: {z}/{y}/{x}.
  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/";
  const atribEsri = "Esri, HERE, Garmin, &copy; OpenStreetMap contributors";
  L.tileLayer(ESRI + "World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
    attribution: atribEsri, maxZoom: 18, maxNativeZoom: 16,
  }).addTo(mapa);
  // rótulos num pane acima dos municípios, para não ficarem cobertos pelo preenchimento
  mapa.createPane("rotulos");
  mapa.getPane("rotulos").style.zIndex = 450;
  mapa.getPane("rotulos").style.pointerEvents = "none";
  L.tileLayer(ESRI + "World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
    pane: "rotulos", maxZoom: 18, maxNativeZoom: 16,
  }).addTo(mapa);

  camadaCerrado = L.geoJSON(S.cerrado, { style: { color: "#2E8B57", weight: 1.6, fill: false } }).addTo(mapa);
  camadaMunicipios = L.geoJSON(S.municipios, {
    style: estiloMunicipio,
    onEachFeature: (f, lyr) => {
      lyr.bindPopup(`<strong>${f.properties.nome} – ${f.properties.uf}</strong><br>${fmt(f.properties.ncom)} comunidade(s) na base`);
    },
  }).addTo(mapa);
  mapa.fitBounds(camadaCerrado.getBounds(), { padding: [10, 10] });

  traduzDraw();
  drawnItems = new L.FeatureGroup().addTo(mapa);
  camadaArquivo = new L.FeatureGroup().addTo(mapa);
  drawControl = new L.Control.Draw({
    position: "topleft",
    draw: { polyline: false, circle: false, circlemarker: false, marker: false,
      polygon: { allowIntersection: false, shapeOptions: { color: "#E85F00", weight: 2 } },
      rectangle: { shapeOptions: { color: "#E85F00", weight: 2 } } },
    edit: { featureGroup: drawnItems },
  });
  mapa.addControl(drawControl);
  mapa.on(L.Draw.Event.CREATED, (e) => {
    drawnItems.addLayer(e.layer);
    ativaAba("desenho");
    atualizaStatusDesenho();
  });
  mapa.on(L.Draw.Event.DELETED, atualizaStatusDesenho);
  mapa.on(L.Draw.Event.EDITED, atualizaStatusDesenho);
}

function atualizaStatusDesenho() {
  const n = drawnItems.getLayers().length;
  $("#status-desenho").textContent = n ? `${n} desenho(s) no mapa.` : "";
}

/* ============================== painel ============================== */
function montaPainel() {
  // UFs
  const ufs = [...new Set(S.municipios.features.map((f) => f.properties.uf))].sort();
  const caixa = $("#lista-ufs");
  for (const uf of ufs) {
    const b = el("button", "chip-uf", uf);
    b.onclick = () => { b.classList.toggle("ativo"); b.classList.contains("ativo") ? S.ufsSel.add(uf) : S.ufsSel.delete(uf); };
    caixa.appendChild(b);
  }
  // municípios (autocomplete)
  const inp = $("#busca-mun"), sug = $("#sugestoes-mun");
  inp.addEventListener("input", () => {
    sug.innerHTML = "";
    const q = norm(inp.value);
    if (q.length < 2) return;
    const achados = S.municipios.features
      .filter((f) => norm(f.properties.nome).includes(q) && !S.munsSel.has(f.properties.cod))
      .slice(0, 12);
    if (!achados.length) return;
    const lista = el("div", "lista");
    for (const f of achados) {
      const item = el("div", "item", `${f.properties.nome} – ${f.properties.uf} <span style="color:#999">(${f.properties.ncom})</span>`);
      item.onclick = () => { S.munsSel.set(f.properties.cod, `${f.properties.nome} – ${f.properties.uf}`); inp.value = ""; sug.innerHTML = ""; desenhaChipsMun(); };
      lista.appendChild(item);
    }
    sug.appendChild(lista);
  });
  document.addEventListener("click", (e) => { if (!sug.contains(e.target) && e.target !== inp) sug.innerHTML = ""; });

  // segmentos
  const cont = {};
  for (const c of S.comunidades) cont[c.seg] = (cont[c.seg] || 0) + 1;
  const segsOrd = Object.entries(cont).sort((a, b) => b[1] - a[1]);
  const cx = $("#lista-segmentos");
  for (const [seg, n] of segsOrd) {
    const lab = el("label", null, `<input type="checkbox" value="${seg.replace(/"/g, "&quot;")}"> ${seg} <span class="qtd">${fmt(n)}</span>`);
    lab.querySelector("input").onchange = (e) => { e.target.checked ? S.segsSel.add(seg) : S.segsSel.delete(seg); };
    cx.appendChild(lab);
  }

  // abas
  document.querySelectorAll(".aba").forEach((b) => (b.onclick = () => ativaAba(b.dataset.aba)));

  // arquivo
  $("#arquivo-input").addEventListener("change", carregaArquivo);
  $("#limpar-desenho").onclick = () => { drawnItems.clearLayers(); atualizaStatusDesenho(); };

  $("#btn-consultar").onclick = consultar;
  $("#btn-limpar").onclick = limparTudo;

  // guia do usuário
  const guia = $("#guia-fundo");
  $("#btn-guia").onclick = () => guia.classList.remove("oculta");
  $("#guia-fechar").onclick = () => guia.classList.add("oculta");
  guia.addEventListener("click", (e) => { if (e.target === guia) guia.classList.add("oculta"); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") guia.classList.add("oculta"); });
}

function ativaAba(nome) {
  S.abaAtiva = nome;
  document.querySelectorAll(".aba").forEach((b) => b.classList.toggle("ativa", b.dataset.aba === nome));
  document.querySelectorAll(".aba-conteudo").forEach((d) => d.classList.add("oculta"));
  $("#aba-" + nome).classList.remove("oculta");
}

function desenhaChipsMun() {
  const cx = $("#chips-mun");
  cx.innerHTML = "";
  for (const [cod, nome] of S.munsSel) {
    const chip = el("span", "chip-mun", `${nome} <b title="Remover">×</b>`);
    chip.querySelector("b").onclick = () => { S.munsSel.delete(cod); desenhaChipsMun(); };
    cx.appendChild(chip);
  }
}

async function carregaArquivo(ev) {
  const arq = ev.target.files[0];
  const st = $("#status-arquivo");
  if (!arq) return;
  st.className = "status"; st.textContent = "Lendo arquivo…";
  camadaArquivo.clearLayers();
  try {
    let gj;
    if (/\.zip$/i.test(arq.name)) {
      gj = await shp(await arq.arrayBuffer());
    } else {
      gj = JSON.parse(await arq.text());
    }
    const fcs = Array.isArray(gj) ? gj : [gj];
    const feats = [];
    for (const fc of fcs) {
      const fs = fc.type === "FeatureCollection" ? fc.features : fc.type === "Feature" ? [fc] : [{ type: "Feature", properties: {}, geometry: fc }];
      for (const f of fs) if (f.geometry && polysDe(f.geometry).length) feats.push(f);
    }
    if (!feats.length) throw new Error("Nenhum polígono encontrado no arquivo.");
    const camada = L.geoJSON({ type: "FeatureCollection", features: feats }, { style: { color: "#E85F00", weight: 2, dashArray: "6 4", fillOpacity: 0.08 } });
    camadaArquivo.addLayer(camada);
    mapa.fitBounds(camada.getBounds(), { padding: [20, 20] });
    st.textContent = `${feats.length} polígono(s) carregado(s) de “${arq.name}”.`;
    ativaAba("arquivo");
  } catch (e) {
    st.className = "status erro";
    st.textContent = "Erro ao ler o arquivo: " + (e.message || e);
  }
}

/* ============================== consulta ============================== */
function geomDaSelecaoEspacial() {
  const grupo = S.abaAtiva === "desenho" ? drawnItems : camadaArquivo;
  const gj = grupo.toGeoJSON();
  const polys = gj.features.flatMap((f) => polysDe(f.geometry));
  return polys.length ? polys : null;
}

function consultar() {
  const criterios = [];
  let codsSel;

  if (S.abaAtiva === "desenho" || S.abaAtiva === "arquivo") {
    const polys = geomDaSelecaoEspacial();
    if (!polys) {
      alert(S.abaAtiva === "desenho" ? "Desenhe um polígono no mapa antes de consultar." : "Carregue um arquivo com polígonos antes de consultar.");
      return;
    }
    const bbQ = bboxDePolys(polys);
    codsSel = new Set();
    for (const f of S.municipios.features) {
      const polysM = polysDe(f.geometry);
      if (polysIntersectam(polys, polysM, bbQ, S.bboxes.get(f.properties.cod))) codsSel.add(f.properties.cod);
    }
    criterios.push(S.abaAtiva === "desenho" ? "área desenhada no mapa" : "área do arquivo enviado");
  } else {
    codsSel = new Set(S.municipios.features.map((f) => f.properties.cod));
    if (S.ufsSel.size) {
      codsSel = new Set(S.municipios.features.filter((f) => S.ufsSel.has(f.properties.uf)).map((f) => f.properties.cod));
      criterios.push("estados: " + [...S.ufsSel].sort().join(", "));
    }
    if (S.munsSel.size) {
      const apenas = new Set(S.munsSel.keys());
      codsSel = S.ufsSel.size ? new Set([...codsSel].filter((c) => apenas.has(c))) : apenas;
      criterios.push("municípios: " + [...S.munsSel.values()].join("; "));
    }
    if (!S.ufsSel.size && !S.munsSel.size) criterios.push("todo o bioma Cerrado");
  }

  let coms = S.comunidades.filter((c) => codsSel.has(c.cod));
  if (S.segsSel.size) { coms = coms.filter((c) => S.segsSel.has(c.seg)); criterios.push("segmentos: " + [...S.segsSel].join(", ")); }
  const qNome = norm($("#busca-nome").value.trim());
  if (qNome) { coms = coms.filter((c) => norm(c.nome).includes(qNome)); criterios.push(`nome contém “${$("#busca-nome").value.trim()}”`); }
  if ($("#so-matopiba").checked) { coms = coms.filter((c) => c.mat); criterios.push("somente MATOPIBA"); }

  // municípios efetivamente com comunidade no resultado
  const codsComResultado = new Set(coms.map((c) => c.cod));
  S.resultado = { coms, codsSel: codsComResultado, criterios };
  camadaMunicipios.setStyle(estiloMunicipio);
  montaRelatorio();
}

function limparTudo() {
  S.ufsSel.clear(); S.munsSel.clear(); S.segsSel.clear(); S.resultado = null;
  document.querySelectorAll(".chip-uf").forEach((b) => b.classList.remove("ativo"));
  document.querySelectorAll("#lista-segmentos input").forEach((i) => (i.checked = false));
  $("#busca-nome").value = ""; $("#so-matopiba").checked = false; $("#busca-mun").value = "";
  desenhaChipsMun();
  drawnItems.clearLayers(); camadaArquivo.clearLayers();
  $("#arquivo-input").value = ""; $("#status-arquivo").textContent = ""; atualizaStatusDesenho();
  camadaMunicipios.setStyle(estiloMunicipio);
  $("#relatorio").classList.add("oculta");
  mapa.fitBounds(camadaCerrado.getBounds(), { padding: [10, 10] });
}

/* ============================== relatório ============================== */
function agrupa(arr, chave) {
  const m = new Map();
  for (const x of arr) { const k = chave(x); m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function montaRelatorio() {
  const { coms, codsSel, criterios } = S.resultado;
  const rel = $("#relatorio");
  rel.classList.remove("oculta");

  $("#rel-data").textContent = `Gerado em ${new Date().toLocaleDateString("pt-BR")} · Base extraída em ${DATA_EXTRACAO}`;
  $("#rel-criterios").textContent = "Critérios: " + criterios.join(" · ");

  const munsRes = agrupa(coms, (c) => `${c.mun} – ${c.uf}`);
  const ufsRes = agrupa(coms, (c) => c.uf);
  const segsRes = agrupa(coms, (c) => c.seg);
  const nMat = coms.filter((c) => c.mat).length;

  const refsUnicas = new Set();
  const tiposFonte = new Map();
  let semRef = 0;
  for (const c of coms) {
    let temRef = false;
    for (const r of c.refs) {
      const ehSem = norm(r.b).includes("sem referencia");
      if (!ehSem) { refsUnicas.add(r.b); temRef = true; }
      const t = r.t || "Não informado";
      tiposFonte.set(t, (tiposFonte.get(t) || 0) + 1);
    }
    if (!temRef) semRef++;
  }
  const fontesOrd = [...tiposFonte.entries()].sort((a, b) => b[1] - a[1]);

  // cards
  const cards = $("#rel-cards");
  cards.innerHTML = "";
  const cardsDef = [
    [fmt(coms.length), "Comunidades identificadas", false],
    [fmt(codsSel.size), "Municípios com comunidades", true],
    [fmt(ufsRes.length), "Estados", true],
    [fmt(segsRes.length), "Segmentos", false],
    [fmt(refsUnicas.size), "Referências bibliográficas únicas", true],
    [coms.length ? Math.round((100 * nMat) / coms.length) + "%" : "—", "Em território MATOPIBA", false],
  ];
  for (const [v, n, verde] of cardsDef) {
    const c = el("div", "card" + (verde ? " verde" : ""));
    c.appendChild(el("div", "valor", v));
    c.appendChild(el("div", "nome", n));
    cards.appendChild(c);
  }

  // texto resumo
  const top3seg = segsRes.slice(0, 3).map(([s, n]) => `${s} (${fmt(n)})`).join(", ");
  const top3mun = munsRes.slice(0, 3).map(([m, n]) => `${m} (${fmt(n)})`).join(", ");
  const pctComRef = coms.length ? Math.round((100 * (coms.length - semRef)) / coms.length) : 0;
  $("#rel-texto").innerHTML =
    coms.length === 0
      ? "Nenhuma comunidade foi encontrada com os critérios informados. Amplie a área da consulta ou remova filtros."
      : `A consulta identificou <strong>${fmt(coms.length)} comunidades tradicionais</strong> em ` +
        `<strong>${fmt(codsSel.size)} municípios</strong> de <strong>${ufsRes.length} estado(s)</strong> ` +
        `(${ufsRes.map(([u, n]) => `${u}: ${fmt(n)}`).join("; ")}). ` +
        `Foram registrados <strong>${segsRes.length} segmentos</strong> de povos e comunidades tradicionais — os mais numerosos são ${top3seg}. ` +
        `Os municípios com maior número de comunidades são ${top3mun}. ` +
        `${fmt(nMat)} comunidades (${coms.length ? Math.round((100 * nMat) / coms.length) : 0}%) estão em municípios da região do MATOPIBA. ` +
        `${pctComRef}% das comunidades possuem ao menos uma referência bibliográfica, somando ${fmt(refsUnicas.size)} referências únicas.`;

  // gráficos
  desenhaBarras($("#graf-segmentos"), segsRes.slice(0, 12), coms.length, false);
  desenhaBarras($("#graf-ufs"), ufsRes, coms.length, true);
  desenhaBarras($("#graf-municipios"), munsRes.slice(0, 10), coms.length, false);
  desenhaDonut($("#graf-fontes"), fontesOrd);

  montaTabela(coms);
  rel.scrollIntoView({ behavior: "smooth" });
}

function desenhaBarras(cont, dados, total, verde) {
  cont.innerHTML = "";
  if (!dados.length) { cont.appendChild(el("p", "dica", "Sem dados.")); return; }
  const max = dados[0][1];
  for (const [nome, n] of dados) {
    const linha = el("div", "barra-linha");
    linha.appendChild(el("div", "nome-barra", nome));
    const trilha = el("div", "barra-trilha");
    const bar = el("div", "barra-preenchida" + (verde ? " verde" : ""));
    bar.style.width = Math.max(2, (100 * n) / max) + "%";
    trilha.appendChild(bar);
    linha.appendChild(trilha);
    linha.appendChild(el("div", "valor-barra", fmt(n)));
    cont.appendChild(linha);
  }
}

function desenhaDonut(cont, dados) {
  cont.innerHTML = "";
  if (!dados.length) { cont.appendChild(el("p", "dica", "Sem dados.")); return; }
  const total = dados.reduce((a, [, n]) => a + n, 0);
  const R = 52, C = 2 * Math.PI * R;
  let acumulado = 0;
  let circulos = "";
  dados.forEach(([nome, n], i) => {
    const frac = n / total;
    const cor = CORES_DONUT[i % CORES_DONUT.length];
    circulos += `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${cor}" stroke-width="26"
      stroke-dasharray="${(frac * C).toFixed(2)} ${C.toFixed(2)}"
      stroke-dashoffset="${(-acumulado * C).toFixed(2)}" transform="rotate(-90 70 70)"></circle>`;
    acumulado += frac;
  });
  const caixa = el("div", "donut-caixa");
  caixa.innerHTML = `<svg width="140" height="140" viewBox="0 0 140 140">${circulos}
    <text x="70" y="66" text-anchor="middle" font-size="17" font-weight="800" fill="#444">${fmt(total)}</text>
    <text x="70" y="82" text-anchor="middle" font-size="9" fill="#888">referências</text></svg>`;
  const leg = el("div", "donut-legenda");
  dados.forEach(([nome, n], i) => {
    leg.appendChild(el("div", null, `<i style="background:${CORES_DONUT[i % CORES_DONUT.length]}"></i> ${nome} — <strong>${fmt(n)}</strong> (${Math.round((100 * n) / total)}%)`));
  });
  caixa.appendChild(leg);
  cont.appendChild(caixa);
}

/* ---------- tabela ---------- */
function montaTabela(coms) {
  const dados = coms.map((c) => ({ nome: c.nome, seg: c.seg, mun: c.mun, uf: c.uf, mat: c.mat, nrefs: c.refs.filter((r) => !norm(r.b).includes("sem referencia")).length }));
  const tbody = $("#tabela-comunidades tbody");
  const filtro = $("#tab-filtro");
  filtro.value = "";

  const render = () => {
    const q = norm(filtro.value);
    let linhas = q ? dados.filter((d) => norm(d.nome + " " + d.seg + " " + d.mun + " " + d.uf).includes(q)) : dados.slice();
    const { col, asc } = S.ordem;
    linhas.sort((a, b) => {
      const va = a[col], vb = b[col];
      const r = typeof va === "number" || typeof va === "boolean" ? va - vb : String(va).localeCompare(String(vb), "pt-BR");
      return asc ? r : -r;
    });
    $("#tab-contagem").textContent = `(${fmt(linhas.length)})`;
    tbody.innerHTML = linhas
      .map((d) => `<tr><td>${d.nome}</td><td>${d.seg}</td><td>${d.mun}</td><td>${d.uf}</td>
        <td>${d.mat ? '<span class="tag-mat">MATOPIBA</span>' : ""}</td><td>${d.nrefs}</td></tr>`)
      .join("");
  };
  filtro.oninput = render;
  document.querySelectorAll("#tabela-comunidades th").forEach((th) => {
    th.onclick = () => {
      const col = th.dataset.col;
      S.ordem = { col, asc: S.ordem.col === col ? !S.ordem.asc : true };
      render();
    };
  });
  render();
}

/* ---------- downloads ---------- */
function baixaArquivo(nome, conteudo, tipo) {
  const blob = new Blob([conteudo], { type: tipo });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  URL.revokeObjectURL(a.href);
}

function montaDownloads() {
  $("#dl-csv").onclick = () => {
    if (!S.resultado) return;
    const linhas = [["Comunidade", "Segmento", "Município", "UF", "MATOPIBA", "Nº referências", "Referências (tipo)"].join(";")];
    for (const c of S.resultado.coms) {
      const refs = c.refs.filter((r) => !norm(r.b).includes("sem referencia"));
      linhas.push([
        `"${c.nome.replace(/"/g, '""')}"`, `"${c.seg}"`, `"${c.mun}"`, c.uf,
        c.mat ? "Sim" : "Não", refs.length,
        `"${refs.map((r) => `${r.b} [${r.t || "s/ tipo"}]`).join(" | ").replace(/"/g, '""')}"`,
      ].join(";"));
    }
    baixaArquivo("povoado_comunidades.csv", "﻿" + linhas.join("\r\n"), "text/csv;charset=utf-8");
  };
  $("#dl-geojson").onclick = () => {
    if (!S.resultado) return;
    const porCod = new Map();
    for (const c of S.resultado.coms) porCod.set(c.cod, (porCod.get(c.cod) || 0) + 1);
    const feats = S.municipios.features
      .filter((f) => S.resultado.codsSel.has(f.properties.cod))
      .map((f) => ({ ...f, properties: { ...f.properties, ncom_consulta: porCod.get(f.properties.cod) || 0 } }));
    baixaArquivo("povoado_municipios_consulta.geojson", JSON.stringify({ type: "FeatureCollection", features: feats }), "application/geo+json");
  };
  $("#dl-pdf").onclick = () => window.print();
}

/* ============================== boot ============================== */
async function boot() {
  const [mun, com, cer] = await Promise.all([
    fetch("dados/municipios.geojson").then((r) => r.json()),
    fetch("dados/comunidades.json").then((r) => r.json()),
    fetch("dados/cerrado.geojson").then((r) => r.json()),
  ]);
  S.municipios = mun; S.comunidades = com; S.cerrado = cer;
  for (const f of mun.features) {
    S.porCod.set(f.properties.cod, f);
    S.bboxes.set(f.properties.cod, bboxDePolys(polysDe(f.geometry)));
  }
  iniciaMapa();
  montaPainel();
  montaDownloads();
}
boot().catch((e) => {
  document.body.insertAdjacentHTML("afterbegin",
    `<div style="background:#c0392b;color:#fff;padding:10px 20px;font-family:sans-serif">Erro ao carregar os dados: ${e.message || e}</div>`);
  console.error(e);
});
