import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EMPLOYEES_PATH = join(__dirname, '..', 'employees.json')
const ATTENDANCE_PATH = join(__dirname, '..', 'attendance.json')

function read(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return [] }
}

function write(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2))
}

export function getEmployees() { return read(EMPLOYEES_PATH) }

export function addEmployee(emp) {
  const employees = getEmployees()
  const newEmp = { id: Date.now().toString(), ...emp, createdAt: new Date().toISOString() }
  employees.push(newEmp)
  write(EMPLOYEES_PATH, employees)
  return newEmp
}

export function deleteEmployee(id) {
  const employees = getEmployees().filter(e => e.id !== id)
  write(EMPLOYEES_PATH, employees)
}

export function getAttendance() { return read(ATTENDANCE_PATH) }

export function addAttendance(record) {
  const attendance = getAttendance()
  const newRecord = { id: Date.now().toString(), ...record, createdAt: new Date().toISOString() }
  attendance.push(newRecord)
  write(ATTENDANCE_PATH, attendance)
  return newRecord
}

export function updateAttendance(id, updates) {
  const attendance = getAttendance()
  const idx = attendance.findIndex(r => r.id === id)
  if (idx === -1) throw new Error('Registro no encontrado')
  attendance[idx] = { ...attendance[idx], ...updates }
  write(ATTENDANCE_PATH, attendance[idx])
  return attendance[idx]
}

export function deleteAttendance(id) {
  const attendance = getAttendance().filter(r => r.id !== id)
  write(ATTENDANCE_PATH, attendance)
}
