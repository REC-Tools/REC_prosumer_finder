# Cabine configurate

La web app propone due cabine primarie nella selezione rapida:

| Codice | Ruolo |
|---|---|
| `AC001E01308` | caso di test predefinito |
| `AC001E01884` | seconda cabina configurata |

La precedente indicazione `AC001E01300` era errata ed è stata rimossa da codice, test e documentazione.

## Verifica live

I perimetri e i risultati OpenStreetMap possono cambiare. Per verificare esplicitamente ciascuna cabina sui servizi reali:

```bash
npm run test:live -- AC001E01308
npm run test:live -- AC001E01884
```

Lo smoke test stampa il layer GSE utilizzato, il numero di elementi Overpass grezzi e i tetti/impianti aggregati. Un esito live non va considerato un catasto: ogni candidato richiede verifica su ortofoto, registri impianti e dati di connessione.

## Baseline osservata il 18 agosto 2026

- `AC001E01308`: perimetro GSE trovato; 13 elementi fotovoltaici OSM e 13 candidati aggregati. Tutti hanno confidenza bassa perché non è stato possibile associarli con certezza a un edificio OSM.
- `AC001E01884`: perimetro GSE trovato; nessun elemento fotovoltaico restituito da Overpass al momento del test.

Zero risultati non dimostra l'assenza di impianti: può indicare che l'area non è ancora mappata in OpenStreetMap.
