# REC Prosumer Finder

Web app per lo screening preliminare di **tetti con segnali di impianti fotovoltaici** all'interno delle aree di cabina primaria italiane. Il progetto fa parte dell'organizzazione [REC-Tools](https://github.com/REC-Tools) e riprende, dove utile, struttura, UX e pipeline di `REC_user_finder`.

Il caso iniziale configurato è la cabina primaria **`AC001E01300`**, ma il codice accetta qualsiasi `COD_AC` valido senza modifiche al sorgente.

## Cosa fa

1. recupera il perimetro ufficiale della cabina dai layer GSE/ArcGIS;
2. interroga OpenStreetMap tramite più endpoint Overpass di fallback;
3. cerca segnali espliciti di fotovoltaico (`generator:source=solar`, `generator:method=photovoltaic`, impianti solari e tetti con pannelli mappati);
4. associa ogni segnale all'edificio che lo contiene o, entro una soglia configurabile, all'edificio più vicino;
5. unisce più oggetti OSM riferiti allo stesso tetto per evitare duplicati;
6. calcola superficie, potenza nota o stimata, punteggio e livello di confidenza;
7. mostra i risultati su mappa e li esporta in CSV o GeoJSON.

> Il risultato è una longlist tecnica, non un catasto impianti. OpenStreetMap può essere incompleto o non aggiornato. Presenza, potenza, titolarità, POD e requisiti CER vanno verificati prima di qualificare un prosumer.

## Avvio locale

Requisiti: Node.js 22 o 24 e npm.

```bash
npm ci
npm test
npm start
```

Aprire `http://localhost:3000`. Se la porta è occupata, il server prova automaticamente le porte successive.

## Uso

- lasciare `AC001E01300` per il primo test oppure inserire un altro codice nel campo **COD_AC**;
- premere **Analizza**;
- filtrare i risultati per confidenza;
- selezionare un risultato per centrare il tetto sulla mappa;
- esportare la longlist in CSV o GeoJSON.

Il formato accettato è `AC` + tre cifre + una lettera + cinque cifre, per esempio `AC001E01300`.

## Modalità demo offline

Per provare l'intera pipeline senza chiamare GSE o Overpass:

```powershell
$env:USE_MOCK_GSE='true'; $env:USE_MOCK_OSM='true'; npm start
```

Su macOS/Linux:

```bash
USE_MOCK_GSE=true USE_MOCK_OSM=true npm start
```

I dati in `webapp/data/pv-mock.json` sono sintetici e non rappresentano impianti reali.

## Configurazione

| Variabile | Default | Uso |
|---|---:|---|
| `DEFAULT_CABIN_CODE` | `AC001E01300` | Cabina proposta all'apertura |
| `PORT` | `3000` | Porta del server |
| `USE_MOCK_OSM` | `false` | Usa i dati demo al posto di Overpass |
| `USE_MOCK_GSE` | `false` | Usa un piccolo perimetro sintetico al posto del layer GSE |
| `ROOF_MATCH_DISTANCE_M` | `45` | Distanza massima per associare un impianto al tetto vicino |
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

- **alta**: più evidenze OSM, associazione a un tetto e dato geometrico/potenza, oppure più oggetti FV coerenti sullo stesso edificio;
- **media**: evidenza fotovoltaica esplicita associata a un edificio;
- **bassa**: segnale fotovoltaico senza associazione affidabile a un tetto.

Il punteggio 0–100 ordina la longlist, ma non è una probabilità statistica.

## API

- `GET /api/config` — configurazione pubblica della web app;
- `GET /api/gse-area?code=AC001E01300` — perimetro ufficiale GeoJSON;
- `POST /api/pv-search` — ricerca FV, con body `{ "cabinCode": "...", "geometry": { ... } }`;
- `GET /api/health` — controllo di disponibilità.

## Struttura

```text
REC_prosumer_finder/
├── lib/prosumer.js          # query, geometria, matching, scoring e deduplicazione
├── tests/                   # test unitari e di avvio API
├── webapp/
│   ├── data/pv-mock.json    # dati sintetici per demo
│   ├── index.html
│   ├── main.js
│   └── style.css
├── server.js                # proxy GSE/Overpass e server web
└── package.json
```

## Limiti e sviluppi successivi

La prima versione identifica gli impianti **mappati in OpenStreetMap**. Non analizza ancora ortofoto e quindi può produrre falsi negativi. Un'estensione naturale è aggiungere una seconda sorgente di rilevamento da immagini aeree, conservando lo stesso schema GeoJSON e il campo `source`; la pipeline di associazione ai tetti, scoring, mappa ed export può rimanere invariata.

Altri sviluppi utili:

- confronto con dati catastali o registri impianti autorizzati;
- stima di producibilità da orientamento, inclinazione e irraggiamento;
- collegamento con consumi/POD per distinguere produttori e prosumer;
- validazione manuale con stato “confermato/scartato” persistente;
- monitoraggio di copertura e aggiornamento OSM per cabina.

## Test

```bash
npm test
```

I test verificano sintassi, costruzione della query Overpass, parsing della potenza, associazione impianto-tetto, deduplicazione per edificio, validazione del `COD_AC` e avvio reale del server. Le chiamate live a GSE/Overpass non fanno parte della CI per evitare test instabili dipendenti da servizi esterni.

Per uno smoke test esplicito sui servizi reali:

```bash
npm run test:live -- AC001E01300
```

La baseline iniziale è documentata in [`docs/test-case-AC001E01300.md`](docs/test-case-AC001E01300.md).

## Licenza

MIT © 2026 REC-Tools.
