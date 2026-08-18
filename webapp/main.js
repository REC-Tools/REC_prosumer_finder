'use strict';

const map = L.map('map').setView([45.3, 9.2], 9);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 20,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let areaLayer = null;
let resultLayer = null;
let resultFeatures = [];
let activeCabinCode = 'AC001E01308';
const layersById = new Map();

function byId(id) { return document.getElementById(id); }
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
function formatNumber(value, digits = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('it-IT', { maximumFractionDigits: digits }) : 'n.d.';
}
function setStatus(message, state = '') {
  const status = byId('status');
  status.textContent = message;
  status.className = state;
}
function validateCabinCode(value) {
  return /^AC\d{3}[A-Z]\d{5}$/.test(String(value || '').trim().toUpperCase());
}

function renderQuickCabins(cabins) {
  const container = byId('quickCabins');
  container.innerHTML = '';
  (cabins || []).forEach(cabin => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = cabin.code;
    button.title = cabin.label || cabin.code;
    button.classList.toggle('active', cabin.code === activeCabinCode);
    button.addEventListener('click', () => {
      activeCabinCode = cabin.code;
      byId('cabinCode').value = cabin.code;
      container.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
      analyze();
    });
    container.appendChild(button);
  });
}
async function fetchJson(url, options) {
  const response = await fetch(url, options);
  let data;
  try { data = await response.json(); } catch (_) { data = {}; }
  if (!response.ok) throw new Error(data.error || `Errore HTTP ${response.status}`);
  return data;
}

function clearMapResults() {
  if (areaLayer) areaLayer.remove();
  if (resultLayer) resultLayer.remove();
  areaLayer = null;
  resultLayer = null;
  resultFeatures = [];
  layersById.clear();
  renderSummary([]);
  renderList([]);
  toggleExports(false);
}

function drawArea(collection) {
  if (areaLayer) areaLayer.remove();
  areaLayer = L.geoJSON(collection, {
    style: { color: '#1769aa', weight: 3, fillColor: '#1769aa', fillOpacity: .07 }
  }).addTo(map);
  if (areaLayer.getBounds().isValid()) map.fitBounds(areaLayer.getBounds(), { padding: [16, 16] });
}

function markerStyle(feature) {
  const confidence = feature.properties.confidence;
  const color = confidence === 'alta' ? '#247a3d' : confidence === 'media' ? '#d18400' : '#667085';
  return { color, weight: 2, fillColor: '#f4b400', fillOpacity: .55, radius: 7 };
}

function popupHtml(properties) {
  return `<strong>${escapeHtml(properties.name)}</strong><br>` +
    `${escapeHtml(properties.detection_type)}<br>` +
    `Confidenza: <strong>${escapeHtml(properties.confidence)}</strong> · score ${escapeHtml(properties.score)}/100<br>` +
    `Potenza: ${escapeHtml(formatNumber(properties.capacity_kw, 1))} kW (${escapeHtml(properties.capacity_source)})<br>` +
    `Area tetto: ${escapeHtml(formatNumber(properties.roof_area_m2))} m²<br>` +
    `Evidenza OSM: ${escapeHtml(properties.evidence || 'n.d.')}<br>` +
    `${properties.address ? `Indirizzo: ${escapeHtml(properties.address)}<br>` : ''}` +
    `<small>${escapeHtml(properties.verification_note)}</small>`;
}

function drawResults(features) {
  if (resultLayer) resultLayer.remove();
  layersById.clear();
  resultLayer = L.geoJSON(features, {
    style: markerStyle,
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, markerStyle(feature)),
    onEachFeature: (feature, layer) => {
      layersById.set(feature.properties.search_id, layer);
      layer.bindPopup(popupHtml(feature.properties));
    }
  }).addTo(map);
}

function visibleFeatures() {
  const filter = byId('confidenceFilter').value;
  return filter === 'all' ? resultFeatures : resultFeatures.filter(feature => feature.properties.confidence === filter);
}

function renderList(features) {
  const container = byId('resultsList');
  if (!features.length) {
    container.innerHTML = '<p class="empty">Nessun tetto fotovoltaico con i criteri selezionati.</p>';
    return;
  }
  container.innerHTML = '';
  features.forEach(feature => {
    const p = feature.properties;
    const item = document.createElement('article');
    item.className = 'result-item';
    item.dataset.id = p.search_id;
    item.innerHTML = `<div class="result-title"><strong>${escapeHtml(p.name)}</strong><span class="badge ${escapeHtml(p.confidence)}">${escapeHtml(p.confidence)}</span></div>` +
      `<div class="result-meta">${escapeHtml(formatNumber(p.capacity_kw, 1))} kW · tetto ${escapeHtml(formatNumber(p.roof_area_m2))} m² · score ${escapeHtml(p.score)}/100<br>${escapeHtml(p.address || p.evidence || 'Posizione da verificare')}</div>`;
    item.addEventListener('click', () => focusResult(feature));
    container.appendChild(item);
  });
}

