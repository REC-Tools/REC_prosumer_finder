# Cabine configurate

La web app propone tutte le aree convenzionali GSE 2025 che intersecano i confini ISTAT di Ceresole Reale e Sparone:

| Comune | Codici `COD_AC` | Cabina contenente il centroide comunale |
|---|---|---|
| Ceresole Reale (`001073`) | `AC001E01295`, `AC001E01306`, `AC009E00003` | `AC001E01306` |
| Sparone (`001267`) | `AC001E01305`, `AC001E01308`, `AC001E01884` | `AC001E01884` |

Un comune può intersecare più aree convenzionali: il codice del centroide è solo un riferimento sintetico e non sostituisce la verifica puntuale dell'indirizzo o del POD sulla mappa GSE. La configurazione versionata è in `config/featured-cabins.json` e include data, fonte e codice ISTAT.

## Verifica live

I perimetri e i risultati OpenStreetMap possono cambiare. Per verificare esplicitamente ciascuna cabina sui servizi reali:

```bash
npm run validate:cabins:live
```

Il comando controlla che ogni `COD_AC` configurato restituisca almeno un perimetro dai layer GSE. Per verificare anche Overpass su una singola cabina resta disponibile `npm run test:live -- COD_AC`.

## Baseline osservata il 18 agosto 2026

- `AC001E01308`: perimetro GSE trovato; 13 elementi fotovoltaici OSM e 13 candidati aggregati. Tutti hanno confidenza bassa perché non è stato possibile associarli con certezza a un edificio OSM.
- `AC001E01884`: perimetro GSE trovato; nessun elemento fotovoltaico restituito da Overpass al momento del test.

Zero risultati non dimostra l'assenza di impianti: può indicare che l'area non è ancora mappata in OpenStreetMap.
