const DEFAULT_TIMEOUT_MS = 45_000

function parseCodes(value, fallback) {
  return (value || fallback)
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean)
}

function getStatusKey(code) {
  const statusCodes = {
    active: parseCodes(process.env.ROUTERBOX_STATUS_ACTIVE, 'A'),
    inactive: parseCodes(process.env.ROUTERBOX_STATUS_INACTIVE, 'I,N'),
    canceled: parseCodes(process.env.ROUTERBOX_STATUS_CANCELED, 'C'),
    suspended: parseCodes(process.env.ROUTERBOX_STATUS_SUSPENDED, 'S'),
    blocked: parseCodes(process.env.ROUTERBOX_STATUS_BLOCKED, 'B'),
    awaitingInstallation: parseCodes(process.env.ROUTERBOX_STATUS_AWAITING_INSTALLATION, 'E'),
  }
  const normalizedCode = String(code || '').trim().toUpperCase()
  return Object.entries(statusCodes).find(([, codes]) => codes.includes(normalizedCode))?.[0] || 'other'
}

export function summarizeClients(clients) {
  const statuses = {
    active: 0,
    inactive: 0,
    canceled: 0,
    suspended: 0,
    blocked: 0,
    awaitingInstallation: 0,
    other: 0,
  }
  const codes = {}

  for (const client of clients) {
    const code = String(client.Situacao || '').trim().toUpperCase() || '(vazio)'
    codes[code] = (codes[code] || 0) + 1
    statuses[getStatusKey(code)] += 1
  }

  return {
    total: clients.length,
    statuses,
    codes,
  }
}

async function routerboxRequest(operation, body) {
  const url = process.env.ROUTERBOX_URL
  const integrationKey = process.env.ROUTERBOX_INTEGRATION_KEY

  if (!url || !integrationKey) {
    throw new Error('Configure ROUTERBOX_URL e ROUTERBOX_INTEGRATION_KEY no arquivo .env.local.')
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      [operation]: {
        Autenticacao: {
          ChaveIntegracao: integrationKey,
        },
        ...body,
      },
    }),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`RouterBox respondeu com HTTP ${response.status}.`)
  }

  const payload = await response.json()

  if (Number(payload.status) !== 1 || !Array.isArray(payload.result)) {
    const detail = payload.erro_desc || payload.erro_inf || payload.erro_detail || 'Resposta inválida do RouterBox.'
    throw new Error(detail)
  }

  return payload.result
}

export function fetchClients() {
  return routerboxRequest('ConsultaClientes', { Filtro: '' })
}

export async function fetchClientsSummary() {
  const clients = await fetchClients()
  return { ...summarizeClients(clients), updatedAt: new Date().toISOString() }
}

export function fetchPaidDocuments(from, to) {
  return routerboxRequest('ConsultaDocumentosBaixados', {
    Filtro: `Movimento.DataBaixa >= '${from}' AND Movimento.DataBaixa <= '${to}'`,
  })
}

export function fetchAttendances(from, to) {
  return routerboxRequest('ConsultaAtendimentos', {
    Filtro: `Atendimentos.Data_AB >= '${from}' AND Atendimentos.Data_AB <= '${to}'`,
  })
}
