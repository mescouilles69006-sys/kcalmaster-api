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
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// ── Variables ────────────────────────────────────────────────
const GROQ_API_KEY   = process.env.GROQ_API_KEY;
const GROQ_URL       = 'https://api.groq.com/openai/v1/chat/completions';

const GROQ_CHAT_MODEL   = 'llama-3.3-70b-versatile';
const GROQ_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

// ── Google Fit OAuth ─────────────────────────────────────────
const GFIT_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || '241850404756-f3mulk7lvrgsos28gcah1gi9nuie6jd8.apps.googleusercontent.com';
const GFIT_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET; // à configurer dans Render
const GFIT_REDIRECT_URI  = 'https://kcalmaster-api.onrender.com/api/gfit/callback';
const GFIT_SCOPES        = [
  'https://www.googleapis.com/auth/fitness.activity.read',
  'https://www.googleapis.com/auth/fitness.sleep.read',
  'https://www.googleapis.com/auth/fitness.heart_rate.read'
].join(' ');

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

// ════════════════════════════════════════════════════════════
// ── GOOGLE FIT OAUTH ─────────────────────────────────────────
// ════════════════════════════════════════════════════════════

/**
 * ÉTAPE 1 — Redirige vers la page de connexion Google
 * L'app ouvre : https://kcalmaster-api.onrender.com/api/gfit/auth
 */
app.get('/api/gfit/auth', (req, res) => {
  if (!GFIT_CLIENT_SECRET) {
    return res.status(500).send(`
      <html><body style="font-family:sans-serif;padding:40px;background:#1a1a2e;color:#fff">
        <h2>❌ GOOGLE_CLIENT_SECRET manquant</h2>
        <p>Ajoute la variable d'environnement <strong>GOOGLE_CLIENT_SECRET</strong> dans Render → Environment.</p>
      </body></html>
    `);
  }

  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id:     GFIT_CLIENT_ID,
    redirect_uri:  GFIT_REDIRECT_URI,
    scope:         GFIT_SCOPES,
    response_type: 'code',
    access_type:   'offline',
    prompt:        'consent'
  }).toString();

  console.log('🔗 /api/gfit/auth — redirect to Google OAuth');
  res.redirect(authUrl);
});

/**
 * ÉTAPE 2 — Google redirige ici après connexion
 * Le serveur échange le code contre un token
 * puis redirige vers https://localhost/#access_token=XXX
 * (détecté par l'InAppBrowser Cordova via loadstart)
 */
app.get('/api/gfit/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) {
    console.warn('⚠️ /api/gfit/callback — annulé ou erreur:', error);
    return res.redirect('https://localhost/#gfit_error=' + encodeURIComponent(error || 'cancelled'));
  }

  if (!GFIT_CLIENT_SECRET) {
    return res.redirect('https://localhost/#gfit_error=missing_secret');
  }

  try {
    console.log('🔄 /api/gfit/callback — échange du code contre un token…');

    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     GFIT_CLIENT_ID,
        client_secret: GFIT_CLIENT_SECRET,
        redirect_uri:  GFIT_REDIRECT_URI,
        grant_type:    'authorization_code'
      }).toString()
    });

    const tokenData = await tokenResp.json();

    if (!tokenResp.ok) {
      console.error('❌ Token exchange failed:', tokenData);
      throw new Error(tokenData.error_description || tokenData.error || 'Token exchange failed');
    }

    const { access_token, expires_in, refresh_token } = tokenData;
    console.log('✅ Token Google Fit obtenu — expires_in:', expires_in);

    // Rediriger vers localhost avec le token dans le fragment (#)
    // → Détecté par l'InAppBrowser Cordova via l'événement loadstart
    const redirectUrl = 'https://localhost/#' + new URLSearchParams({
      gfit_token:      access_token,
      gfit_expires_in: String(expires_in || 3600),
      gfit_refresh:    refresh_token || ''
    }).toString();

    res.redirect(redirectUrl);

  } catch (err) {
    console.error('❌ /api/gfit/callback error:', err.message);
    res.redirect('https://localhost/#gfit_error=' + encodeURIComponent(err.message));
  }
});