function focusResult(feature) {
  document.querySelectorAll('.result-item.active').forEach(item => item.classList.remove('active'));
  document.querySelector(`.result-item[data-id="${CSS.escape(feature.properties.search_id)}"]`)?.classList.add('active');
  const layer = layersById.get(feature.properties.search_id);
  if (!layer) return;
  const bounds = layer.getBounds ? layer.getBounds() : null;
  if (bounds && bounds.isValid()) map.fitBounds(bounds.pad(.8), { maxZoom: 19 });
  else if (layer.getLatLng) map.setView(layer.getLatLng(), 18);
  layer.openPopup();
}

function renderSummary(features) {
  byId('detectedCount').textContent = features.length || '0';
  const capacity = features.reduce((sum, feature) => sum + (Number(feature.properties.capacity_kw) || 0), 0);
  byId('capacityTotal').textContent = capacity ? formatNumber(capacity, 1) : '0';
  byId('highConfidenceCount').textContent = features.filter(feature => feature.properties.confidence === 'alta').length;
}

function toggleExports(enabled) {
  byId('exportCsvBtn').disabled = !enabled;
  byId('exportGeoJsonBtn').disabled = !enabled;
}

async function analyze() {
  const input = byId('cabinCode');
  const code = input.value.trim().toUpperCase();
  input.value = code;
  byId('validationMessage').textContent = '';
  if (!validateCabinCode(code)) {
    byId('validationMessage').textContent = 'Formato non valido. Esempio: AC001E01308.';
    return;
  }
  activeCabinCode = code;
  byId('quickCabins').querySelectorAll('button').forEach(button => {
    button.classList.toggle('active', button.textContent === code);
  });
  clearMapResults();
  byId('analyzeBtn').disabled = true;
  setStatus(`Carico il perimetro ufficiale GSE di ${code}…`, 'loading');
  try {
    const area = await fetchJson(`/api/gse-area?code=${encodeURIComponent(code)}`);
    drawArea(area);
    const geometry = area.features.length === 1
      ? area.features[0].geometry
      : { type: 'MultiPolygon', coordinates: area.features.flatMap(feature => feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [feature.geometry.coordinates]) };
    setStatus(`Cerco impianti fotovoltaici e tetti associati in ${code}…`, 'loading');
    const results = await fetchJson('/api/pv-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cabinCode: code, geometry })
    });
    resultFeatures = results.features || [];
    drawResults(resultFeatures);
    renderSummary(resultFeatures);
    renderList(visibleFeatures());
    toggleExports(resultFeatures.length > 0);
    setStatus(`Analisi completata: ${resultFeatures.length} tetti/impianti da verificare. Fonte target: ${results.meta.source}.`);
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    byId('analyzeBtn').disabled = false;
  }
}

function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function download(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
function exportCsv() {
  const headers = ['Cabina', 'Nome', 'Confidenza', 'Score', 'Potenza_kW', 'Fonte_potenza', 'Area_FV_m2', 'Area_tetto_m2', 'Moduli', 'Indirizzo', 'Evidenza_OSM', 'Lat', 'Lon', 'Riferimento_OSM', 'Note'];
  const rows = resultFeatures.map(({ properties: p }) => [
    p.cabina_cod_ac, p.name, p.confidence, p.score, p.capacity_kw, p.capacity_source, p.pv_area_m2,
    p.roof_area_m2, p.modules, p.address, p.evidence, p.lat, p.lon, `${p.osm_type}/${p.osm_id}`, p.verification_note
  ]);
  const csv = '\ufeff' + [headers, ...rows].map(row => row.map(csvCell).join(';')).join('\n');
  download(csv, `tetti_fotovoltaici_${activeCabinCode}_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
}
function exportGeoJson() {
  download(JSON.stringify({ type: 'FeatureCollection', features: resultFeatures }, null, 2),
    `tetti_fotovoltaici_${activeCabinCode}_${new Date().toISOString().slice(0, 10)}.geojson`, 'application/geo+json');
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const config = await fetchJson('/api/config');
    activeCabinCode = config.defaultCabinCode || activeCabinCode;
    byId('cabinCode').value = activeCabinCode;
    renderQuickCabins(config.initialCabins);
    setStatus(`Pronto per analizzare ${activeCabinCode}${config.useMockOsm ? ' in modalità demo' : ''}.`);
  } catch (_) { /* The hard-coded test code remains usable. */ }
  byId('analyzeBtn').addEventListener('click', analyze);
  byId('cabinCode').addEventListener('keydown', event => { if (event.key === 'Enter') analyze(); });
  byId('confidenceFilter').addEventListener('change', () => renderList(visibleFeatures()));
  byId('exportCsvBtn').addEventListener('click', exportCsv);
  byId('exportGeoJsonBtn').addEventListener('click', exportGeoJson);
});
