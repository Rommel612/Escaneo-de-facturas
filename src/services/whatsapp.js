import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState
} from '@whiskeysockets/baileys'
import pino from 'pino'
import { EventEmitter } from 'events'
import { WHATSAPP_PHONE } from '../config.js'
import { handleInvoice, buildHelpMsg, buildSummaryMsg } from '../handlers/message.js'

export const waEvents = new EventEmitter()

let sockInstance = null
let pairingRequested = false

export async function connectToWhatsApp() {
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
      if (!WHATSAPP_PHONE) {
        console.log('\nFalta WHATSAPP_PHONE en .env — no se puede generar pairing code.')
        return
      }
      try {
        await new Promise(r => setTimeout(r, 2000)) // small delay required by Baileys
        const code = await sock.requestPairingCode(WHATSAPP_PHONE)
        const formatted = code.match(/.{1,4}/g)?.join('-') || code
        console.log(`\n╔══════════════════════════════╗`)
        console.log(`║  CÓDIGO DE VINCULACIÓN       ║`)
        console.log(`║                              ║`)
        console.log(`║       ${formatted.padEnd(22)}║`)
        console.log(`╚══════════════════════════════╝`)
        console.log(`\nEn WhatsApp → Dispositivos vinculados → Vincular dispositivo`)
        console.log(`→ "Vincular con número de teléfono" → ingresa: ${formatted}\n`)
        waEvents.emit('pairing-code', formatted)
      } catch (err) {
        console.error('Error generando pairing code:', err.message)
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      waEvents.emit('status', false)

      if (shouldReconnect) {
        console.log('WhatsApp desconectado — reconectando...')
        connectToWhatsApp()
      } else {
        console.log('Sesión cerrada. Elimina auth_info_baileys/ y reinicia para vincular de nuevo.')
      }
    } else if (connection === 'open') {
      pairingRequested = false
      console.log('WhatsApp conectado.')
      waEvents.emit('status', true)
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
        await handleInvoice(sock, m, from, msgType, (expense) => waEvents.emit('expense', expense))
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

export function getSock() {
  if (!sockInstance) throw new Error('WhatsApp no está conectado todavía')
  return sockInstance
}
