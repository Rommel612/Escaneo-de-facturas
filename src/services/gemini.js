import { GoogleGenerativeAI } from '@google/generative-ai'
import { GEMINI_API_KEY } from '../config.js'

const PROMPT = `Analiza este documento. Puede ser una factura comercial o un comprobante de transferencia bancaria.

Extrae los siguientes campos y devuelve ÚNICAMENTE un objeto JSON válido, sin texto adicional, sin markdown, sin bloques de código:

{
  "proveedor": "Si es factura: nombre del proveedor. Si es comprobante de transferencia: solo el PRIMER NOMBRE y PRIMER APELLIDO del beneficiario que aparece después de 'Para:'. Nunca extraer el campo 'De:'",
  "numero_factura": "Si es factura: número de factura. Si es comprobante: número de comprobante",
  "fecha": "Fecha del documento en formato YYYY-MM-DD",
  "total": "Monto total como número decimal sin símbolos de moneda",
  "subtotal": "Subtotal antes de impuestos si existe, sino igual al total",
  "iva": "Monto de IVA como número decimal, 0 si no existe",
  "moneda": "Código de moneda: USD, EUR, etc.",
  "banco": "Nombre del banco si es visible en el documento (Pichincha, Produbanco, BGR u otro nombre que aparezca). null si no es visible",
  "categoria": "Infiere la categoría más apropiada entre estas opciones únicamente: IESS, Sueldos, Adelantos, Otro",
  "descripcion": "Si es factura: descripción breve del concepto. Si es comprobante: tipo de transferencia (ej: Transferencia Local, Transferencia Internacional). No incluir datos del remitente ni del destinatario"
}

Reglas estrictas:
- En comprobantes de transferencia: el campo 'proveedor' es SOLO el primer nombre y primer apellido del beneficiario (campo 'Para:'). Ignorar completamente el campo 'De:'
- Nunca devolver null en campos de texto, usar string vacío "" si no se encuentra el dato
- El campo 'total' y 'iva' siempre deben ser números, nunca strings
- No incluir explicaciones, solo el JSON`

let model = null

function getModel() {
  if (!model) {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
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
        const wait = attempt * 15000
        console.log(`Gemini rate limit — reintentando en ${wait / 1000}s (intento ${attempt}/${retries})`)
        await new Promise(r => setTimeout(r, wait))
        continue
      }

      throw err
    }
  }
}
