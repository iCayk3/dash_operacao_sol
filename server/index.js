import dotenv from 'dotenv'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchAttendances, fetchClients, fetchPaidDocuments, summarizeClients } from './routerbox.js'

dotenv.config({ path: '.env.local', quiet: true })

const app = express()
const port = Number(process.env.PORT) || 3001
const host = process.env.HOST || '127.0.0.1'
const cacheTtl = Number(process.env.ROUTERBOX_CACHE_TTL_MS) || 300_000
const dirname = path.dirname(fileURLToPath(import.meta.url))
const distPath = path.resolve(dirname, '../dist')

let clientsCache = null
let clientsRequest = null
const financialCache = new Map()
const attendanceCache = new Map()
const groupNames = {
  9: 'PADRÃO',
  10: 'SÃO JOÃO DE PIRABAS',
  11: 'PRIMAVERA',
  13: 'SANTARÉM NOVO',
  15: 'QUATIPURU',
  16: 'BOA VISTA',
  17: 'SEM COBRANÇA',
  26: 'MAGALHÃES BARATA',
  32: 'MARACANÃ',
  33: 'MARAPANIM',
  34: 'SALINÓPOLIS',
  36: 'RÁDIO - PIRABAS',
  40: 'TESTE',
  41: 'PREFEITURA',
  42: 'CONSELHO ESCOLAR',
  43: 'SOL PROVEDOR',
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00`))
}

function localIsoDate(date = new Date()) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return offsetDate.toISOString().slice(0, 10)
}

function getGroup(client) {
  const id = String(client?.Grupo || '').trim()
  if (!id) return { id: null, name: 'GRUPO NÃO INFORMADO' }
  return { id, name: groupNames[id] || `GRUPO ${id}` }
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function getFinancialDocumentSignature(document) {
  return [
    document.CodigoPessoa,
    document.Documento,
    document.NossoNumero,
    document.DataBaixa,
    document.DataHoraExecucaoBaixa,
    document.ValorOriginal,
    document.ValorJuros,
    document.ValorMulta,
    document.ValorDesconto,
    document.ValorBaixado,
    document.Motivo,
    document.Historico,
    document.HistoricoBaixa,
    document.UsuarioBaixa,
  ].map((value) => String(value ?? '').trim()).join('|')
}

function deduplicateFinancialDocuments(documents) {
  const signatures = new Set()
  const uniqueDocuments = []

  for (const document of documents) {
    const signature = getFinancialDocumentSignature(document)
    if (signatures.has(signature)) continue
    signatures.add(signature)
    uniqueDocuments.push(document)
  }

  return {
    documents: uniqueDocuments,
    duplicatesRemoved: documents.length - uniqueDocuments.length,
  }
}

function consolidateFinancialDocuments(documents) {
  const deduplicated = deduplicateFinancialDocuments(documents)
  const documentsByBill = new Map()

  for (const document of deduplicated.documents) {
    const billNumber = document.Documento || document.NossoNumero || document.Sequencia
    const key = [
      document.CodigoPessoa,
      billNumber,
      document.DataBaixa,
    ].map((value) => String(value ?? '').trim()).join('|')

    if (!documentsByBill.has(key)) documentsByBill.set(key, new Map())

    const movements = documentsByBill.get(key)
    const value = roundMoney(Number.parseFloat(document.ValorBaixado) || 0)
    const valueKey = value.toFixed(2)

    if (!movements.has(valueKey)) {
      movements.set(valueKey, {
        ...document,
        ValorBaixado: value,
        MovimentosConsolidados: 1,
      })
      continue
    }

    const existing = movements.get(valueKey)
    existing.MovimentosConsolidados += 1

    const existingHistory = String(existing.Historico || '').trim()
    const currentHistory = String(document.Historico || '').trim()
    if (!existingHistory && currentHistory) existing.Historico = document.Historico

    if (String(document.DataHoraExecucaoBaixa) > String(existing.DataHoraExecucaoBaixa)) {
      existing.DataHoraExecucaoBaixa = document.DataHoraExecucaoBaixa
      existing.UsuarioBaixa = document.UsuarioBaixa
    }
  }

  const consolidatedDocuments = [...documentsByBill.values()].flatMap((movements) => [...movements.values()])
  return {
    documents: consolidatedDocuments,
    exactDuplicatesRemoved: deduplicated.duplicatesRemoved,
    movementsConsolidated: deduplicated.documents.length - consolidatedDocuments.length,
  }
}

async function getClients(forceRefresh = false) {
  const cacheIsValid = clientsCache && Date.now() - clientsCache.cachedAt < cacheTtl
  if (!forceRefresh && cacheIsValid) return clientsCache.clients
  if (clientsRequest) return clientsRequest

  clientsRequest = fetchClients()
    .then((clients) => {
      clientsCache = { clients, cachedAt: Date.now() }
      return clients
    })
    .finally(() => {
      clientsRequest = null
    })

  return clientsRequest
}

function summarizeFinancial(documents, clients, from, to) {
  const consolidation = consolidateFinancialDocuments(documents)
  const uniqueDocuments = consolidation.documents
  const clientGroups = new Map(clients.map((client) => [
    String(client.Codigo),
    getGroup(client),
  ]))
  const groups = new Map()
  const daily = new Map()
  const uniquePositiveDocuments = new Set()
  let positive = 0
  let negative = 0
  let zeroValue = 0

  for (const document of uniqueDocuments) {
    const value = Number.parseFloat(document.ValorBaixado) || 0
    const group = clientGroups.get(String(document.CodigoPessoa)) || { id: null, name: 'GRUPO NÃO IDENTIFICADO' }
    const groupKey = group.id || group.name
    const date = document.DataBaixa || 'Sem data'
    const documentKey = `${document.CodigoPessoa}:${document.Documento || document.Sequencia}`

    if (!groups.has(groupKey)) groups.set(groupKey, { groupId: group.id, groupName: group.name, entries: 0, adjustments: 0, net: 0, records: 0, paidDocuments: new Set() })
    const groupData = groups.get(groupKey)
    groupData.records += 1
    groupData.net += value

    if (value > 0) {
      positive = roundMoney(positive + value)
      groupData.entries = roundMoney(groupData.entries + value)
      groupData.paidDocuments.add(documentKey)
      uniquePositiveDocuments.add(documentKey)
    } else if (value < 0) {
      negative = roundMoney(negative + value)
      groupData.adjustments = roundMoney(groupData.adjustments + value)
    } else {
      zeroValue += 1
    }

    if (!daily.has(date)) daily.set(date, { date, value: 0, quantity: 0 })
    const day = daily.get(date)
    day.value = roundMoney(day.value + value)
    day.quantity += 1
  }

  const net = roundMoney(positive + negative)
  const groupRows = [...groups.values()]
    .map(({ paidDocuments, ...group }) => ({
      ...group,
      paidDocuments: paidDocuments.size,
      entries: roundMoney(group.entries),
      adjustments: roundMoney(group.adjustments),
      net: roundMoney(group.net),
      share: net ? (group.net / net) * 100 : 0,
    }))
    .sort((a, b) => b.net - a.net)

  const recent = [...uniqueDocuments]
    .sort((a, b) => String(b.DataHoraExecucaoBaixa || b.DataBaixa).localeCompare(String(a.DataHoraExecucaoBaixa || a.DataBaixa)))
    .slice(0, 12)
    .map((document) => ({
      sequence: document.Sequencia,
      personName: document.NomePessoa,
      groupId: clientGroups.get(String(document.CodigoPessoa))?.id || null,
      groupName: clientGroups.get(String(document.CodigoPessoa))?.name || 'GRUPO NÃO IDENTIFICADO',
      date: document.DataHoraExecucaoBaixa || document.DataBaixa,
      document: document.Documento,
      reason: document.Motivo || 'Não informado',
      user: document.UsuarioBaixa || 'Não informado',
      value: Number.parseFloat(document.ValorBaixado) || 0,
    }))

  return {
    period: { from, to },
    totals: {
      records: uniqueDocuments.length,
      rawRecords: documents.length,
      exactDuplicatesRemoved: consolidation.exactDuplicatesRemoved,
      movementsConsolidated: consolidation.movementsConsolidated,
      duplicatesRemoved: documents.length - uniqueDocuments.length,
      paidDocuments: uniquePositiveDocuments.size,
      positive,
      negative,
      net,
      zeroValue,
    },
    groups: groupRows,
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    recent,
    updatedAt: new Date().toISOString(),
  }
}

const attendanceStatusNames = {
  F: 'Na fila',
  A: 'A caminho',
  E: 'Em execução',
  P: 'Pausado',
  C: 'Concluído',
  B: 'Abortado',
}

const attendanceTypeNames = {
  A: 'Administrativo / Financeiro',
  C: 'Comercial',
  T: 'Técnico',
}

function normalizeAttendanceStatus(attendance) {
  const code = String(attendance.Situacao_OS || '').trim().toUpperCase()
  if (attendanceStatusNames[code]) return code
  if (String(attendance.Encerramento_DataHora || '').trim()) return 'C'
  return 'O'
}

function summarizeAttendances(attendances, from, to) {
  const today = localIsoDate()
  const statuses = { F: 0, A: 0, E: 0, P: 0, C: 0, B: 0, O: 0 }
  const types = { A: 0, C: 0, T: 0, O: 0 }
  const daily = new Map()
  const topics = new Map()
  let createdToday = 0
  let closedToday = 0

  for (const attendance of attendances) {
    const status = normalizeAttendanceStatus(attendance)
    const type = String(attendance.Tipo || '').trim().toUpperCase()
    const openingDate = String(attendance.Abertura_DataHora || '').slice(0, 10)
    const closingDate = String(attendance.Encerramento_DataHora || '').slice(0, 10)
    const topic = String(attendance.Topico || '').trim() || 'Sem tópico'

    statuses[status] += 1
    types[attendanceTypeNames[type] ? type : 'O'] += 1
    topics.set(topic, (topics.get(topic) || 0) + 1)

    if (openingDate === today) createdToday += 1
    if (closingDate === today) closedToday += 1

    if (openingDate) {
      if (!daily.has(openingDate)) daily.set(openingDate, { date: openingDate, opened: 0, closed: 0 })
      daily.get(openingDate).opened += 1
    }
    if (closingDate) {
      if (!daily.has(closingDate)) daily.set(closingDate, { date: closingDate, opened: 0, closed: 0 })
      daily.get(closingDate).closed += 1
    }
  }

  const open = statuses.F + statuses.A + statuses.E + statuses.P + statuses.O
  const recent = [...attendances]
    .sort((a, b) => String(b.Abertura_DataHora).localeCompare(String(a.Abertura_DataHora)))
    .slice(0, 12)
    .map((attendance) => {
      const status = normalizeAttendanceStatus(attendance)
      const type = String(attendance.Tipo || '').trim().toUpperCase()
      return {
        number: attendance.Numero,
        protocol: attendance.Protocolo,
        openedAt: attendance.Abertura_DataHora,
        closedAt: attendance.Encerramento_DataHora || null,
        openingUser: attendance.Abertura_Usuario || 'Não informado',
        assignedTo: attendance.Designacao_Usuario || attendance.Designacao_Grupo_Nome || 'Não designado',
        status,
        statusName: attendanceStatusNames[status] || 'Situação não informada',
        type,
        typeName: attendanceTypeNames[type] || 'Outro',
        topic: attendance.Topico || 'Sem tópico',
        clientCode: attendance.CodigoCliente || null,
      }
    })

  return {
    period: { from, to },
    totals: {
      records: attendances.length,
      open,
      completed: statuses.C,
      aborted: statuses.B,
      createdToday,
      closedToday,
    },
    statuses: Object.entries(statuses).map(([code, value]) => ({
      code,
      label: attendanceStatusNames[code] || 'Não informado',
      value,
    })),
    types: Object.entries(types).map(([code, value]) => ({
      code,
      label: attendanceTypeNames[code] || 'Outro',
      value,
    })),
    topTopics: [...topics.entries()]
      .map(([topic, value]) => ({ topic, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6),
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    recent,
    updatedAt: new Date().toISOString(),
  }
}

app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', service: 'dash-clientes-sol-api' })
})

app.get('/api/clientes/resumo', async (request, response) => {
  try {
    const forceRefresh = request.query.refresh === '1'
    const wasCached = !forceRefresh && clientsCache && Date.now() - clientsCache.cachedAt < cacheTtl
    const clients = await getClients(forceRefresh)
    const data = { ...summarizeClients(clients), updatedAt: new Date().toISOString() }
    return response.json({ ...data, cached: Boolean(wasCached) })
  } catch (error) {
    console.error('[RouterBox] Falha ao consultar clientes:', error.message)
    return response.status(502).json({
      status: 'error',
      message: 'Não foi possível consultar os clientes no RouterBox.',
      detail: error.message,
    })
  }
})

app.get('/api/financeiro/resumo', async (request, response) => {
  const today = localIsoDate()
  const from = String(request.query.from || `${today.slice(0, 8)}01`)
  const to = String(request.query.to || today)
  const forceRefresh = request.query.refresh === '1'

  if (!isValidDate(from) || !isValidDate(to) || from > to) {
    return response.status(400).json({ status: 'error', message: 'Período financeiro inválido.' })
  }

  try {
    const cacheKey = `${from}:${to}`
    const cached = financialCache.get(cacheKey)
    const cacheIsValid = cached && Date.now() - cached.cachedAt < cacheTtl
    if (!forceRefresh && cacheIsValid) return response.json({ ...cached.data, cached: true })

    const [documents, clients] = await Promise.all([
      fetchPaidDocuments(from, to),
      getClients(forceRefresh),
    ])
    const data = summarizeFinancial(documents, clients, from, to)
    financialCache.set(cacheKey, { data, cachedAt: Date.now() })
    return response.json({ ...data, cached: false })
  } catch (error) {
    console.error('[RouterBox] Falha ao consultar financeiro:', error.message)
    return response.status(502).json({
      status: 'error',
      message: 'Não foi possível consultar os documentos baixados.',
      detail: error.message,
    })
  }
})

app.get('/api/atendimentos/resumo', async (request, response) => {
  const today = localIsoDate()
  const from = String(request.query.from || `${today.slice(0, 8)}01`)
  const to = String(request.query.to || today)
  const forceRefresh = request.query.refresh === '1'

  if (!isValidDate(from) || !isValidDate(to) || from > to) {
    return response.status(400).json({ status: 'error', message: 'Período de atendimento inválido.' })
  }

  try {
    const cacheKey = `${from}:${to}`
    const cached = attendanceCache.get(cacheKey)
    const cacheIsValid = cached && Date.now() - cached.cachedAt < cacheTtl
    if (!forceRefresh && cacheIsValid) return response.json({ ...cached.data, cached: true })

    const attendances = await fetchAttendances(from, to)
    const data = summarizeAttendances(attendances, from, to)
    attendanceCache.set(cacheKey, { data, cachedAt: Date.now() })
    return response.json({ ...data, cached: false })
  } catch (error) {
    console.error('[RouterBox] Falha ao consultar atendimentos:', error.message)
    return response.status(502).json({
      status: 'error',
      message: 'Não foi possível consultar os atendimentos.',
      detail: error.message,
    })
  }
})

app.use(express.static(distPath))
app.get('*splat', (_request, response) => response.sendFile(path.join(distPath, 'index.html')))

app.listen(port, host, () => {
  console.log(`SOL Provedor disponível em http://${host}:${port}`)
})
