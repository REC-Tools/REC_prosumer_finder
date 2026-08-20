# Fonti nazionali per impianti fotovoltaici e altre FER

Verifica aggiornata il **20 agosto 2026** sui portali ufficiali. Il catalogo machine-readable è in `config/national-data-sources.json`.

## Esito della ricognizione

| Fonte | Cosa offre | Accesso | Uso nel progetto |
|---|---|---|---|
| Città Metropolitana di Torino, impianti FER autorizzati | coordinate, comune, indirizzo, data autorizzazione e tecnologia | Shapefile pubblico, CC BY 4.0 | integrato: download in memoria, filtro per cabina e fusione con OSM |
| GSE, aree cabine primarie | perimetri ufficiali `COD_AC` | layer ArcGIS pubblico | già integrato per delimitare la ricerca |
| GSE, ATLAIMPIANTI | ubicazione, fonte, tecnologia e potenza degli impianti incentivati o serviti dal GSE | portale pubblico; nessuna API stabile documentata | candidato a import controllato dopo verifica di termini e formato |
| Terna, GAUDÌ | anagrafe nazionale univoca di impianti e unità di produzione | portale autenticato | riferimento autorevole; nessuno scraping o import senza autorizzazione |
| Terna, Renewable Source Capacity API | potenza FER per anno, regione, provincia e fonte | API OAuth 2.0 | adapter implementato per validazione aggregata |
| Terna, Portale Dati | statistiche e download di generazione/capacità | download pubblico | controlli di completezza e trend |
| dati.gov.it | metadati di dataset nazionali e territoriali | catalogo pubblico | discovery; verificare sempre la fonte originaria |

ATLAIMPIANTI dichiara esplicitamente che gli impianti mostrati non rappresentano la totalità degli impianti gestiti dal GSE. GAUDÌ è quindi il riferimento anagrafico nazionale, ma non è un dataset aperto utilizzabile anonimamente. Le API Terna pubbliche documentate espongono aggregati territoriali e non coordinate dei singoli impianti.

## Registro FER della Città Metropolitana di Torino

Il dataset `SHP_INT_ENER` contiene 250 localizzazioni puntuali: 53 fotovoltaiche, 144 idroelettriche, 13 a biometano e 40 termoelettriche. L'adapter `lib/cmto-fer.js`:

1. scarica l'archivio ZIP ufficiale con limite di 5 MB;
2. legge SHP e DBF interamente in memoria;
3. normalizza i record in GeoJSON con fonte, licenza e data di autorizzazione;
4. filtra i punti sul Polygon/MultiPolygon GSE;
5. fonde un fotovoltaico ufficiale con un risultato OSM entro 75 metri, conservando entrambi i riferimenti.

Verifica live sulle sei cabine:

| Cabina | Impianti FER ufficiali |
|---|---:|
| `AC001E01298` | 1 fotovoltaico |
| `AC001E01305` | 2 idroelettrici |
| `AC001E01307` | 5 idroelettrici |
| `AC001E01308` | 14 totali, incluso il fotovoltaico di Località Gulaiun a Sparone |
| `AC001E01306` | 3 idroelettrici |
| `AC001E01884` | 2 idroelettrici |

Sono autorizzazioni amministrative: non certificano stato di esercizio, produzione attuale o appartenenza a una CER.

## Adapter Terna

L'adapter `lib/national-data.js` costruisce richieste conformi ai valori documentati, invia il token OAuth solo nell'header e normalizza i numeri con formato italiano.

Configurare il token esclusivamente nell'ambiente:

```bash
TERNA_ACCESS_TOKEN=<token-oauth> npm start
```

Esempio API locale:

```text
GET /api/terna-capacity?year=2025&region=Lombardia&province=Milano&source=Fotovoltaico&capacityType=Lorda
```

Fonti Terna accettate: `Bioenergie`, `Eolico`, `Fotovoltaico`, `Geotermoelettrico`, `Idrico`. Il risultato serve per confronti aggregati; non prova che uno specifico tetto sia un impianto né che il relativo soggetto sia un prosumer.

## Percorso per dati puntuali ufficiali

1. ottenere dal titolare della fonte un export autorizzato con licenza e data di aggiornamento note;
2. escludere o minimizzare POD, identificativi e dati personali non necessari;
3. trasformare i record nello schema GeoJSON già usato dall'app, mantenendo `source`, data di aggiornamento e qualità della coordinata;
4. deduplicare senza fondere automaticamente soggetti o impianti solo perché vicini;
5. confrontare i totali per provincia/fonte con Terna e conservare un report degli scarti;
6. usare fixture sintetiche in CI e mantenere gli smoke test live separati.

## Riferimenti ufficiali

- Città Metropolitana di Torino, [download Shapefile impianti FER autorizzati](https://eds.cittametropolitana.torino.it/geoportale/SHP_INT_ENER.php)
- Geoportale Piemonte, [catalogo metadati](https://www.geoportale.piemonte.it/geonetwork/srv/search?topicCat=environment)
- GSE, [guida ATLAIMPIANTI](https://www.gse.it/Dati-e-Scenari_site/atlaimpianti_site/Documents/Guida%20atlaimpianti.pdf)
- Terna, [portale GAUDÌ](https://gaudi.terna.it/s/public)
- Terna, [Renewable Source Capacity API](https://developer.terna.it/docs/read/apis_catalog/generation/Renewable_Source_Capacity)
- Terna, [Portale Dati](https://dati.terna.it/)
- Italia/AgID, [sorgenti dei cataloghi open data pubblici](https://github.com/italia/public-opendata-sources)
