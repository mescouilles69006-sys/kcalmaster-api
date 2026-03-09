// ============================================================
// KcalMaster API — Serveur Render
// Compatible : Firebase Auth + Cordova (file://) + WebIntoApp
// ============================================================

const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS ─────────────────────────────────────────────────────
// Accepte : navigateurs web, WebIntoApp, Cordova (file://)
const ALLOWED_ORIGINS = [
  'https://monappwebintoapp.firebaseapp.com',
  'https://kcalmaster-api.onrender.com',
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'http://localhost:3000',
  'http://localhost:8080',
  'http://127.0.0.1',
];

app.use(cors({
  origin: function(origin, callback) {
    // Autoriser les requêtes sans origin (Cordova file://, Postman, etc.)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin) || origin.startsWith('file://')) {
      return callback(null, true);
    }
    // En production on peut être plus strict ; pour l'instant on laisse passer
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' })); // Augmenté pour les images base64

// ── HEALTH CHECK ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'KcalMaster API', version: '2.0.0' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ── HELPER : appel Anthropic avec retry ──────────────────────
async function callAnthropic(body, retries = 2) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY non configurée sur le serveur');

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        timeout: 30000
      });

      const data = await response.json();

      if (!response.ok) {
        // Overload (529) ou rate limit (429) → retry
        if ((response.status === 529 || response.status === 429) && attempt < retries) {
          const wait = (attempt + 1) * 3000;
          console.warn(`⚠️ Anthropic ${response.status} — retry ${attempt+1} in ${wait}ms`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        throw new Error(data.error?.message || `Anthropic error ${response.status}`);
      }

      return data;
    } catch (err) {
      if (attempt < retries && (err.code === 'ECONNRESET' || err.type === 'request-timeout')) {
        console.warn(`🔌 Network error — retry ${attempt+1}`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw err;
    }
  }
}

// ── ROUTE : /api/claude — Texte ──────────────────────────────
app.post('/api/claude', async (req, res) => {
  try {
    const { messages, model = 'claude-sonnet-4-6', max_tokens = 1000 } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: { message: 'messages[] requis' } });
    }

    console.log(`📨 /api/claude — model:${model} max_tokens:${max_tokens} msgs:${messages.length}`);

    const data = await callAnthropic({ model, max_tokens, messages });

    console.log(`✅ /api/claude — tokens: ${data.usage?.output_tokens || '?'}`);
    res.json(data);

  } catch (err) {
    console.error('❌ /api/claude error:', err.message);
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── ROUTE : /api/vision — Image + texte ──────────────────────
app.post('/api/vision', async (req, res) => {
  try {
    const { image_base64, media_type = 'image/jpeg', prompt } = req.body;

    if (!image_base64 || !prompt) {
      return res.status(400).json({ error: { message: 'image_base64 et prompt requis' } });
    }

    console.log(`📸 /api/vision — image size: ${Math.round(image_base64.length / 1024)}KB`);

    const messages = [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: media_type,
            data: image_base64
          }
        },
        {
          type: 'text',
          text: prompt
        }
      ]
    }];

    const data = await callAnthropic({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages
    });

    console.log(`✅ /api/vision — tokens: ${data.usage?.output_tokens || '?'}`);
    res.json(data);

  } catch (err) {
    console.error('❌ /api/vision error:', err.message);
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── DÉMARRAGE ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 KcalMaster API démarrée sur le port ${PORT}`);
  console.log(`🔑 Clé Anthropic: ${process.env.ANTHROPIC_API_KEY ? '✅ configurée' : '❌ MANQUANTE'}`);
});
