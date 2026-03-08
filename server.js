const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// Variables
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Route de santé
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'KcalMaster API with Groq is running' });
});

// Route principale pour Groq API
app.post('/api/claude', async (req, res) => {
  try {
    // Validation
    if (!GROQ_API_KEY) {
      return res.status(500).json({ error: 'GROQ_API_KEY not configured' });
    }

    const { messages, model = 'mixtral-8x7b-32768', max_tokens = 1000 } = req.body;

    // Vérifier les paramètres
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    console.log(`📡 Groq API call with model: ${model}`);

    // Appeler Groq API (compatible OpenAI)
    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens,
        temperature: 0.7
      })
    });

    // Vérifier la réponse
    if (!response.ok) {
      const errorData = await response.json();
      console.error('Groq API error:', errorData);
      return res.status(response.status).json({
        error: errorData.error?.message || 'Groq API error',
        status: response.status
      });
    }

    const data = await response.json();
    
    // Convertir le format Groq/OpenAI au format Claude
    const claudeFormat = {
      content: [
        {
          type: 'text',
          text: data.choices[0].message.content
        }
      ]
    };

    res.json(claudeFormat);

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({
      error: 'Server error: ' + error.message
    });
  }
});

// Route pour Vision (images)
app.post('/api/vision', async (req, res) => {
  try {
    if (!GROQ_API_KEY) {
      return res.status(500).json({ error: 'GROQ_API_KEY not configured' });
    }

    const { image_base64, prompt = 'Analysez ce repas' } = req.body;

    if (!image_base64) {
      return res.status(400).json({ error: 'image_base64 is required' });
    }

    console.log('📷 Vision request');

    // Appeler Groq avec Vision (si supporté)
    // Note: Groq supporte aussi les images avec certains modèles
    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'mixtral-8x7b-32768',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${image_base64}`
                }
              }
            ]
          }
        ],
        max_tokens: 1024
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Vision error:', errorData);
      return res.status(response.status).json({ error: errorData.error?.message });
    }

    const data = await response.json();
    
    // Convertir au format Claude
    const claudeFormat = {
      content: [
        {
          type: 'text',
          text: data.choices[0].message.content
        }
      ]
    };

    res.json(claudeFormat);

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
  console.log(`🚀 KcalMaster API with Groq running on http://${HOST}:${PORT}`);
  console.log(`📡 Groq endpoint: POST http://${HOST}:${PORT}/api/claude`);
  console.log(`✅ This API is free and unlimited!`);
});
