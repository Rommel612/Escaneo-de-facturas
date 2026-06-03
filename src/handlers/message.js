import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { mkdirSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { extractInvoiceData } from '../services/gemini.js'
import { addExpense, getExpenses, findByHash, findByInvoiceNumber } from '../services/storage.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UPLOADS_DIR = join(__dirname, '../../public/uploads')
mkdirSync(UPLOADS_DIR, { recursive: true })

export async function handleInvoice(sock, m, from, msgType, onExpenseCb) {
  const MAX_BYTES = 10 * 1024 * 1024 // 10 MB
  const fileLength =
    m.message?.imageMessage?.fileLength ||
    m.message?.documentMessage?.fileLength ||
    0

  if (Number(fileLength) > MAX_BYTES) {
    await sock.sendMessage(from, {
      text: 'El archivo es demasiado grande (máximo 10 MB). Comprime la imagen o el PDF e inténtalo de nuevo.'
    })
    return
  }

  await sock.sendMessage(from, { text: 'Analizando factura...' })

  try {
    const buffer = await downloadMediaMessage(m, 'buffer', {})
    const mimeType = msgType === 'imageMessage'
      ? (m.message.imageMessage.mimetype || 'image/jpeg')
      : (m.message.documentMessage.mimetype || 'application/pdf')

    // Primera capa: hash SHA-256 del archivo
    const hash = createHash('sha256').update(buffer).digest('hex')
    const hashDuplicate = findByHash(hash)
    if (hashDuplicate) {
      await sock.sendMessage(from, {
        text: `Esta factura ya fue registrada anteriormente.\n\nProveedor: ${hashDuplicate.proveedor || 'desconocido'}\nNo. Factura: ${hashDuplicate.numero_factura || 'sin número'}\nFecha: ${hashDuplicate.fecha || 'sin fecha'}\nTotal: ${hashDuplicate.moneda || 'USD'} ${fmt(hashDuplicate.total)}`
      })
      return
    }

    const ext = mimeType.includes('pdf') ? 'pdf' : 'jpg'
    const filename = `${Date.now()}.${ext}`
    writeFileSync(join(UPLOADS_DIR, filename), buffer)

    const data = await extractInvoiceData(buffer, mimeType)

    // Segunda capa: verificar número de factura + proveedor
    // Solo si Gemini logró extraer el número (si es null, se omite esta verificación)
    if (data.numero_factura) {
      const invoiceDuplicate = findByInvoiceNumber(data.numero_factura)
      if (invoiceDuplicate) {
        await sock.sendMessage(from, {
          text: `Esta factura ya fue registrada anteriormente.\n\nProveedor: ${invoiceDuplicate.proveedor || 'desconocido'}\nNo. Factura: ${invoiceDuplicate.numero_factura}\nFecha: ${invoiceDuplicate.fecha || 'sin fecha'}\nTotal: ${invoiceDuplicate.moneda || 'USD'} ${fmt(invoiceDuplicate.total)}`
        })
        return
      }
    }

    const expense = addExpense({ ...data, from, imageFile: filename, hash })

    if (onExpenseCb) onExpenseCb(expense)

    await sock.sendMessage(from, { text: buildConfirmMsg(data) })
  } catch (err) {
    const isGeminiError = err.message?.includes('Gemini') || err.message?.includes('API') || err.message?.includes('quota')
    const label = isGeminiError ? '[Gemini]' : '[handleInvoice]'
    console.error(`${label} Error procesando factura de ${from}:`, err.message)
    console.error(err.stack)

    const userMsg = isGeminiError
      ? 'Hubo un problema al analizar la imagen con IA. Puede ser un límite de uso temporal, intenta en unos minutos.'
      : 'No pude procesar el documento. Asegúrate de que la imagen sea clara o el PDF sea legible, y vuelve a intentarlo.'

    await sock.sendMessage(from, { text: userMsg })
  }
}

export function buildHelpMsg() {
  return [
    '*Panel de Facturas — Bot contable*',
    '',
    'Envíame una *foto* o *PDF* de cualquier factura o recibo y la procesaré automáticamente con IA.',
    '',
    'Comandos disponibles:',
    '• *ayuda* — este mensaje',
    '• *resumen* — total de gastos del día de hoy'
  ].join('\n')
}

export function buildSummaryMsg() {
  const today = new Date().toISOString().split('T')[0]
  const all = getExpenses()
  const todayItems = all.filter(e =>
    (e.fecha && e.fecha === today) || e.createdAt?.startsWith(today)
  )
  if (todayItems.length === 0) return 'No hay facturas registradas hoy.'

  const total = todayItems.reduce((s, e) => s + (Number(e.total) || 0), 0)
  const byCategory = {}
  todayItems.forEach(e => {
    const cat = e.categoria || 'otro'
    byCategory[cat] = (byCategory[cat] || 0) + (Number(e.total) || 0)
  })

  const catLines = Object.entries(byCategory)
    .map(([k, v]) => `  ${cap(k)}: $${fmt(v)}`)
    .join('\n')

  return [
    `*Resumen — ${today}*`,
    '',
    `${todayItems.length} factura(s)`,
    `Total: $${fmt(total)}`,
    '',
    catLines
  ].join('\n')
}

function buildConfirmMsg(d) {
  const currency = d.moneda || 'USD'
  const lines = [
    '*Factura registrada*',
    '',
    `Proveedor: ${d.proveedor || 'Sin identificar'}`,
    `Fecha: ${d.fecha || 'No disponible'}`,
    `Total: ${currency} ${fmt(d.total)}`,
    d.iva > 0 ? `Impuestos: ${currency} ${fmt(d.iva)}` : null,
    `Categoría: ${cap(d.categoria || 'otro')}`,
    d.descripcion ? `Concepto: ${d.descripcion}` : null,
    '',
    'Los datos ya aparecen en el panel web.'
  ]
  return lines.filter(l => l !== null).join('\n')
}

function fmt(n) {
  return (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function cap(s) {
  return String(s).charAt(0).toUpperCase() + String(s).slice(1)
}
