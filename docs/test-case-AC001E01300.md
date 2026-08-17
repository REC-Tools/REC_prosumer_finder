# Baseline live — AC001E01300

Data verifica: **17 agosto 2026**.

Comando:

```bash
npm run test:live -- AC001E01300
```

Esito osservato durante l'impostazione iniziale:

- perimetro GSE trovato nel layer `AC_Comuni_2025/FeatureServer/0`;
- una geometria di tipo `Polygon`;
- 3 elementi grezzi restituiti dalla query Overpass ottimizzata;
- 1 candidato fotovoltaico aggregato (`way/1547504059`);
- evidenze OSM: `generator:source=solar` e `generator:method=photovoltaic`;
- area FV mappata circa 1.602 m²;
- potenza indicativa circa 288 kW, stimata dall'area mappata;
- confidenza bassa perché non è stato possibile associare l'oggetto a un edificio OSM.

Questi numeri sono una baseline, non un risultato stabile: OpenStreetMap e i perimetri GSE possono cambiare. Il candidato deve essere verificato su ortofoto, catasto impianti e dati di connessione prima dell'uso operativo.
