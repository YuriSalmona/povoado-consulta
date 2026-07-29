# Povoado · Consulta Territorial

Ferramenta web estática de consulta às comunidades tradicionais do Cerrado da base
**[Plataforma Povoado](https://dados.tonomapa.org.br/)** (iniciativa
[Tô no Mapa](https://tonomapa.org.br/) — ISPN, Instituto Cerrados, Rede Cerrado).

**Acesso:** https://yurisalmona.github.io/povoado-consulta/

## O que faz

O usuário seleciona um território de três maneiras alternativas:

1. **Filtros** — estados e/ou municípios (autocomplete); sem seleção = todo o Cerrado;
2. **Desenho** — polígono ou retângulo desenhado sobre o mapa (Leaflet.draw, em português);
3. **Arquivo** — upload de shapefile (`.zip` com `.shp/.dbf/.shx/.prj`) ou GeoJSON;
   a projeção é lida do `.prj` e reprojetada automaticamente (shpjs + proj4).

Refinamento opcional em qualquer modo: segmento (28 categorias), trecho do nome da
comunidade, somente MATOPIBA.

Ao consultar, gera um **relatório**: cards de totais, texto-resumo pronto para citação,
gráficos (comunidades por segmento, por estado, top municípios, tipos de fonte
bibliográfica) e tabela completa ordenável/filtrável. Downloads:

- **CSV** das comunidades (com referências bibliográficas por comunidade);
- **GeoJSON** dos municípios do resultado (para QGIS/ArcGIS);
- **PDF** via diálogo de impressão (CSS de impressão dedicado).

Um **Guia do usuário** (botão no topo direito) documenta os três modos e as ressalvas
metodológicas.

## Dados

| Arquivo | Conteúdo | Origem |
|---|---|---|
| `dados/dados_raw.json` | resposta bruta da API (13 UFs → 1.435 municípios → 6.767 comunidades) | `GET https://6nbzsvxcz7.execute-api.us-east-2.amazonaws.com/prod/dados` |
| `dados/cerrado_raw.json` | limite do bioma | `GET .../prod/cerrado` |
| `dados/municipios.geojson` | 1 feature/município (`cod`, `nome`, `uf`, `ncom`) | gerado por `preprocess.py` |
| `dados/comunidades.json` | lista plana (`cod`, `mun`, `uf`, `nome`, `seg`, `mat`, `refs`) | gerado por `preprocess.py` |
| `dados/cerrado.geojson` | limite simplificado (~500 m) | gerado por `preprocess.py` |

Extração: **28/07/2026**. Para atualizar a base: baixar novamente os dois `_raw.json`
da API e rodar `python preprocess.py` (requer `shapely`).

### Modelo de dado — ressalva importante

As comunidades da base Povoado são vinculadas a **municípios**, sem coordenada
geográfica própria. Consultas espaciais retornam as comunidades dos **municípios
interceptados** pela área informada. A base vem de fontes secundárias (revisão
bibliográfica) e está em consolidação contínua — os números são um piso, não um censo.

## Arquitetura

Site 100 % estático (sem backend, sem build): HTML + CSS + JavaScript puro.

- `index.html` / `styles.css` / `app.js` — aplicação;
- `vendor/` — Leaflet 1.9.4, Leaflet.draw 1.0.4, shpjs 6.1 (auto-hospedados);
- basemap: tiles raster CARTO Positron;
- motor espacial próprio em `app.js` (bbox + ray casting + interseção de segmentos),
  ~50 ms para varrer os 1.435 municípios;
- identidade visual Tô no Mapa: laranja `#F76707`/`#E85F00`/`#FF7A45`,
  verdes `#2E8B57`/`#556B2F`, logos oficiais em `assets/`.

`teste_shapefile.zip` é um polígono de exemplo (Chapada dos Veadeiros, EPSG:4674)
para testar o modo Arquivo.

## Desenvolvimento local

Qualquer servidor estático serve. Ex.:

```bash
python -m http.server 8017
```

e abrir http://localhost:8017.

---

Ferramenta desenvolvida pelo Instituto Cerrados sobre os dados públicos da Plataforma
Povoado. Ecossistema: [Sistema Cerrado](https://sistema-cerrado.streamlit.app/) ·
[Painel de projetos](https://yurisalmona.github.io/painel-projetos/).
