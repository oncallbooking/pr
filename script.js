/* script.js
   Frontend for Data Visualizer - fetches datasets from backend, draws charts (Chart.js + D3),
   supports CSV upload, filters, snapshots, export, and simple admin actions.
*/

const API_BASE = ''; // same origin; server serves static files and API.
let datasets = [];
let currentDataset = null;
let mainChart = null;

// DOM elements
const datasetsListEl = document.getElementById('datasets-list');
const chartTitleEl = document.getElementById('chart-title');
const mainChartCtx = document.getElementById('mainChart').getContext('2d');
const chartTypeSelect = document.getElementById('chart-type-select');
const filterSeriesSel = document.getElementById('filter-series');
const filterFrom = document.getElementById('filter-from');
const filterTo = document.getElementById('filter-to');
const snapshotsList = document.getElementById('snapshots-list');
const yearSpan = document.getElementById('year');

yearSpan.textContent = new Date().getFullYear();

// --- Utility functions ---
function fetchJSON(url, opts = {}) {
  return fetch(url, opts).then(r => r.json());
}

function numberFormat(n) {
  return Intl.NumberFormat().format(n);
}

// --- Load datasets from server ---
async function loadDatasets() {
  const res = await fetchJSON('/api/datasets');
  if (res.ok) {
    datasets = res.datasets;
    renderDatasetsList();
    if (!currentDataset && datasets.length) {
      selectDataset(datasets[0].id);
    }
  } else {
    console.error('Failed to load datasets', res);
  }
}

// --- Render dataset list ---
function renderDatasetsList() {
  datasetsListEl.innerHTML = '';
  datasets.forEach(ds => {
    const li = document.createElement('li');
    li.dataset.id = ds.id;
    li.innerHTML = `<span>${ds.name}</span><small>${(ds.meta && ds.meta.currency) || ''}</small>`;
    li.addEventListener('click', () => selectDataset(ds.id));
    if (currentDataset && currentDataset.id === ds.id) li.classList.add('active');
    datasetsListEl.appendChild(li);
  });
}

// --- Select dataset and render charts / table ---
function selectDataset(id) {
  currentDataset = datasets.find(d => d.id === id);
  if (!currentDataset) return;
  document.querySelectorAll('#datasets-list li').forEach(li => li.classList.toggle('active', li.dataset.id === id));
  chartTitleEl.textContent = currentDataset.name;
  populateSeriesFilter();
  drawMainChart();
  drawDonutD3();
  drawScatterD3();
  renderTable();
}

// Populate series select
function populateSeriesFilter() {
  filterSeriesSel.innerHTML = '<option value="">All</option>';
  currentDataset.series.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.name;
    opt.textContent = s.name;
    filterSeriesSel.appendChild(opt);
  });
}

// --- Chart rendering (Chart.js) ---
function drawMainChart() {
  const type = chartTypeSelect.value || 'line';
  const labels = currentDataset.labels;
  const datasetsCfg = currentDataset.series.map(s => ({
    label: s.name,
    data: s.data,
    borderColor: s.color || randomColor(),
    backgroundColor: (s.color || randomColor(0.25)),
    fill: type === 'line' ? true : false,
    tension: 0.3
  }));

  // Apply filters
  const filtered = applyFiltersToSeries(labels, currentDataset.series);

  // Destroy old chart
  if (mainChart) {
    try { mainChart.destroy(); } catch (e) {}
  }

  if (type === 'pie') {
    // For pie, take first series only
    const first = filtered.series[0] || { data: [], name: 'Series' };
    mainChart = new Chart(mainChartCtx, {
      type: 'pie',
      data: { labels: filtered.labels, datasets: [{ data: first.data, backgroundColor: generateColorArray(first.data.length) }] },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });
  } else if (type === 'scatter') {
    const dataset = filtered.series[0] || { data: [] };
    // Convert to {x,y}
    const sdata = (dataset.data || []).map((y, i) => ({ x: filtered.labels[i] || i, y }));
    mainChart = new Chart(mainChartCtx, {
      type: 'scatter',
      data: { datasets: [{ label: dataset.name || 'Scatter', data: sdata, backgroundColor: '#ff9800' }] },
      options: { responsive: true, scales: { x: { title: { display: true, text: 'Index/Label' }, ticks: { autoSkip: true } }, y: { beginAtZero: true } } }
    });
  } else {
    mainChart = new Chart(mainChartCtx, {
      type,
      data: { labels: filtered.labels, datasets: filtered.series.map(s => ({ label: s.name, data: s.data, borderColor: s.color || randomColor(), backgroundColor: (s.color || randomColor(0.2)), fill: type === 'line' })) },
      options: { responsive: true, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } }
    });
  }
}

