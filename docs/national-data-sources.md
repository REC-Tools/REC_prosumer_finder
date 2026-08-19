# Fonti nazionali per impianti fotovoltaici e altre FER

Verifica effettuata il **19 agosto 2026** sui portali ufficiali. Il catalogo machine-readable è in `config/national-data-sources.json`.

## Esito della ricognizione

| Fonte | Cosa offre | Accesso | Uso nel progetto |
|---|---|---|---|
| GSE, aree cabine primarie | perimetri ufficiali `COD_AC` | layer ArcGIS pubblico | già integrato per delimitare la ricerca |
| GSE, ATLAIMPIANTI | ubicazione, fonte, tecnologia e potenza degli impianti incentivati o serviti dal GSE | portale pubblico; nessuna API stabile documentata | candidato a import controllato dopo verifica di termini e formato |
| Terna, GAUDÌ | anagrafe nazionale univoca di impianti e unità di produzione | portale autenticato | riferimento autorevole; nessuno scraping o import senza autorizzazione |
| Terna, Renewable Source Capacity API | potenza FER per anno, regione, provincia e fonte | API OAuth 2.0 | adapter implementato per validazione aggregata |
| Terna, Portale Dati | statistiche e download di generazione/capacità | download pubblico | controlli di completezza e trend |
| dati.gov.it | metadati di dataset nazionali e territoriali | catalogo pubblico | discovery; verificare sempre la fonte originaria |

ATLAIMPIANTI dichiara esplicitamente che gli impianti mostrati non rappresentano la totalità degli impianti gestiti dal GSE. GAUDÌ è quindi il riferimento anagrafico nazionale, ma non è un dataset aperto utilizzabile anonimamente. Le API Terna pubbliche documentate espongono aggregati territoriali e non coordinate dei singoli impianti.

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

- GSE, [guida ATLAIMPIANTI](https://www.gse.it/Dati-e-Scenari_site/atlaimpianti_site/Documents/Guida%20atlaimpianti.pdf)
- Terna, [portale GAUDÌ](https://gaudi.terna.it/s/public)
- Terna, [Renewable Source Capacity API](https://developer.terna.it/docs/read/apis_catalog/generation/Renewable_Source_Capacity)
- Terna, [Portale Dati](https://dati.terna.it/)
- Italia/AgID, [sorgenti dei cataloghi open data pubblici](https://github.com/italia/public-opendata-sources)
