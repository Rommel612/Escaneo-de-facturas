import qrcode from 'qrcode'
import xlsx from 'xlsx'
import { getExpenses, getStats, deleteExpense, updateExpense } from '../services/storage.js'
import { WHATSAPP_PHONE } from '../config.js'

export function registerRoutes(app, io) {
  app.get('/api/expenses', (_req, res) => {
    res.json(getExpenses())
  })

  app.get('/api/stats', (_req, res) => {
    res.json(getStats())
  })

  app.get('/api/export', (_req, res) => {
    const expenses = getExpenses()

    const rows = expenses.map(e => ({
      'Proveedor':      e.proveedor      || '',
      'No. Factura':    e.numero_factura  || '',
      'Fecha':          e.fecha          || '',
      'Total':          Number(e.total)  || 0,
      'Subtotal':       Number(e.subtotal) || 0,
      'IVA':            Number(e.iva)    || 0,
      'Moneda':         e.moneda         || 'USD',
      'Categoría':      e.categoria      || '',
      'Descripción':    e.descripcion    || '',
      'Imagen':         e.imageFile ? `uploads/${e.imageFile}` : '',
      'Registrado':     e.createdAt      || '',
    }))

    const wb = xlsx.utils.book_new()
    const ws = xlsx.utils.json_to_sheet(rows)

    ws['!cols'] = [
      { wch: 28 }, { wch: 18 }, { wch: 12 }, { wch: 12 },
      { wch: 12 }, { wch: 10 }, { wch: 8  }, { wch: 16 },
      { wch: 40 }, { wch: 30 }, { wch: 22 },
    ]

    xlsx.utils.book_append_sheet(wb, ws, 'Facturas')

    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const filename = `facturas_${new Date().toISOString().slice(0, 10)}.xlsx`

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.send(buf)
  })

  app.patch('/api/expenses/:id', (req, res) => {
    const { descripcion } = req.body
    if (typeof descripcion !== 'string') return res.status(400).json({ error: 'Invalid field' })
    const updated = updateExpense(req.params.id, { descripcion: descripcion.trim() })
    if (!updated) return res.status(404).json({ error: 'Not found' })
    io.emit('update-expense', { id: req.params.id, descripcion: updated.descripcion })
    res.json({ ok: true })
  })

  app.delete('/api/expenses/:id', (req, res) => {
    const deleted = deleteExpense(req.params.id)
    if (!deleted) return res.status(404).json({ error: 'Not found' })
    io.emit('delete-expense', { id: req.params.id, stats: getStats() })
    res.json({ ok: true })
  })

  app.get('/api/whatsapp-qr', async (_req, res) => {
    if (!WHATSAPP_PHONE) return res.json({ qr: null, url: null })
    const url = `https://wa.me/${WHATSAPP_PHONE}`
    const qr = await qrcode.toDataURL(url, { width: 256, margin: 2 })
    res.json({ qr, url, phone: WHATSAPP_PHONE })
  })
}
