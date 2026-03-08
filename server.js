const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// Variables
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// Route de santé
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'KcalMaster API is running' });
});

// Route principale pour Claude API
app.post('/api/claude', async (req, res) => {
  try {
    // Validation
    if (!ANTHROPIC_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    const { messages, model = 'claude-opus-4-5', max_tokens = 1000 } = req.body;

    // Vérifier les paramètres
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    // Appeler Claude API
    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        max_tokens,
        messages
      })
    });

    // Vérifier la réponse
    if (!response.ok) {
      const errorData = await response.json();
      console.error('Claude API error:', errorData);
      return res.status(response.status).json({
        error: errorData.error?.message || 'Claude API error',
        status: response.status
      });
    }

    const data = await response.json();
    res.json(data);

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({
      error: 'Server error: ' + error.message
    });
  }
});

// Route pour Vision API (photos de repas)
app.post('/api/vision', async (req, res) => {
  try {
    if (!ANTHROPIC_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    const { image_base64, prompt = 'Analysez ce repas' } = req.body;

    if (!image_base64) {
      return res.status(400).json({ error: 'image_base64 is required' });
    }

    // Appeler Claude avec Vision
    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: image_base64
                }
              },
              {
                type: 'text',
                text: prompt
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Vision API error:', errorData);
      return res.status(response.status).json({ error: errorData.error?.message });
    }

    const data = await response.json();
    res.json(data);

  } catch (error) {
    console.error('Vision error:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

// Gestion des erreurs
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Démarrer le serveur
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`🚀 KcalMaster API running on http://${HOST}:${PORT}`);
  console.log(`📡 Health check: GET http://${HOST}:${PORT}/health`);
  console.log(`🤖 Claude endpoint: POST http://${HOST}:${PORT}/api/claude`);
  console.log(`📷 Vision endpoint: POST http://${HOST}:${PORT}/api/vision`);
});
