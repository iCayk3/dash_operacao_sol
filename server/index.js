import dotenv from 'dotenv'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  fetchAttendances,
  fetchClients,
  fetchOpenDocuments,
  fetchPaidDocuments,
  summarizeClients,
} from './routerbox.js'

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

function getPreviousMonthPeriod(referenceDate) {
  const [year, month] = referenceDate.split('-').map(Number)
  const firstDay = new Date(year, month - 2, 1)
  const lastDay = new Date(year, month - 1, 0)
  return {
    from: localIsoDate(firstDay),
    to: localIsoDate(lastDay),
  }
}

function getBillingDuePeriod(from, to) {
  const [year, month] = from.split('-').map(Number)
  const nominalDay30 = new Date(year, month - 1, 30)
  const nominalMonth = month - 1
  let adjustedTo = to

  if (nominalDay30.getMonth() === nominalMonth && [0, 6].includes(nominalDay30.getDay())) {
    const nextBusinessDay = new Date(nominalDay30)
    do {
      nextBusinessDay.setDate(nextBusinessDay.getDate() + 1)
    } while ([0, 6].includes(nextBusinessDay.getDay()))

    const shiftedDate = localIsoDate(nextBusinessDay)
    if (shiftedDate > adjustedTo) adjustedTo = shiftedDate
  }

  return {
    from,
    nominalTo: to,
    adjustedTo,
    wasAdjusted: adjustedTo !== to,
  }
}

function getGroup(client) {
  const id = String(client?.Grupo || '').trim()
  if (!id) return { id: null, name: 'GRUPO NÃO INFORMADO' }
  return { id, name: groupNames[id] || `GRUPO ${id}` }
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function consolidateFinancialDocuments(documents) {
  const consolidatedDocuments = documents.filter(
    (document) => String(document.Historico || '').trim() === 'Documento a receber',
  )

  return {
    documents: consolidatedDocuments,
    exactDuplicatesRemoved: 0,
    movementsConsolidated: documents.length - consolidatedDocuments.length,
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
  let original = 0
  let interest = 0
  let fine = 0
  let discount = 0
  let received = 0
  let zeroValue = 0

  for (const document of uniqueDocuments) {
    const originalValue = Number.parseFloat(document.ValorOriginal) || 0
    const interestValue = Number.parseFloat(document.ValorJuros) || 0
    const fineValue = Number.parseFloat(document.ValorMulta) || 0
    const discountValue = Number.parseFloat(document.ValorDesconto) || 0
    const receivedValue = Number.parseFloat(document.ValorBaixado) || 0
    const group = clientGroups.get(String(document.CodigoPessoa)) || { id: null, name: 'GRUPO NÃO IDENTIFICADO' }
    const groupKey = group.id || group.name
    const date = document.DataBaixa || 'Sem data'
    const documentKey = `${document.CodigoPessoa}:${document.Documento || document.Sequencia}`

    if (!groups.has(groupKey)) groups.set(groupKey, {
      groupId: group.id,
      groupName: group.name,
      original: 0,
      fees: 0,
      discounts: 0,
      received: 0,
      records: 0,
      paidDocuments: new Set(),
    })
    const groupData = groups.get(groupKey)
    groupData.records += 1
    groupData.original = roundMoney(groupData.original + originalValue)
    groupData.fees = roundMoney(groupData.fees + interestValue + fineValue)
    groupData.discounts = roundMoney(groupData.discounts + discountValue)
    groupData.received = roundMoney(groupData.received + receivedValue)

    original = roundMoney(original + originalValue)
    interest = roundMoney(interest + interestValue)
    fine = roundMoney(fine + fineValue)
    discount = roundMoney(discount + discountValue)
    received = roundMoney(received + receivedValue)

    if (originalValue > 0) {
      groupData.paidDocuments.add(documentKey)
      uniquePositiveDocuments.add(documentKey)
    }
    if (receivedValue === 0) {
      zeroValue += 1
    }

    if (!daily.has(date)) daily.set(date, { date, value: 0, quantity: 0 })
    const day = daily.get(date)
    day.value = roundMoney(day.value + originalValue)
    day.quantity += 1
  }

  const groupRows = [...groups.values()]
    .map(({ paidDocuments, ...group }) => ({
      ...group,
      paidDocuments: paidDocuments.size,
      original: roundMoney(group.original),
      fees: roundMoney(group.fees),
      discounts: roundMoney(group.discounts),
      received: roundMoney(group.received),
      share: original ? (group.original / original) * 100 : 0,
    }))
    .sort((a, b) => b.original - a.original)

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
      value: Number.parseFloat(document.ValorOriginal) || 0,
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
      original,
      interest,
      fine,
      fees: roundMoney(interest + fine),
      discount,
      received,
      positive: original,
      negative: roundMoney(-discount),
      net: original,
      zeroValue,
    },
    groups: groupRows,
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    recent,
    updatedAt: new Date().toISOString(),
  }
}

