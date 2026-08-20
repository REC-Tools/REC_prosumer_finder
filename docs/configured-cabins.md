# Cabine configurate

La versione definitiva propone esclusivamente queste sei aree convenzionali GSE:

| `COD_AC` |
|---|
| `AC001E01298` |
| `AC001E01305` |
| `AC001E01307` |
| `AC001E01308` |
| `AC001E01306` |
| `AC001E01884` |

Il codice indicato inizialmente come `AC001E0184` è stato normalizzato a `AC001E01884`, perché il formato GSE richiede cinque cifre dopo la lettera del distributore. La configurazione versionata è in `config/featured-cabins.json`.

## Verifica live

I perimetri e i risultati OpenStreetMap possono cambiare. Per verificare esplicitamente ciascuna cabina sui servizi reali:

```bash
npm run validate:cabins:live
```

Il comando controlla che ogni `COD_AC` configurato restituisca almeno un perimetro dai layer GSE. Per verificare anche Overpass su una singola cabina resta disponibile `npm run test:live -- COD_AC`.

## Interpretazione dei risultati

La ricerca divide i perimetri in tasselli da 10 km, trova prima i segnali fotovoltaici e cerca gli edifici soltanto attorno a tali segnali. L'API distingue `photovoltaicElements`, `buildingElements`, risultati aggregati e tasselli falliti. Un solo risultato può quindi significare un solo oggetto FV mappato, più oggetti deduplicati sullo stesso tetto oppure una risposta parziale; non dimostra l'assenza di altri impianti reali.

### Verifica osservata il 20 agosto 2026

| `COD_AC` | Tasselli riusciti | Segnali FV OSM | Risultati aggregati |
|---|---:|---:|---:|
| `AC001E01298` | 1/1 | 2 | 2 |
| `AC001E01305` | 1/2 | 1 | 1 |
| `AC001E01307` | 2/4 | 1 | 1 |
| `AC001E01308` | 4/9 | 0 | 0 |
| `AC001E01306` | 3/6 | 0 | 0 |
| `AC001E01884` | 2/4 | 0 | 0 |

Questa tabella è una fotografia diagnostica, non un censimento: cinque analisi su sei erano parziali a causa dell'indisponibilità intermittente degli endpoint pubblici Overpass. La UI mostra ora la copertura raggiunta e avverte chiaramente quando il risultato è parziale.
