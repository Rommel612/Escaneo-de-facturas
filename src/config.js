import 'dotenv/config'

if (!process.env.GEMINI_API_KEY) {
  throw new Error('Falta GEMINI_API_KEY en .env — genera una clave en aistudio.google.com/apikey')
}

export const GEMINI_API_KEY = process.env.GEMINI_API_KEY
export const WHATSAPP_PHONE = process.env.WHATSAPP_PHONE || null
export const PORT = Number(process.env.PORT) || 3000
