import { GoogleGenerativeAI } from '@google/generative-ai'

const PROMPT = `Eres un asistente contable. Analiza este documento (imagen o PDF de factura, recibo o comprobante de pago) y extrae los datos en formato JSON con exactamente estas claves:

{
  "proveedor": "nombre del proveedor o emisor",
  "fecha": "fecha de emisión en formato YYYY-MM-DD",
  "total": <número con el monto total a pagar>,
  "subtotal": <número del subtotal antes de impuestos, igual al total si no hay desglose>,
  "iva": <número del monto de impuestos (IVA, tax, GST, etc.), 0 si no aplica>,
  "moneda": "código de moneda ISO (USD, MXN, EUR, etc.)",
  "numero_factura": "número, folio o referencia del documento",
  "categoria": "una de: alimentacion | transporte | oficina | servicios | tecnologia | salud | otro",
  "descripcion": "descripción breve de los conceptos o servicios (máx 80 caracteres)"
}

Reglas:
- Usa null para strings no encontrados, 0 para números no encontrados.
- La categoría debe ser la más apropiada según el giro del proveedor.
- Devuelve ÚNICAMENTE el JSON, sin texto adicional ni bloques de código markdown.`

let model = null

function getModel() {
  if (!model) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
  }
  return model
}

export async function extractInvoiceData(mediaBuffer, mimeType, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await getModel().generateContent([
        { text: PROMPT },
        {
          inlineData: {
            data: mediaBuffer.toString('base64'),
            mimeType
          }
        }
      ])

      const raw = result.response.text().trim()
      const cleaned = raw
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim()

      try {
        return JSON.parse(cleaned)
      } catch {
        const match = cleaned.match(/\{[\s\S]*\}/)
        if (match) return JSON.parse(match[0])
        throw new Error(`Respuesta no parseable: ${raw.slice(0, 200)}`)
      }
    } catch (err) {
      const is429 = err.message?.includes('429') || err.message?.includes('quota') || err.message?.includes('Too Many')
      const isInvalidKey = err.message?.includes('API_KEY_INVALID') || err.message?.includes('invalid') || err.message?.includes('limit: 0')

      if (isInvalidKey) {
        throw new Error('API key de Gemini inválida. Ve a aistudio.google.com/apikey y genera una clave que empiece con AIza.')
      }

      if (is429 && attempt < retries) {
        const wait = attempt * 15000 // 15s, 30s
        console.log(`Gemini rate limit — reintentando en ${wait / 1000}s (intento ${attempt}/${retries})`)
        await new Promise(r => setTimeout(r, wait))
        continue
      }

      throw err
    }
  }
}
