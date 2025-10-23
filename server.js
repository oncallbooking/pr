/**
 * server.js
 * Lightweight backend for the Data Visualizer app.
 * Serves static frontend, provides REST endpoints for CRUD of datasets,
 * simple auth token for admin actions, and snapshot saving.
 *
 * NOTE: For production-sellable app, replace simple token auth with a proper auth solution.
 */

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 4000;
const DATA_FILE = path.join(__dirname, 'data.json');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Helper utilities ----------
function readDataFile() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return { datasets: [], snapshots: [] };
  }
}

function writeDataFile(obj) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2), 'utf8');
}

// Ensure data file exists
if (!fs.existsSync(DATA_FILE)) {
  writeDataFile({
    datasets: [
      // sample dataset created later if not present
    ],
    snapshots: []
  });
}

// ---------- Simple admin token (change before selling) ----------
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'CHANGE_THIS_ADMIN_TOKEN_please';

// ---------- API endpoints ----------

// Get all datasets
app.get('/api/datasets', (req, res) => {
  const db = readDataFile();
  res.json({ ok: true, datasets: db.datasets });
});

// Get a dataset by id
app.get('/api/datasets/:id', (req, res) => {
  const db = readDataFile();
  const ds = db.datasets.find(d => d.id === req.params.id);
  if (!ds) return res.status(404).json({ ok: false, message: 'Dataset not found' });
  res.json({ ok: true, dataset: ds });
});

// Create or upload dataset
app.post('/api/datasets', (req, res) => {
  const db = readDataFile();
  const { name, labels, series, meta } = req.body;
  if (!name || !labels || !series) {
    return res.status(400).json({ ok: false, message: 'Missing name, labels or series' });
  }
  const id = uuidv4();
  const ds = { id, name, labels, series, meta: meta || {}, createdAt: new Date().toISOString() };
  db.datasets.push(ds);
  writeDataFile(db);
  res.json({ ok: true, dataset: ds });
});

// Update dataset (admin only)
app.put('/api/datasets/:id', (req, res) => {
  const token = req.header('x-admin-token') || '';
  if (token !== ADMIN_TOKEN) return res.status(401).json({ ok: false, message: 'Unauthorized' });

  const db = readDataFile();
  const idx = db.datasets.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, message: 'Dataset not found' });

  const { name, labels, series, meta } = req.body;
  db.datasets[idx] = { ...db.datasets[idx], name: name || db.datasets[idx].name, labels: labels || db.datasets[idx].labels, series: series || db.datasets[idx].series, meta: meta || db.datasets[idx].meta, updatedAt: new Date().toISOString() };
  writeDataFile(db);
  res.json({ ok: true, dataset: db.datasets[idx] });
});

// Delete dataset (admin only)
app.delete('/api/datasets/:id', (req, res) => {
  const token = req.header('x-admin-token') || '';
  if (token !== ADMIN_TOKEN) return res.status(401).json({ ok: false, message: 'Unauthorized' });

  const db = readDataFile();
  const idx = db.datasets.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, message: 'Dataset not found' });

  const removed = db.datasets.splice(idx, 1);
  writeDataFile(db);
  res.json({ ok: true, removed: removed[0] });
});

// Save a snapshot (admin)
app.post('/api/snapshots', (req, res) => {
  const token = req.header('x-admin-token') || '';
  if (token !== ADMIN_TOKEN) return res.status(401).json({ ok: false, message: 'Unauthorized' });

  const { name, dashboardState } = req.body;
  if (!name || !dashboardState) return res.status(400).json({ ok: false, message: 'Missing name or dashboardState' });

  const db = readDataFile();
  const snapshot = { id: uuidv4(), name, dashboardState, createdAt: new Date().toISOString() };
  db.snapshots.push(snapshot);
  writeDataFile(db);
  res.json({ ok: true, snapshot });
});

// Get snapshots
app.get('/api/snapshots', (req, res) => {
  const db = readDataFile();
  res.json({ ok: true, snapshots: db.snapshots });
});

// A simple endpoint to return app info
app.get('/api/info', (req, res) => {
  res.json({
    ok: true,
    app: 'Data Visualizer',
    version: '1.0.0',
    author: 'HTML + CSS + Javascript GPT-5 Thinking mini'
  });
});

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Bootstrap: create a helpful sample dataset if none exist
function ensureSampleDataset() {
  const db = readDataFile();
  if (!db.datasets || db.datasets.length === 0) {
    const labels = Array.from({ length: 12 }, (_, i) => `2024-${String(i+1).padStart(2,'0')}`);
    const ds = {
      id: uuidv4(),
      name: 'Sample Sales 2024',
      labels,
      series: [
        { name: 'Revenue', data: labels.map(() => Math.floor(500 + Math.random() * 4500)), color: '#007bff' },
        { name: 'Orders', data: labels.map(() => Math.floor(50 + Math.random() * 450)), color: '#28a745' }
      ],
      meta: { currency: 'USD' },
      createdAt: new Date().toISOString()
    };
    db.datasets = db.datasets || [];
    db.datasets.push(ds);
    writeDataFile(db);
    console.log('Sample dataset added.');
  } else {
    console.log('Datasets already exist in data.json.');
  }
}

ensureSampleDataset();

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} (PORT=${PORT})`);
  console.log('Change ADMIN_TOKEN environment variable before selling to secure admin routes.');
});
