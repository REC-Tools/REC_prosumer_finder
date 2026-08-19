'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { app, isValidCabinCode } = require('../server');

test('validates configurable GSE primary-substation codes', () => {
  assert.equal(isValidCabinCode('AC001E01308'), true);
  assert.equal(isValidCabinCode('ac001e01884'), true);
  assert.equal(isValidCabinCode('01308'), false);
});

test('server exposes configuration and serves the SPA fallback', async t => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const configResponse = await fetch(`${base}/api/config`);
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json();
  assert.equal(config.defaultCabinCode, 'AC001E01308');
  assert.deepEqual(config.initialCabins.map(item => item.code), ['AC001E01308', 'AC001E01884']);

  const fallback = await fetch(`${base}/percorso-di-prova`);
  assert.equal(fallback.status, 200);
  assert.match(await fallback.text(), /REC Prosumer Finder/);
});

test('search endpoint rejects invalid input without external requests', async t => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/pv-search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cabinCode: 'bad' })
  });
  assert.equal(response.status, 400);
});

test('server exposes the reviewed national source catalog', async t => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/national-data-sources?authority=Terna`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.sources.length >= 3);
  assert.ok(body.sources.every(source => source.authority === 'Terna'));
});

test('Terna proxy fails safely when OAuth is not configured', async t => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/terna-capacity?year=2025`);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /TERNA_ACCESS_TOKEN/);
});
