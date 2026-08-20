# REC Prosumer Finder

Web app per lo screening preliminare di **impianti FER autorizzati e tetti con segnali fotovoltaici** all'interno delle aree di cabina primaria italiane. Il progetto fa parte dell'organizzazione [REC-Tools](https://github.com/REC-Tools) e riprende, dove utile, struttura, UX e pipeline di `REC_user_finder`.

La cabina primaria predefinita è **`AC001E01308`**. Questa versione accetta esclusivamente le sei cabine documentate in [`docs/configured-cabins.md`](docs/configured-cabins.md).

## Cosa fa

1. recupera il perimetro ufficiale della cabina dai layer GSE/ArcGIS;
2. scarica in memoria il registro puntuale CC BY 4.0 degli impianti FER autorizzati dalla Città Metropolitana di Torino;
3. filtra i punti ufficiali sul perimetro esatto della cabina, senza estrarre file sul server;
4. interroga OpenStreetMap tramite più endpoint Overpass di fallback e cerca segnali espliciti di fotovoltaico;
5. associa i segnali OSM agli edifici vicini, deduplica quelli sullo stesso tetto e fonde i riscontri compatibili con il registro ufficiale;
6. calcola superficie, potenza nota o stimata, punteggio e livello di confidenza;
7. mostra provenienza e autorizzazione sulla mappa ed esporta i risultati unificati in CSV o GeoJSON.

> Il risultato è una longlist tecnica, non un catasto impianti in esercizio. Il registro CMTo prova l'autorizzazione, mentre OpenStreetMap può essere incompleto. Presenza attuale, potenza, titolarità, POD e requisiti CER vanno verificati prima di qualificare un prosumer.

## Avvio locale

Requisiti: Node.js 22 o 24 e npm.

```bash
npm ci
npm test
npm start
```

Aprire `http://localhost:3000`. Se la porta è occupata, il server prova automaticamente le porte successive.

## Uso

- lasciare `AC001E01308` oppure selezionare una delle altre cinque cabine rapide;
- premere **Analizza**;
- filtrare i risultati per confidenza;
- selezionare un risultato per centrare il tetto sulla mappa;
- esportare la longlist in CSV o GeoJSON.

Il formato accettato è `AC` + tre cifre + una lettera + cinque cifre, per esempio `AC001E01308`.

## Modalità demo offline

Per provare l'intera pipeline senza chiamare GSE o Overpass:

```powershell
$env:USE_MOCK_GSE='true'; $env:USE_MOCK_OSM='true'; $env:USE_MOCK_CMTO='true'; npm start
```

Su macOS/Linux:

```bash
USE_MOCK_GSE=true USE_MOCK_OSM=true USE_MOCK_CMTO=true npm start
```

I dati in `webapp/data/pv-mock.json` e `webapp/data/cmto-fer-mock.geojson` sono sintetici e non rappresentano impianti reali.

## Configurazione

| Variabile | Default | Uso |
|---|---:|---|
| `DEFAULT_CABIN_CODE` | `AC001E01308` | Cabina proposta all'apertura |
| `PORT` | `3000` | Porta del server |
| `USE_MOCK_OSM` | `false` | Usa i dati demo al posto di Overpass |
| `USE_MOCK_GSE` | `false` | Usa un piccolo perimetro sintetico al posto del layer GSE |
| `USE_MOCK_CMTO` | `false` | Usa un punto FER istituzionale sintetico; viene attivato anche da `USE_MOCK_OSM` |
| `CMTO_FER_ENABLED` | `true` | Abilita il registro pubblico degli impianti FER autorizzati della Città Metropolitana di Torino |
| `ROOF_MATCH_DISTANCE_M` | `45` | Distanza massima per associare un impianto al tetto vicino |
| `OVERPASS_TILE_SIZE_KM` | `10` | Lato massimo dei tasselli usati per la discovery FV |
| `OVERPASS_RETRY_TILE_SIZE_KM` | `5` | Lato dei sotto-tasselli usati per ritentare automaticamente le aree fallite |
| `OVERPASS_BUILDING_BATCH_SIZE` | `12` | Coordinate FV raggruppate in ogni lookup edifici |
| `OVERPASS_REQUEST_DELAY_MS` | `150` | Pausa tra richieste sequenziali ai server pubblici |
| `OVERPASS_URLS` | due endpoint pubblici | Lista separata da virgole di endpoint Overpass |
| `GSE_FEATURE_LAYER_URLS` | layer 2025 + fallback | Lista separata da virgole di layer ArcGIS |

Per cambiare cabina normalmente basta usare la UI o impostare `DEFAULT_CABIN_CODE`; non serve modificare query o geometrie nel codice.

## Come viene stimata la potenza

La pipeline usa, in ordine:

1. potenza esplicita nei tag OSM, convertita in kW;
2. numero di moduli × 0,4 kW/modulo;
3. area fotovoltaica mappata × 0,18 kW/m².

Le stime sono indicate come tali nell'interfaccia e nell'export. Non viene stimata una potenza dalla sola area totale del tetto, perché un tetto grande non dimostra la presenza di pannelli.

## Confidenza

- **alta**: riscontro nel registro istituzionale CMTo oppure più evidenze OSM coerenti associate allo stesso tetto;
- **media**: evidenza fotovoltaica esplicita associata a un edificio;
- **bassa**: segnale fotovoltaico senza associazione affidabile a un tetto.

Il punteggio 0–100 ordina la longlist, ma non è una probabilità statistica.

## API

- `GET /api/config` — configurazione pubblica della web app;
- `GET /api/national-data-sources` — catalogo verificato delle fonti GSE, Terna/GAUDÌ e open data;
- `GET /api/terna-capacity` — aggregati FER ufficiali Terna (richiede `TERNA_ACCESS_TOKEN` OAuth);
- `GET /api/gse-area?code=AC001E01308` — perimetro ufficiale GeoJSON;
- `POST /api/pv-search` — ricerca unificata FER ufficiale + FV OSM, con body `{ "cabinCode": "...", "geometry": { ... } }`;
- `GET /api/health` — controllo di disponibilità.

## Struttura

```text
REC_prosumer_finder/
├── lib/prosumer.js          # query, geometria, matching, scoring e deduplicazione
├── lib/national-data.js     # catalogo fonti e adapter aggregati Terna
├── lib/cmto-fer.js          # download, parsing SHP/DBF, filtro e fusione registro FER CMTo
├── config/                  # metadati machine-readable delle fonti nazionali
├── docs/                    # cabine configurate e ricognizione dati nazionali
├── tests/                   # test unitari e di avvio API
├── webapp/
│   ├── data/                # fixture sintetiche OSM e registro CMTo
│   ├── index.html
│   ├── main.js
│   └── style.css
├── server.js                # proxy GSE/Overpass/CMTo e server web
└── package.json
```

## Limiti e sviluppi successivi

La pipeline combina ora il registro CMTo degli impianti autorizzati con gli impianti **mappati in OpenStreetMap**. Il registro non include necessariamente piccoli impianti domestici e non prova che un impianto autorizzato sia ancora in esercizio. Non vengono ancora analizzate ortofoto, quindi restano possibili falsi negativi.

Altri sviluppi utili:

- integrazione controllata di export GSE ATLAIMPIANTI o GAUDÌ autorizzati;
- stima di producibilità da orientamento, inclinazione e irraggiamento;
- collegamento con consumi/POD per distinguere produttori e prosumer;
- validazione manuale con stato “confermato/scartato” persistente;
- monitoraggio di copertura e aggiornamento OSM per cabina.

## Test

```bash
npm test
```

I test verificano sintassi, parser ZIP/SHP/DBF CMTo, filtro geometrico, fusione con OSM, costruzione della query Overpass, parsing della potenza, associazione impianto-tetto, deduplicazione, validazione del `COD_AC` e avvio reale del server. Le chiamate live non fanno parte della CI per evitare test instabili dipendenti da servizi esterni.

La CI GitHub Actions esegue `npm ci` e l'intera suite su Node.js 22 e 24 a ogni push, pull request e avvio manuale. La ricognizione di GSE, Terna/GAUDÌ e cataloghi open data, inclusi granularità e vincoli di accesso, è in [`docs/national-data-sources.md`](docs/national-data-sources.md).

Per uno smoke test esplicito sui servizi reali:

```bash
npm run test:live -- AC001E01308
npm run test:live -- AC001E01884
```

Le cabine iniziali e la procedura di verifica sono documentate in [`docs/configured-cabins.md`](docs/configured-cabins.md).

## Licenza

MIT © 2026 REC-Tools.
