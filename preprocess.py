# -*- coding: utf-8 -*-
"""Pré-processa os dados brutos da Plataforma Povoado (Tô no Mapa) em
arquivos compactos para o app estático:
  - dados/municipios.geojson  (1 feature por município, com contagem de comunidades)
  - dados/comunidades.json    (lista plana de comunidades, chaveada por codigo_mun)
  - dados/cerrado.geojson     (limite do bioma, simplificado)
"""
import json
from pathlib import Path

from shapely.geometry import shape, mapping
from shapely.validation import make_valid

BASE = Path(__file__).parent / "dados"

raw = json.loads((BASE / "dados_raw.json").read_text(encoding="utf-8"))

feats = []
comunidades = []
n_com_check = 0
for uf in raw:
    for mun in uf["municipios"]:
        cod = mun["codigo_mun"]
        coms = mun.get("comunidades") or []
        n_com_check += len(coms)
        for c in coms:
            comunidades.append({
                "cod": cod,
                "mun": mun["nome_mun"],
                "uf": uf["sigla"],
                "nome": c["nome_com"],
                "seg": c["nome_segmento"],
                "mat": bool(c.get("matopiba")),
                "refs": [
                    {"b": r.get("ref_biblio"), "t": r.get("tipo_biblio"), "f": r.get("busca")}
                    for r in (c.get("referencias") or [])
                ],
            })
        # geometria: o "feature" bruto é a própria geometria (MultiPolygon)
        gj = mun.get("geojson")
        geom = None
        if gj and gj.get("features"):
            g = next((x for x in gj["features"] if x and x.get("type")), None)
            if g is not None:
                if g.get("type") == "Feature":
                    g = g.get("geometry")
                if g and g.get("type"):
                    geom = shape(g)
                    if not geom.is_valid:
                        geom = make_valid(geom)
        feats.append({
            "type": "Feature",
            "properties": {
                "cod": cod,
                "nome": mun["nome_mun"],
                "uf": uf["sigla"],
                "nome_uf": uf["nome_uf"],
                "ncom": len(coms),
            },
            "geometry": mapping(geom) if geom is not None else None,
        })

fc = {"type": "FeatureCollection", "features": feats}

def compact(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"))

# arredonda coordenadas para 5 casas (~1 m) para reduzir tamanho
def round_coords(obj, nd=5):
    if isinstance(obj, list):
        return [round_coords(x, nd) for x in obj]
    if isinstance(obj, float):
        return round(obj, nd)
    return obj

for f in fc["features"]:
    if f["geometry"]:
        f["geometry"]["coordinates"] = round_coords(f["geometry"]["coordinates"])

(BASE / "municipios.geojson").write_text(compact(fc), encoding="utf-8")
(BASE / "comunidades.json").write_text(compact(comunidades), encoding="utf-8")

# ---- cerrado ----
cer_raw = json.loads((BASE / "cerrado_raw.json").read_text(encoding="utf-8"))
cer_geo = cer_raw["cerrado"][0]["geojson"]
if cer_geo.get("type") == "FeatureCollection":
    g = cer_geo["features"][0]
    cgeom = shape(g if g.get("type") not in ("Feature",) else g["geometry"])
else:
    cgeom = shape(cer_geo)
if not cgeom.is_valid:
    cgeom = make_valid(cgeom)
simp = cgeom.simplify(0.005)  # ~500 m, invisível no zoom de uso
cer_fc = {"type": "FeatureCollection", "features": [{
    "type": "Feature", "properties": {"nome": "Bioma Cerrado"},
    "geometry": round_coords(mapping(simp)),
}]}
(BASE / "cerrado.geojson").write_text(compact(cer_fc), encoding="utf-8")

print(f"municipios: {len(feats)} | comunidades: {len(comunidades)} (check {n_com_check})")
print(f"municipios.geojson: {(BASE/'municipios.geojson').stat().st_size/1e6:.2f} MB")
print(f"comunidades.json:   {(BASE/'comunidades.json').stat().st_size/1e6:.2f} MB")
print(f"cerrado.geojson:    {(BASE/'cerrado.geojson').stat().st_size/1e6:.2f} MB")
segs = {}
for c in comunidades:
    segs[c["seg"]] = segs.get(c["seg"], 0) + 1
print("segmentos:", json.dumps(segs, ensure_ascii=False))
