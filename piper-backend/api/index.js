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
app.use(cors({
  origin: ['https://flavioalejandrov24-lang.github.io', 'https://compualextech24.github.io'],
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization']
}));
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

// DELETE: Eliminar modelo (permite eliminar CUALQUIER modelo)
app.delete('/api/models/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar que no sea el último modelo
    const { data: allModels } = await supabase
      .from('ia_models')
      .select('id');

    if (allModels && allModels.length <= 1) {
      return res.status(400).json({
        success: false,
        error: 'No puedes eliminar el último modelo'
      });
    }

    // Eliminar el modelo (sin restricción de is_custom)
    const { error } = await supabase
      .from('ia_models')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true, message: 'Modelo eliminado correctamente' });
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
// SISTEMA UNIVERSAL DE DETECCIÓN DE API
// ================================================

// ================================================
// 🌍 INSTRUCCIONES GLOBALES PARA TODAS LAS IAS
// ================================================
// AQUÍ PUEDES AGREGAR O MODIFICAR REGLAS QUE SE APLICARÁN A TODAS LAS IAS
// Estas instrucciones se combinan automáticamente con la personalidad de cada personaje
const INSTRUCCIONES_GLOBALES = `
REGLAS OBLIGATORIAS PARA TODAS LAS RESPUESTAS:

1. FORMATO DE ESCRITURA:
   - NO uses asteriscos (*) para enfatizar texto
   - NO uses emojis en tus respuestas
   - Escribe en texto plano y natural
   - Usa mayúsculas solo cuando sea gramaticalmente correcto

2. ESTILO:
   - Respuestas cortas a menos que el usuario te pida que uses respuestas mas largas
 
3. IDIOMA:
   - SIEMPRE responde en español
   - Usa acentos y puntuación correctamente
   - No uses astericos por ningún motivo al escribir 

IMPORTANTE: Estas reglas son obligatorias y se aplican ANTES de tu personalidad específica.
`;
// ================================================
// FIN DE INSTRUCCIONES GLOBALES
// ================================================

/**
 * Detecta automáticamente el tipo de API basándose en la URL
 */
function detectarTipoAPI(url) {
  if (!url) return 'openai';
  
  const urlLower = url.toLowerCase();
  
  if (urlLower.includes('generativelanguage.googleapis.com')) return 'gemini';
  if (urlLower.includes('api.anthropic.com')) return 'anthropic';
  if (urlLower.includes('api.groq.com')) return 'groq';
  if (urlLower.includes('openrouter.ai')) return 'openrouter';
  
  // Por defecto, asumir formato OpenAI (compatible con la mayoría)
  return 'openai';
}

/**
 * Formatea la petición según el tipo de API detectado
 */
