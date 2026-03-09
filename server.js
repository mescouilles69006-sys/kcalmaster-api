const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
require('dotenv').config();

const app = express();

// ── Middleware ───────────────────────────────────────────────
app.use(express.json({ limit: '20mb' }));

// CORS élargi : accepte navigateurs, WebIntoApp, Cordova (file://)
app.use(cors({
  origin: function(origin, callback) {
    // Pas d'origin = Cordova (file://), Postman, WebIntoApp → autoriser
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// ── Variables ────────────────────────────────────────────────
const GROQ_API_KEY   = process.env.GROQ_API_KEY;
const GROQ_URL       = 'https://api.groq.com/openai/v1/chat/completions';

// Modèles Groq valides (Mars 2026)
const GROQ_CHAT_MODEL   = 'llama-3.3-70b-versatile';
const GROQ_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

// ── Helper : appel Groq avec retry ──────────────────────────
async function callGroq(body, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (!response.ok) {
        if ((response.status === 429 || response.status === 503) && attempt < retries) {
          const wait = (attempt + 1) * 3000;
          console.warn(`⚠️ Groq ${response.status} — retry ${attempt + 1}/${retries} dans ${wait}ms`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        throw { status: response.status, message: data.error?.message || `Groq error ${response.status}` };
      }

      return data;

    } catch (err) {
      if (err.status) throw err;
      if (attempt < retries) {
        console.warn(`🔌 Erreur réseau — retry ${attempt + 1}/${retries}`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw { status: 500, message: err.message };
    }
  }
}

// ── Route santé ──────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'KcalMaster API (Groq)' });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'KcalMaster API with Groq is running',
    models: { chat: GROQ_CHAT_MODEL, vision: GROQ_VISION_MODEL }
  });
});

// ── Route /api/claude — Chat texte ───────────────────────────
app.post('/api/claude', async (req, res) => {
  try {
    if (!GROQ_API_KEY) {
      return res.status(500).json({ error: 'GROQ_API_KEY not configured on server' });
    }

    const { messages, max_tokens = 1000 } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages[] requis' });
    }

    console.log(`📡 /api/claude — model: ${GROQ_CHAT_MODEL} max_tokens: ${max_tokens}`);

    const data = await callGroq({
      model: GROQ_CHAT_MODEL,
      messages,
      max_tokens,
      temperature: 0.7
    });

    // Format Groq/OpenAI → format Claude (attendu par l'app)
    res.json({
      content: [{ type: 'text', text: data.choices[0].message.content }]
    });

  } catch (err) {
    console.error('❌ /api/claude error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
});

// ── Route /api/vision — Analyse d'image ─────────────────────
app.post('/api/vision', async (req, res) => {
  try {
    if (!GROQ_API_KEY) {
      return res.status(500).json({ error: 'GROQ_API_KEY not configured on server' });
    }

    const { image_base64, prompt = 'Analysez ce repas' } = req.body;
    if (!image_base64) {
      return res.status(400).json({ error: 'image_base64 requis' });
    }

    console.log(`📷 /api/vision — model: ${GROQ_VISION_MODEL}`);

    const data = await callGroq({
      model: GROQ_VISION_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image_base64}` } }
        ]
      }],
      max_tokens: 1024
    });

    res.json({
      content: [{ type: 'text', text: data.choices[0].message.content }]
    });

  } catch (err) {
    console.error('❌ /api/vision error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
});

// ── Erreurs globales ─────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Démarrage ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`🚀 KcalMaster API with Groq running on http://${HOST}:${PORT}`);
  console.log(`📡 Chat model  : ${GROQ_CHAT_MODEL}`);
  console.log(`📷 Vision model: ${GROQ_VISION_MODEL}`);
  console.log(`🔑 GROQ_API_KEY: ${GROQ_API_KEY ? '✅ configurée' : '❌ MANQUANTE'}`);
});
