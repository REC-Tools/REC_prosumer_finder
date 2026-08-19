# Contribuire

## Flusso di lavoro

1. creare un branch breve e descrittivo a partire da `main`;
2. installare esattamente le dipendenze bloccate con `npm ci`;
3. eseguire `npm test` prima di aprire una pull request;
4. descrivere nella PR impatto, verifiche e fonti dati interessate.

La CI viene eseguita su ogni push, su ogni pull request e manualmente da GitHub Actions. I job concorrenti obsoleti dello stesso branch vengono annullati.

## Fonti dati

Una nuova fonte deve essere aggiunta a `config/national-data-sources.json` e documentata in `docs/national-data-sources.md`. Specificare almeno autorità, URL ufficiale, granularità, modalità di accesso, stato dell'integrazione e limitazioni.

Non committare token, esportazioni riservate, POD, dati del titolare o altri dati personali. Non automatizzare lo scraping di portali autenticati. I test della CI devono usare fixture sintetiche e non dipendere da servizi esterni.
