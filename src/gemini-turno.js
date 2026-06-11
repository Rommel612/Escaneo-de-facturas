import { GoogleGenerativeAI } from '@google/generative-ai'

const PROMPT = `Eres un asistente de RRHH. Analiza este mensaje de WhatsApp y extrae los datos de registro de turno en formato JSON con exactamente estas claves:

{
  "empleado": "nombre completo de quien envía el mensaje o se identifica",
  "tipo": "entrada | salida",
  "hora": "hora en formato HH:MM, extrae del texto si la menciona, si no usa null",
  "fecha": "fecha en formato YYYY-MM-DD, extrae del texto si la menciona, si no usa null",
  "observacion": "detalle adicional como a quién releva o cualquier nota relevante, máx 100 caracteres, null si no hay"
}

Reglas:
- tipo debe ser "entrada" si el mensaje indica llegada, inicio de turno, ingreso.
- tipo debe ser "salida" si indica fin de turno, salida, relevo de su puesto.
- Si no puedes determinar el tipo con certeza, usa "entrada".
- Devuelve ÚNICAMENTE el JSON, sin texto adicional ni bloques de código markdown.`

let model = null

function getModel() {
  if (!model) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY_TURNO)
    model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
  }
  return model
}

export async function extractAttendanceData(text) {
  const result = await getModel().generateContent([{ text: PROMPT }, { text }])
  const raw = result.response.text().trim()
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    throw new Error(`Respuesta no parseable: ${raw.slice(0, 200)}`)
  }
}
