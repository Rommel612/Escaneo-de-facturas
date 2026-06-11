import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState
} from '@whiskeysockets/baileys'
import pino from 'pino'
import { EventEmitter } from 'events'
import { WHATSAPP_PHONE } from '../config.js'
import { handleInvoice, buildHelpMsg, buildSummaryMsg } from '../handlers/message.js'
import { extractAttendanceData } from '../gemini-turno.js'
import { addAttendance } from '../db-attendance.js'

export const waEvents = new EventEmitter()

let sockInstance = null
let pairingRequested = false

// El bot SOLO atiende chats individuales. Cualquier grupo, comunidad, lista de
// difusión, status o canal queda completamente ignorado. Los JIDs de grupo de
// WhatsApp siempre terminan en @g.us (incluidas las comunidades); difusión y
// status en @broadcast; los canales en @newsletter.
export function isGroupOrNonIndividual(jid) {
  if (!jid || typeof jid !== 'string') return true
  return (
    jid.endsWith('@g.us') ||        // grupos y comunidades
    jid.endsWith('@broadcast') ||   // status y listas de difusión
    jid.endsWith('@newsletter')     // canales
  )
}

export async function connectToWhatsApp(onExpense, onStatus, onPairing, onAttendance) {
  pairingRequested = false
  let onAttendanceCb = onAttendance

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
    if (!process.env.BOT_ENABLED || process.env.BOT_ENABLED === 'false') return  // deshabilitado temporalmente

    for (const m of messages) {
      const from = m.key.remoteJid
      const msgType = Object.keys(m.message || {})[0]
      console.log(`[MSG] from=${from} fromMe=${m.key.fromMe} participant=${m.key.participant ?? '-'} type=${msgType}`)

      // Ignorar por completo grupos/comunidades/difusión/status/canales.
      // Los JIDs de grupo siempre terminan en @g.us, así que el filtro de
      // sufijo los cubre al 100%. En chats individuales se procesan tanto tus
      // propios mensajes (fromMe) como los de la otra persona.
      if (isGroupOrNonIndividual(from)) {
        console.log(`[SKIP] no-individual: ${from}`)
        continue
      }

      const text = (m.message?.conversation || m.message?.extendedTextMessage?.text || '').trim()
      console.log(`[TEXT] "${text}" (hex: ${Buffer.from(text).toString('hex')})`)

      if (text === '!fac') {
        const contextInfo = m.message?.extendedTextMessage?.contextInfo
        const quotedMessage = contextInfo?.quotedMessage
        console.log('[FAC] contextInfo keys:', Object.keys(contextInfo || {}))
        console.log('[FAC] quotedMessage keys:', Object.keys(quotedMessage || {}))

        if (!quotedMessage) {
          await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000))
          await sock.sendMessage(from, { text: 'Responde a una foto o PDF con *!fac* para registrarlo como factura.' })
          continue
        }

        let quotedType = Object.keys(quotedMessage)[0]
        console.log('[FAC] quotedType:', quotedType)

        // documentWithCaptionMessage es un wrapper — extraer el documentMessage interno
        let resolvedMessage = quotedMessage
        if (quotedType === 'documentWithCaptionMessage') {
          const inner = quotedMessage.documentWithCaptionMessage?.message
          if (inner) {
            resolvedMessage = inner
            quotedType = Object.keys(inner)[0]
            console.log('[FAC] unwrapped documentWithCaptionMessage → quotedType:', quotedType)
          }
        }

        if (quotedType !== 'imageMessage' && quotedType !== 'documentMessage') {
          await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000))
          await sock.sendMessage(from, { text: 'El mensaje citado no es una imagen ni un PDF.' })
          continue
        }

        const quotedMsg = {
          key: {
            remoteJid: from,
            id: contextInfo.stanzaId,
            participant: contextInfo.participant
          },
          message: resolvedMessage
        }
        console.log('[FAC] calling handleInvoice, stanzaId:', contextInfo.stanzaId)
        await handleInvoice(sock, quotedMsg, from, quotedType, (expense) => waEvents.emit('expense', expense))
      } else if (text.startsWith('!turno')) {
        const content = text.replace('!turno', '').trim()
        if (!content) {
          await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000))
          await sock.sendMessage(from, { text: 'Envía *!turno* seguido del mensaje de registro.\nEjemplo: _!turno Entrando a guardia, relevo a Carlos_' })
          return
        }
        try {
          const data = await extractAttendanceData(content)
          const now = new Date()
          const record = addAttendance({
            empleadoId: null,
            empleado: data.empleado || 'Sin identificar',
            tipo: data.tipo || 'entrada',
            fecha: data.fecha || now.toISOString().split('T')[0],
            hora: data.hora || now.toTimeString().slice(0, 5),
            observacion: data.observacion || null,
            fuente: 'whatsapp',
            telefono: from.replace('@s.whatsapp.net', '')
          })
          await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000))
          const emoji = record.tipo === 'entrada' ? '✅' : '👋'
          await sock.sendMessage(from, {
            text: `${emoji} *Turno registrado*\n\nEmpleado: ${record.empleado}\nTipo: ${record.tipo.charAt(0).toUpperCase() + record.tipo.slice(1)}\nFecha: ${record.fecha}\nHora: ${record.hora}${record.observacion ? '\nNota: ' + record.observacion : ''}\n\nYa aparece en el panel.`
          })
          if (onAttendanceCb) onAttendanceCb(record)
        } catch (err) {
          console.error('Error procesando turno:', err.message)
          await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000))
          await sock.sendMessage(from, { text: '❌ No pude registrar el turno. Intenta de nuevo con más detalle.' })
        }
      } else if (text.toLowerCase() === '!help') {
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000))
        await sock.sendMessage(from, { text: buildHelpMsg() })
      } else if (text.toLowerCase() === '!res') {
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000))
        await sock.sendMessage(from, { text: buildSummaryMsg() })
      }
    }
  })

  return sock
}

export function getSock() {
  if (!sockInstance) throw new Error('WhatsApp no está conectado todavía')
  return sockInstance
}
