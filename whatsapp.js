import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  downloadMediaMessage
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import { mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { extractInvoiceData } from './gemini.js'
import { addExpense, getExpenses } from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UPLOADS_DIR = join(__dirname, 'public', 'uploads')
mkdirSync(UPLOADS_DIR, { recursive: true })

let sockInstance = null
let onExpenseCb = null
let onStatusCb = null
let onPairingCb = null
let pairingRequested = false

export async function connectToWhatsApp(onExpense, onStatus, onPairing) {
  onExpenseCb = onExpense
  onStatusCb = onStatus
  onPairingCb = onPairing
  pairingRequested = false

  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
  })

  sockInstance = sock

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    // Use pairing code instead of QR
    if (qr && !pairingRequested && !sock.authState.creds.registered) {
      pairingRequested = true
      const phone = process.env.WHATSAPP_PHONE
      if (!phone) {
        console.log('\nFalta WHATSAPP_PHONE en .env — no se puede generar pairing code.')
        return
      }
      try {
        await new Promise(r => setTimeout(r, 2000)) // small delay required by Baileys
        const code = await sock.requestPairingCode(phone)
        const formatted = code.match(/.{1,4}/g)?.join('-') || code
        console.log(`\n╔══════════════════════════════╗`)
        console.log(`║  CÓDIGO DE VINCULACIÓN       ║`)
        console.log(`║                              ║`)
        console.log(`║       ${formatted.padEnd(22)}║`)
        console.log(`╚══════════════════════════════╝`)
        console.log(`\nEn WhatsApp → Dispositivos vinculados → Vincular dispositivo`)
        console.log(`→ "Vincular con número de teléfono" → ingresa: ${formatted}\n`)
        if (onPairingCb) onPairingCb(formatted)
      } catch (err) {
        console.error('Error generando pairing code:', err.message)
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      if (onStatusCb) onStatusCb(false)

      if (shouldReconnect) {
        console.log('WhatsApp desconectado — reconectando...')
        connectToWhatsApp(onExpenseCb, onStatusCb, onPairingCb)
      } else {
        console.log('Sesión cerrada. Elimina auth_info_baileys/ y reinicia para vincular de nuevo.')
      }
    } else if (connection === 'open') {
      pairingRequested = false
      console.log('WhatsApp conectado.')
      if (onStatusCb) onStatusCb(true)
    }
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const m of messages) {
      const msgType = Object.keys(m.message || {})[0]
      const isMedia = msgType === 'imageMessage' || msgType === 'documentMessage'

      // Skip own text messages (bot responses), but process own media (self-sent invoices)
      if (m.key.fromMe && !isMedia) continue

      const from = m.key.remoteJid

      if (isMedia) {
        await handleInvoice(sock, m, from, msgType)
      } else if (msgType === 'conversation' || msgType === 'extendedTextMessage') {
        const text = (m.message?.conversation || m.message?.extendedTextMessage?.text || '').toLowerCase().trim()
        if (text === 'ayuda' || text === 'help') {
          await sock.sendMessage(from, { text: buildHelpMsg() })
        } else if (text === 'resumen') {
          await sock.sendMessage(from, { text: buildSummaryMsg() })
        }
      }
    }
  })

  return sock
}

async function handleInvoice(sock, m, from, msgType) {
  await sock.sendMessage(from, { text: 'Analizando factura con IA...' })

  try {
    const buffer = await downloadMediaMessage(m, 'buffer', {})
    const mimeType = msgType === 'imageMessage'
      ? (m.message.imageMessage.mimetype || 'image/jpeg')
      : (m.message.documentMessage.mimetype || 'application/pdf')

    const ext = mimeType.includes('pdf') ? 'pdf' : 'jpg'
    const filename = `${Date.now()}.${ext}`
    writeFileSync(join(UPLOADS_DIR, filename), buffer)

    const data = await extractInvoiceData(buffer, mimeType)
    const expense = addExpense({ ...data, from, imageFile: filename })

    if (onExpenseCb) onExpenseCb(expense)

    await sock.sendMessage(from, { text: buildConfirmMsg(data) })
  } catch (err) {
    console.error('Error procesando factura:', err.message)
    await sock.sendMessage(from, {
      text: 'No pude procesar el documento. Asegúrate de que la imagen sea clara o el PDF sea legible, y vuelve a intentarlo.'
    })
  }
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

function buildHelpMsg() {
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

function buildSummaryMsg() {
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

function fmt(n) {
  return (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function cap(s) {
  return String(s).charAt(0).toUpperCase() + String(s).slice(1)
}

export function getSock() {
  if (!sockInstance) throw new Error('WhatsApp no está conectado todavía')
  return sockInstance
}