// Filters applied to series
function applyFiltersToSeries(labels, series) {
  // Date filters only apply if labels are ISO dates (YYYY-MM-DD or YYYY-MM)
  let from = filterFrom.value ? new Date(filterFrom.value) : null;
  let to = filterTo.value ? new Date(filterTo.value) : null;
  const seriesName = filterSeriesSel.value;

  let filteredLabels = labels.slice();
  let filteredSeries = series.map(s => ({ name: s.name, data: s.data.slice(), color: s.color }));

  // If label entries look like dates, try to filter by date range (label->Date)
  const isDateLike = labels.length && /^\d{4}(-\d{2})?(-\d{2})?$/.test(labels[0]);
  if ((from || to) && isDateLike) {
    const keepIdx = labels.map((lab, idx) => {
      let labDate = new Date(lab);
      if (isNaN(labDate)) {
        // if label is YYYY-MM
        const parts = lab.split('-');
        if (parts.length === 2) labDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
      }
      if (from && labDate < from) return false;
      if (to && labDate > to) return false;
      return true;
    });

    filteredLabels = labels.filter((_, i) => keepIdx[i]);
    filteredSeries = filteredSeries.map(s => ({ ...s, data: s.data.filter((_, i) => keepIdx[i]) }));
  }

  if (seriesName) {
    filteredSeries = filteredSeries.filter(s => s.name === seriesName);
  }

  return { labels: filteredLabels, series: filteredSeries };
}

// --- D3 donut (category distribution) ---
function drawDonutD3() {
  const el = document.getElementById('d3-donut');
  el.innerHTML = '';
  // For donut, use first series or aggregated categories
  const s = currentDataset.series[0];
  if (!s) { el.innerHTML = '<p>No data</p>'; return; }

  // Derive categories by label (or fallback)
  const data = s.data.map((v, i) => ({ label: currentDataset.labels[i] || `#${i+1}`, value: v }));

  const width = 300, height = 300, radius = Math.min(width, height) / 2;
  const svg = d3.create('svg').attr('width', width).attr('height', height);
  const g = svg.append('g').attr('transform', `translate(${width/2},${height/2})`);
  const color = d3.scaleOrdinal(d3.schemeCategory10);

  const pie = d3.pie().value(d => d.value).sort(null);
  const path = d3.arc().outerRadius(radius - 10).innerRadius(radius / 2);
  const arc = g.selectAll('.arc').data(pie(data)).enter().append('g').attr('class', 'arc');

  arc.append('path').attr('d', path).attr('fill', (d, i) => color(i)).attr('stroke', '#fff').style('stroke-width', '1');

  arc.append('title').text(d => `${d.data.label}: ${numberFormat(d.data.value)}`);

  el.appendChild(svg.node());
}