function summarizeBilling(openDocuments, paidDocuments, clients, duePeriod, launchPeriod) {
  const { from, nominalTo, adjustedTo } = duePeriod
  const clientGroups = new Map(clients.map((client) => [
    String(client.Codigo),
    getGroup(client),
  ]))
  const openByDocument = new Map()
  const paidByDocument = new Map()

  for (const document of openDocuments) {
    const key = `${document.CliFor}:${document.Documento || document.NossoNumero || document.Sequencia}`
    if (!openByDocument.has(key)) openByDocument.set(key, document)
  }

  const paidInDuePeriod = paidDocuments.filter((document) => (
    String(document.Historico || '').trim() === 'Documento a receber'
    && String(document.Origem || '').trim() === 'FAT'
    && String(document.DataVencimento || '') >= from
    && String(document.DataVencimento || '') <= adjustedTo
    && String(document.DataLancamento || '') >= launchPeriod.from
    && String(document.DataLancamento || '') <= launchPeriod.to
  ))

  for (const document of paidInDuePeriod) {
    const key = `${document.CodigoPessoa}:${document.Documento || document.NossoNumero || document.Sequencia}`
    if (!paidByDocument.has(key)) paidByDocument.set(key, document)
  }

  for (const key of paidByDocument.keys()) openByDocument.delete(key)

  const groups = new Map()
  let open = 0
  let received = 0

  function ensureGroup(clientCode) {
    const group = clientGroups.get(String(clientCode)) || { id: null, name: 'GRUPO NÃO IDENTIFICADO' }
    const key = group.id || group.name
    if (!groups.has(key)) groups.set(key, {
      groupId: group.id,
      groupName: group.name,
      billed: 0,
      received: 0,
      open: 0,
      documents: 0,
    })
    return groups.get(key)
  }

  for (const document of openByDocument.values()) {
    const value = Number.parseFloat(document.Valor) || 0
    open = roundMoney(open + value)
    const group = ensureGroup(document.CliFor)
    group.open = roundMoney(group.open + value)
    group.billed = roundMoney(group.billed + value)
    group.documents += 1
  }

  for (const document of paidByDocument.values()) {
    const value = Number.parseFloat(document.ValorOriginal) || 0
    received = roundMoney(received + value)
    const group = ensureGroup(document.CodigoPessoa)
    group.received = roundMoney(group.received + value)
    group.billed = roundMoney(group.billed + value)
    group.documents += 1
  }

  const billed = roundMoney(received + open)
  return {
    period: {
      from,
      to: nominalTo,
      adjustedTo,
      dueDateAdjusted: duePeriod.wasAdjusted,
      launchFrom: launchPeriod.from,
      launchTo: launchPeriod.to,
    },
    totals: {
      billed,
      received,
      open,
      collectionRate: billed ? (received / billed) * 100 : 0,
      documents: openByDocument.size + paidByDocument.size,
      openDocuments: openByDocument.size,
      receivedDocuments: paidByDocument.size,
    },
    groups: [...groups.values()]
      .map((group) => ({
        ...group,
        collectionRate: group.billed ? (group.received / group.billed) * 100 : 0,
      }))
      .sort((a, b) => b.billed - a.billed),
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

    const launchPeriod = getPreviousMonthPeriod(from)
    const duePeriod = getBillingDuePeriod(from, to)
    const documentsPromise = fetchPaidDocuments(from, to)
    const billingPaidTo = localIsoDate()
    const billingDocumentsPromise = fetchPaidDocuments(launchPeriod.from, billingPaidTo)
    const [documents, billingPaidDocuments, openDocuments, clients] = await Promise.all([
      documentsPromise,
      billingDocumentsPromise,
      fetchOpenDocuments(from, duePeriod.adjustedTo, launchPeriod.from, launchPeriod.to),
      getClients(forceRefresh),
    ])
    const data = {
      ...summarizeFinancial(documents, clients, from, to),
      billing: summarizeBilling(openDocuments, billingPaidDocuments, clients, duePeriod, launchPeriod),
    }
    data.billing.period.paidFrom = launchPeriod.from
    data.billing.period.paidTo = billingPaidTo
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
