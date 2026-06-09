import qrcode from 'qrcode'
import xlsx from 'xlsx'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getExpenses, getStats, deleteExpense, updateExpense, clearCategoryFromExpenses } from '../services/storage.js'
import { WHATSAPP_PHONE } from '../config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CATEGORIES_PATH = join(__dirname, '..', '..', 'categories.json')
const DEFAULT_CATEGORIES = ['IESS', 'Sueldos', 'Adelantos', 'Otro']

function loadCategories() {
  if (!existsSync(CATEGORIES_PATH)) {
    writeFileSync(CATEGORIES_PATH, JSON.stringify(DEFAULT_CATEGORIES, null, 2))
    return [...DEFAULT_CATEGORIES]
  }
  return JSON.parse(readFileSync(CATEGORIES_PATH, 'utf8'))
}

function saveCategories(cats) {
  writeFileSync(CATEGORIES_PATH, JSON.stringify(cats, null, 2))
}

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

  app.patch('/api/expenses/:id', async (req, res) => {
    const { proveedor, descripcion, categoria, banco } = req.body
    const updated = await updateExpense(req.params.id, { proveedor, descripcion, categoria, banco })
    if (!updated) return res.status(404).json({ error: 'Not found' })
    io.emit('expense-updated', { expense: updated, stats: getStats() })
    res.json(updated)
  })

  app.delete('/api/expenses/:id', (req, res) => {
    const deleted = deleteExpense(req.params.id)
    if (!deleted) return res.status(404).json({ error: 'Not found' })
    io.emit('delete-expense', { id: req.params.id, stats: getStats() })
    res.json({ ok: true })
  })

  app.get('/api/categories', (_req, res) => {
    res.json(loadCategories())
  })

  app.post('/api/categories', (req, res) => {
    const raw = req.body?.name
    if (!raw || typeof raw !== 'string') return res.status(400).json({ error: 'name requerido' })
    const name = raw.trim().replace(/^./, c => c.toUpperCase())
    const cats = loadCategories()
    if (cats.some(c => c.toLowerCase() === name.toLowerCase())) {
      return res.status(400).json({ error: 'Ya existe' })
    }
    cats.push(name)
    saveCategories(cats)
    res.json(cats)
  })

  app.delete('/api/categories/:nombre', (req, res) => {
    const nombre = decodeURIComponent(req.params.nombre).trim()
    const cats = loadCategories()
    const idx = cats.findIndex(c => c.toLowerCase() === nombre.toLowerCase())
    if (idx === -1) return res.status(404).json({ error: 'Categoría no encontrada' })
    cats.splice(idx, 1)
    saveCategories(cats)
    const affected = clearCategoryFromExpenses(nombre)
    io.emit('category-deleted', { nombre, affected })
    res.json({ ok: true, affected })
  })

  app.get('/api/whatsapp-qr', async (_req, res) => {
    if (!WHATSAPP_PHONE) return res.json({ qr: null, url: null })
    const url = `https://wa.me/${WHATSAPP_PHONE}`
    const qr = await qrcode.toDataURL(url, { width: 256, margin: 2 })
    res.json({ qr, url, phone: WHATSAPP_PHONE })
  })
}
