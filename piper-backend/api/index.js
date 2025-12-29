// ================================================
// BACKEND SEGURO PARA PIPER IA APP
// ================================================

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ================================================
// CONFIGURACIÓN
// ================================================

// Middleware
app.use(cors()); // Permite llamadas desde cualquier origen
app.use(express.json({ limit: '10mb' })); // Para recibir imágenes en base64

// Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// API Keys (seguras en variables de entorno)
const API_KEYS = {
  openrouter: process.env.OPENROUTER_API_KEY,
  groq: process.env.GROQ_API_KEY,
  gemini: process.env.GEMINI_API_KEY
};

// ================================================
// ENDPOINT: Health Check
// ================================================
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Piper Backend funcionando correctamente' 
  });
});

// ================================================
// MODELOS DE IA
// ================================================

// GET: Obtener todos los modelos
app.get('/api/models', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('ia_models')
      .select('id, name, url, is_custom')
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    res.json({ success: true, models: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Agregar nuevo modelo personalizado
app.post('/api/models', async (req, res) => {
  try {
    const { name, url, api_key } = req.body;
    
    if (!name || !url || !api_key) {
      return res.status(400).json({ 
        success: false, 
        error: 'Faltan campos requeridos' 
      });
    }

    const { data, error } = await supabase
      .from('ia_models')
      .insert([{ name, url, api_key, is_custom: true }])
      .select()
      .single();
    
    if (error) throw error;
    res.json({ success: true, model: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE: Eliminar modelo personalizado
app.delete('/api/models/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { error } = await supabase
      .from('ia_models')
      .delete()
      .eq('id', id)
      .eq('is_custom', true); // Solo permitir eliminar modelos custom
    
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================================================
// PERSONAJES
// ================================================

// GET: Obtener todos los personajes
app.get('/api/personajes', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('personajes')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json({ success: true, personajes: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Crear nuevo personaje
app.post('/api/personajes', async (req, res) => {
  try {
    const { name, persona, model_id, model_name, voice, rate, pitch, image_base64 } = req.body;
    
    if (!name || !voice) {
      return res.status(400).json({ 
        success: false, 
        error: 'Nombre y voz son requeridos' 
      });
    }

    let image_url = null;

    // Si hay imagen, subirla a Supabase Storage
    if (image_base64 && image_base64.startsWith('data:image')) {
      const base64Data = image_base64.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      const fileName = `${Date.now()}_${name.replace(/\s/g, '_')}.jpg`;
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('personajes-avatars')
        .upload(fileName, buffer, {
          contentType: 'image/jpeg',
          upsert: false
        });

      if (uploadError) throw uploadError;

      // Obtener URL pública
      const { data: urlData } = supabase.storage
        .from('personajes-avatars')
        .getPublicUrl(fileName);
      
      image_url = urlData.publicUrl;
    }

    // Insertar personaje
    const { data, error } = await supabase
      .from('personajes')
      .insert([{
        name,
        persona,
        model_id,
        model_name,
        voice,
        rate: parseFloat(rate) || 1.0,
        pitch: parseFloat(pitch) || 0.667,
        image_url
      }])
      .select()
      .single();
    
    if (error) throw error;
    res.json({ success: true, personaje: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE: Eliminar personaje
app.delete('/api/personajes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Obtener info del personaje para eliminar su imagen
    const { data: personaje } = await supabase
      .from('personajes')
      .select('image_url')
      .eq('id', id)
      .single();

    // Eliminar imagen si existe
    if (personaje?.image_url) {
      const fileName = personaje.image_url.split('/').pop();
      await supabase.storage
        .from('personajes-avatars')
        .remove([fileName]);
    }

    // Eliminar personaje
    const { error } = await supabase
      .from('personajes')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================================================
// CHAT: Enviar mensaje a la IA
// ================================================
app.post('/api/chat', async (req, res) => {
  try {
    const { model_id, model_name, message, system_prompt } = req.body;

    if (!message) {
      return res.status(400).json({ 
        success: false, 
        error: 'Mensaje requerido' 
      });
    }

    let modelConfig = null;
    let apiKey = null;

    // Determinar si es modelo predeterminado o personalizado
    if (model_id) {
      const { data } = await supabase
        .from('ia_models')
        .select('*')
        .eq('id', model_id)
        .single();
      
      modelConfig = data;
      apiKey = data.is_custom ? data.api_key : null;
    }

    let response;
    let resultText = '';

    // ==== DEEPSEEK (OpenRouter) ====
    if (model_name === 'deepseek' || (modelConfig?.name.includes('DeepSeek'))) {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey || API_KEYS.openrouter}`
        },
        body: JSON.stringify({
          model: 'deepseek/deepseek-chat',
          messages: [
            { role: 'system', content: system_prompt || 'Eres un asistente útil' },
            { role: 'user', content: message }
          ]
        })
      });
      const data = await response.json();
      resultText = data.choices?.[0]?.message?.content || 'Error en DeepSeek';
    }
    
    // ==== GROQ ====
    else if (model_name === 'groq' || (modelConfig?.name.includes('Groq'))) {
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey || API_KEYS.groq}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: system_prompt || 'Eres un asistente útil' },
            { role: 'user', content: message }
          ],
          max_tokens: 150
        })
      });
      const data = await response.json();
      resultText = data.choices?.[0]?.message?.content || 'Error en Groq';
    }
    
    // ==== GEMINI ====
    else if (model_name === 'gemini' || (modelConfig?.name.includes('Gemini'))) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey || API_KEYS.gemini}`;
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${system_prompt || ''} Usuario: ${message}` }] }]
        })
      });
      const data = await response.json();
      resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Error en Gemini';
    }
    
    // ==== MODELO PERSONALIZADO ====
    else if (modelConfig?.is_custom) {
      response = await fetch(modelConfig.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${modelConfig.api_key}`
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: system_prompt || 'Eres un asistente útil' },
            { role: 'user', content: message }
          ],
          max_tokens: 150
        })
      });
      const data = await response.json();
      resultText = data.choices?.[0]?.message?.content || 'Error en modelo personalizado';
    }
    
    else {
      return res.status(400).json({ 
        success: false, 
        error: 'Modelo no reconocido' 
      });
    }

    res.json({ success: true, response: resultText });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================================================
// INICIAR SERVIDOR
// ================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Backend corriendo en puerto ${PORT}`);
});

module.exports = app; // Para Vercel