// --- D3 scatter ---
function drawScatterD3() {
  const container = document.getElementById('d3-scatter');
  container.innerHTML = '';
  const width = container.clientWidth || 600;
  const height = 300;
  const margin = { top: 10, right: 10, bottom: 40, left: 40 };

  const svg = d3.create('svg').attr('width', width).attr('height', height);
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;

  // Use first two series if present
  const s1 = currentDataset.series[0];
  const s2 = currentDataset.series[1] || { data: s1.data.map((_,i) => Math.random()*100) };

  const data = s1.data.map((v, i) => ({ x: v, y: s2.data[i] || 0, label: currentDataset.labels[i] || i }));

  const x = d3.scaleLinear().domain([0, d3.max(data, d => d.x) || 1]).range([0, w]).nice();
  const y = d3.scaleLinear().domain([0, d3.max(data, d => d.y) || 1]).range([h, 0]).nice();

  g.append('g').attr('transform', `translate(0,${h})`).call(d3.axisBottom(x));
  g.append('g').call(d3.axisLeft(y));

  g.selectAll('.dot').data(data).enter().append('circle').attr('cx', d => x(d.x)).attr('cy', d => y(d.y)).attr('r', 5).attr('fill', '#fb7185').attr('opacity', 0.9)
    .append('title').text(d => `${d.label} — x:${numberFormat(d.x)} y:${numberFormat(d.y)}`);

  container.appendChild(svg.node());
}