/**
 * ÉTAPE 3 — Proxy Google Fit API
 * L'app envoie son token, le serveur appelle Google Fit et retourne les données
 * POST /api/gfit/data  { startMs, endMs }
 * Header : Authorization: Bearer <access_token>
 */
app.post('/api/gfit/data', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant — connecte-toi à Google Fit d\'abord' });
  }

  const token = authHeader.split(' ')[1];
  const { startMs, endMs } = req.body;

  if (!startMs || !endMs) {
    return res.status(400).json({ error: 'startMs et endMs requis' });
  }

  const fitHeaders = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  const aggregateBody = (dataTypeName) => JSON.stringify({
    aggregateBy: [{ dataTypeName }],
    bucketByTime: { durationMillis: 86400000 },
    startTimeMillis: startMs,
    endTimeMillis: endMs
  });

  try {
    const [stepsResp, calResp] = await Promise.all([
      fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
        method: 'POST', headers: fitHeaders,
        body: aggregateBody('com.google.step_count.delta')
      }),
      fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
        method: 'POST', headers: fitHeaders,
        body: aggregateBody('com.google.calories.expended')
      })
    ]);

    // Récupérer les sessions sommeil
    const sleepResp = await fetch(
      `https://www.googleapis.com/fitness/v1/users/me/sessions?startTime=${new Date(startMs - 86400000).toISOString()}&endTime=${new Date(endMs).toISOString()}&activityType=72`,
      { headers: fitHeaders }
    );

    if (stepsResp.status === 401 || calResp.status === 401) {
      return res.status(401).json({ error: 'Token expiré — reconnecte-toi à Google Fit' });
    }

    const [stepsData, calData, sleepData] = await Promise.all([
      stepsResp.json(), calResp.json(), sleepResp.json()
    ]);

    // ── Extraire les pas ──
    let steps = 0;
    ((stepsData.bucket || [])[0]?.dataset || []).forEach(ds => {
      (ds.point || []).forEach(pt => {
        steps += (pt.value || []).reduce((a, v) => a + (v.intVal || 0), 0);
      });
    });

    // ── Extraire les calories brûlées ──
    let calBurned = 0;
    ((calData.bucket || [])[0]?.dataset || []).forEach(ds => {
      (ds.point || []).forEach(pt => {
        calBurned += (pt.value || []).reduce((a, v) => a + (v.fpVal || 0), 0);
      });
    });

    // ── Extraire le sommeil ──
    let sleepHours = 0;
    (sleepData.session || []).forEach(sess => {
      sleepHours += (parseInt(sess.endTimeMillis) - parseInt(sess.startTimeMillis)) / 3600000;
    });

    // ── Distance estimée depuis pas ──
    const distKm = parseFloat((steps * 0.00075).toFixed(2));

    console.log(`📊 /api/gfit/data — steps:${steps} cal:${Math.round(calBurned)} sleep:${sleepHours.toFixed(1)}h dist:${distKm}km`);

    res.json({
      steps,
      calBurned: Math.round(calBurned),
      sleepHours: parseFloat(sleepHours.toFixed(1)),
      distKm
    });

  } catch (err) {
    console.error('❌ /api/gfit/data error:', err);
    res.status(500).json({ error: err.message || 'Erreur Google Fit' });
  }
});

/**
 * ÉTAPE 4 (optionnel) — Rafraîchir le token avec le refresh_token
 * POST /api/gfit/refresh  { refresh_token }
 */
app.post('/api/gfit/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(400).json({ error: 'refresh_token requis' });
  if (!GFIT_CLIENT_SECRET) return res.status(500).json({ error: 'GOOGLE_CLIENT_SECRET manquant' });

  try {
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token,
        client_id:     GFIT_CLIENT_ID,
        client_secret: GFIT_CLIENT_SECRET,
        grant_type:    'refresh_token'
      }).toString()
    });

    const data = await tokenResp.json();
    if (!tokenResp.ok) throw new Error(data.error_description || 'Refresh failed');

    res.json({
      access_token: data.access_token,
      expires_in:   data.expires_in || 3600
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
  console.log(`🏃 Google Fit  : ${GFIT_CLIENT_SECRET ? '✅ secret configuré' : '⚠️ GOOGLE_CLIENT_SECRET manquant'}`);
});