async function llamarAPI(tipoAPI, url, apiKey, message, systemPrompt) {
  // ✅ COMBINAR INSTRUCCIONES GLOBALES CON PERSONALIDAD DEL PERSONAJE
  const systemPromptFinal = systemPrompt 
    ? `${INSTRUCCIONES_GLOBALES}\n\n${systemPrompt}`
    : INSTRUCCIONES_GLOBALES;

  let response, data, resultText;

  try {
    switch (tipoAPI) {
      // ========== GEMINI ==========
      case 'gemini':
        // Extraer nombre del modelo de la URL
        let geminiModel = 'gemini-2.5-flash';
        const matchModel = url.match(/models\/([^:?]+)/);
        if (matchModel) geminiModel = matchModel[1];
        
        // Construir URL con API key
        const geminiUrl = url.includes('?key=') ? url : `${url}?key=${apiKey}`;
        
        response = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: systemPromptFinal 
                  ? `${systemPromptFinal}\n\nUsuario: ${message}` 
                  : message
              }]
            }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 1000
            }
          })
        });
        
        data = await response.json();
        
        if (!response.ok) {
          console.error('Error Gemini:', data);
          throw new Error(data.error?.message || 'Error en Gemini API');
        }
        
        resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sin respuesta';
        break;

      // ========== ANTHROPIC (CLAUDE) ==========
      case 'anthropic':
        const claudeMessages = [];
        if (systemPromptFinal) {
          claudeMessages.push({ role: 'user', content: systemPromptFinal });
          claudeMessages.push({ role: 'assistant', content: 'Entendido.' });
        }
        claudeMessages.push({ role: 'user', content: message });

        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-3-sonnet-20240229',
            messages: claudeMessages,
            max_tokens: 1000
          })
        });
        
        data = await response.json();
        
        if (!response.ok) {
          console.error('Error Claude:', data);
          throw new Error(data.error?.message || 'Error en Claude API');
        }
        
        resultText = data.content?.[0]?.text || 'Sin respuesta';
        break;

      // ========== GROQ ==========
      case 'groq':
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: systemPromptFinal || 'Eres un asistente útil' },
              { role: 'user', content: message }
            ],
            temperature: 0.7,
            max_tokens: 1000
          })
        });
        
        data = await response.json();
        
        if (!response.ok) {
          console.error('Error Groq:', data);
          throw new Error(data.error?.message || 'Error en Groq API');
        }
        
        resultText = data.choices?.[0]?.message?.content || 'Sin respuesta';
        break;

      // ========== OPENROUTER ==========
      case 'openrouter':
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'deepseek/deepseek-chat',
            messages: [
              { role: 'system', content: systemPromptFinal || 'Eres un asistente útil' },
              { role: 'user', content: message }
            ]
          })
        });
        
        data = await response.json();
        
        if (!response.ok) {
          console.error('Error OpenRouter:', data);
          throw new Error(data.error?.message || 'Error en OpenRouter API');
        }
        
        resultText = data.choices?.[0]?.message?.content || 'Sin respuesta';
        break;

      // ========== OPENAI Y COMPATIBLES (DEFAULT) ==========
      default:
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: systemPromptFinal || 'Eres un asistente útil' },
              { role: 'user', content: message }
            ],
            temperature: 0.7,
            max_tokens: 1000
          })
        });
        
        data = await response.json();
        
        if (!response.ok) {
          console.error('Error API:', data);
          throw new Error(data.error?.message || 'Error en API');
        }
        
        resultText = data.choices?.[0]?.message?.content || 'Sin respuesta';
        break;
    }

    return resultText;

  } catch (error) {
    console.error(`Error en llamarAPI (${tipoAPI}):`, error);
    throw error;
  }
}

// ================================================
// CHAT: Enviar mensaje a la IA (UNIVERSAL)
// ================================================
app.post('/api/chat', async (req, res) => {
  try {
    const { model_id, message, system_prompt } = req.body;

    if (!message || message.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Mensaje requerido'
      });
    }

    if (!model_id) {
      return res.status(400).json({
        success: false,
        error: 'model_id requerido'
      });
    }

    // Obtener configuración del modelo desde Supabase
    const { data: modelConfig, error: dbError } = await supabase
      .from('ia_models')
      .select('*')
      .eq('id', model_id)
      .single();

    if (dbError || !modelConfig) {
      console.error('Error buscando modelo:', dbError);
      return res.status(404).json({
        success: false,
        error: 'Modelo no encontrado'
      });
    }

    console.log('📡 Usando modelo:', modelConfig.name);

    // Obtener API Key (custom o de variables de entorno)
    let apiKey = modelConfig.api_key;
    
    // Si no tiene API key custom, buscar en variables de entorno
    if (!apiKey || apiKey.trim() === '') {
      const tipoAPI = detectarTipoAPI(modelConfig.url);
      apiKey = API_KEYS[tipoAPI] || API_KEYS.openrouter;
      console.log('🔑 Usando API key de entorno para:', tipoAPI);
    }

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: 'API Key no configurada para este modelo'
      });
    }

    // Detectar tipo de API automáticamente
    const tipoAPI = detectarTipoAPI(modelConfig.url);
    console.log('🤖 Tipo de API detectado:', tipoAPI);

    // Llamar a la API correspondiente
    const resultText = await llamarAPI(
      tipoAPI,
      modelConfig.url,
      apiKey,
      message,
      system_prompt
    );

    res.json({ success: true, response: resultText });

  } catch (err) {
    console.error('❌ Error en /api/chat:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Error interno del servidor'
    });
  }
});

// ================================================
// EXPORTAR PARA VERCEL
// ================================================

module.exports = app;