// --- Render data table ---
function renderTable() {
  const thead = document.querySelector('#data-table thead');
  const tbody = document.querySelector('#data-table tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  const labels = currentDataset.labels;
  const headers = ['Label'].concat(currentDataset.series.map(s => s.name));
  const trh = document.createElement('tr');
  headers.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    trh.appendChild(th);
  });
  thead.appendChild(trh);

  labels.forEach((lab, i) => {
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td');
    tdLabel.textContent = lab;
    tr.appendChild(tdLabel);
    currentDataset.series.forEach(s => {
      const td = document.createElement('td');
      td.textContent = s.data[i] !== undefined ? s.data[i] : '-';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

// --- CSV upload (simple parser) ---
function parseCSV(text) {
  // Very simple parser: first row headers, following rows values. Comma-separated. No multiline fields.
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = lines.slice(1).map(r => r.split(',').map(c => c.trim()));
  return { headers, rows };
}

function buildDatasetFromCSV(name, parsed) {
  // Expect first column = label, following columns = series
  const labels = parsed.rows.map(r => r[0]);
  const series = parsed.headers.slice(1).map((h, idx) => ({
    name: h,
    data: parsed.rows.map(r => Number(r[idx+1]) || 0),
    color: randomColor()
  }));
  return { name, labels, series, meta: {} };
}

// --- Admin: save snapshot ---
async function saveSnapshot() {
  const name = prompt('Snapshot name');
  if (!name) return;
  const token = prompt('Admin token required to save snapshot (enter token):');
  if (!token) return alert('Snapshot not saved: admin token is required.');

  const payload = { name, dashboardState: { datasetId: currentDataset.id, chartType: chartTypeSelect.value, filters: { from: filterFrom.value, to: filterTo.value, series: filterSeriesSel.value } } };
  const res = await fetchJSON('/api/snapshots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
    body: JSON.stringify(payload)
  });
  if (res.ok) {
    alert('Snapshot saved');
    loadSnapshots();
  } else {
    alert('Failed to save snapshot: ' + (res.message || JSON.stringify(res)));
  }
}

// Load snapshots
async function loadSnapshots() {
  const res = await fetchJSON('/api/snapshots');
  if (res.ok) {
    renderSnapshots(res.snapshots || []);
  }
}

function renderSnapshots(snapshots) {
  snapshotsList.innerHTML = '';
  snapshots.forEach(s => {
    const li = document.createElement('li');
    li.textContent = `${s.name} — ${new Date(s.createdAt).toLocaleString()}`;
    li.addEventListener('click', () => applySnapshot(s));
    snapshotsList.appendChild(li);
  });
}

function applySnapshot(snapshot) {
  const st = snapshot.dashboardState || {};
  if (st.datasetId) {
    selectDataset(st.datasetId);
  }
  if (st.chartType) chartTypeSelect.value = st.chartType;
  if (st.filters) {
    filterFrom.value = st.filters.from || '';
    filterTo.value = st.filters.to || '';
    filterSeriesSel.value = st.filters.series || '';
  }
  drawMainChart();
}

// --- Misc helpers ---
function randomColor(alpha) {
  const r = Math.floor(100 + Math.random() * 155);
  const g = Math.floor(100 + Math.random() * 155);
  const b = Math.floor(100 + Math.random() * 155);
  return alpha ? `rgba(${r},${g},${b},${alpha})` : `rgb(${r},${g},${b})`;
}
function generateColorArray(n){ return Array.from({length:n},()=>randomColor()) }

// --- Events & controls wiring ---
document.getElementById('refresh-btn').addEventListener('click', () => loadDatasets());
chartTypeSelect.addEventListener('change', () => drawMainChart());
document.getElementById('download-chart').addEventListener('click', () => {
  if (!mainChart) return;
  const url = mainChart.toBase64Image();
  const a = document.createElement('a');
  a.href = url; a.download = `${currentDataset ? currentDataset.name : 'chart'}.png`;
  a.click();
});

document.getElementById('upload-csv-btn').addEventListener('click', () => {
  document.getElementById('csv-file-input').click();
});

document.getElementById('csv-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const parsed = parseCSV(text);
  if (!parsed) return alert('CSV parse failed or not enough rows.');
  const dsName = prompt('Dataset name', file.name.replace(/\.[^/.]+$/, '')) || file.name;
  const ds = buildDatasetFromCSV(dsName, parsed);
  // send to server
  const res = await fetchJSON('/api/datasets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ds)
  });
  if (res.ok) {
    alert('Dataset uploaded');
    loadDatasets();
  } else {
    alert('Upload failed: ' + JSON.stringify(res));
  }
});

document.getElementById('export-json-btn').addEventListener('click', () => {
  if (!currentDataset) return alert('Select a dataset first');
  const blob = new Blob([JSON.stringify(currentDataset, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${currentDataset.name}.json`;
  a.click();
});

document.getElementById('dataset-search').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  Array.from(document.querySelectorAll('#datasets-list li')).forEach(li => {
    const txt = li.textContent.toLowerCase();
    li.style.display = txt.includes(q) ? '' : 'none';
  });
});

// Generate random dataset (client-side demo)
document.getElementById('new-random-ds').addEventListener('click', async () => {
  const name = 'Random ' + Math.floor(Math.random()*1000);
  const labels = Array.from({length:12}, (_,i)=>`2025-${String(i+1).padStart(2,'0')}`);
  const series = [
    { name: 'A', data: labels.map(()=>Math.floor(Math.random()*1000)), color: randomColor() },
    { name: 'B', data: labels.map(()=>Math.floor(Math.random()*800)), color: randomColor() }
  ];
  const res = await fetchJSON('/api/datasets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, labels, series }) });
  if (res.ok) {
    alert('Random dataset created');
    loadDatasets();
  } else {
    alert('Failed: ' + JSON.stringify(res));
  }
});

// Clear local UI state
document.getElementById('clear-local').addEventListener('click', () => {
  localStorage.clear();
  alert('Local storage cleared');
});

// Admin login button (simple)
document.getElementById('admin-login-btn').addEventListener('click', () => {
  const token = prompt('Enter admin token (for demo). Set env ADMIN_TOKEN on server before selling.');
  if (!token) return;
  alert('Admin token saved in session (will be used for saving snapshots). You may need to enter it again for some operations.');
  sessionStorage.setItem('admin_token', token);
});

// Snapshots
document.getElementById('save-snapshot').addEventListener('click', saveSnapshot);

// Filters
document.getElementById('apply-filters').addEventListener('click', () => drawMainChart());
document.getElementById('reset-filters').addEventListener('click', () => { filterFrom.value=''; filterTo.value=''; filterSeriesSel.value=''; drawMainChart(); });

// Theme toggle
document.getElementById('theme-toggle').addEventListener('click', () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('dv_theme_dark', document.body.classList.contains('dark') ? '1' : '0');
});

// Load snapshots & datasets at start
(async () => {
  if (localStorage.getItem('dv_theme_dark') === '1') document.body.classList.add('dark');
  await loadDatasets();
  await loadSnapshots();
})();
