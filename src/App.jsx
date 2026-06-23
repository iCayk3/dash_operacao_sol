import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Avatar, Box, Button, Chip, CircularProgress, CssBaseline, Divider, IconButton, LinearProgress,
  Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  ThemeProvider, Tooltip, Typography, createTheme,
} from '@mui/material'
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded'
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded'
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded'
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded'
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded'
import CircleIcon from '@mui/icons-material/Circle'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import { exportDashboardPdf } from './exportPdf'
import './App.css'

const theme = createTheme({
  palette: {
    primary: { main: '#176B87', dark: '#0F4C5C', light: '#D9EEF3' },
    secondary: { main: '#2D9C75' },
    success: { main: '#2D9C75' },
    warning: { main: '#E8A23A' },
    error: { main: '#DC6471' },
    background: { default: '#F4F7F9', paper: '#FFFFFF' },
    text: { primary: '#172B3A', secondary: '#6C7C89' },
    divider: '#E5EBEF',
  },
  shape: { borderRadius: 14 },
  typography: {
    fontFamily: 'Roboto, Arial, sans-serif',
    h4: { fontWeight: 700, letterSpacing: '-0.025em' },
    h6: { fontWeight: 700, letterSpacing: '-0.015em' },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: '#EDF1F3', padding: '11px 14px', fontSize: 12.5, whiteSpace: 'nowrap' },
        head: { background: '#F7F9FA', color: '#60717E', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.045em' },
      },
    },
    MuiChip: { styleOverrides: { root: { borderRadius: 7, fontWeight: 600 } } },
    MuiLinearProgress: {
      styleOverrides: {
        root: { height: 7, borderRadius: 10, backgroundColor: '#EDF2F4' },
        bar: { borderRadius: 10 },
      },
    },
  },
})

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const compactMoney = new Intl.NumberFormat('pt-BR', { notation: 'compact', style: 'currency', currency: 'BRL', maximumFractionDigits: 1 })

const clientStatusMeta = [
  { key: 'active', label: 'Ativos', color: '#2D9C75' },
  { key: 'inactive', label: 'Inativos', color: '#E8A23A' },
  { key: 'suspended', label: 'Suspensos', color: '#E27B58' },
  { key: 'blocked', label: 'Bloqueados', color: '#8B6DB1' },
  { key: 'awaitingInstallation', label: 'Aguardando instalação', color: '#3B82C4' },
  { key: 'canceled', label: 'Cancelados', color: '#91A1AD' },
  { key: 'other', label: 'Outros', color: '#C8D2D8' },
]

function localIsoDate(date = new Date()) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return offsetDate.toISOString().slice(0, 10)
}

function getMonthPeriod(year, monthIndex) {
  const today = new Date()
  const firstDay = new Date(year, monthIndex, 1)
  const lastDay = year === today.getFullYear() && monthIndex === today.getMonth()
    ? today
    : new Date(year, monthIndex + 1, 0)
  return { from: localIsoDate(firstDay), to: localIsoDate(lastDay) }
}

const currentDate = new Date()
const monthOptions = Array.from({ length: 6 }, (_, index) => {
  const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - (5 - index), 1)
  return {
    key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
    label: date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', ''),
    ...getMonthPeriod(date.getFullYear(), date.getMonth()),
  }
})

function Panel({ title, subtitle, action, children, className = '' }) {
  return (
    <Paper className={`panel ${className}`}>
      <Box className="panel-header">
        <Box>
          <Typography component="h2" variant="h6">{title}</Typography>
          {subtitle && <Typography variant="body2" color="text.secondary">{subtitle}</Typography>}
        </Box>
        {action || (
          <Tooltip title="Mais opções">
            <IconButton size="small"><MoreHorizRoundedIcon /></IconButton>
          </Tooltip>
        )}
      </Box>
      <Box className="panel-body">{children}</Box>
    </Paper>
  )
}

function KpiCard({ title, value, detail, icon: Icon, color, tint }) {
  const hasTrend = detail?.startsWith('+') || detail?.startsWith('-')
  return (
    <Paper className="kpi-card">
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Avatar variant="rounded" sx={{ bgcolor: tint, color, width: 44, height: 44 }}><Icon /></Avatar>
        <Chip size="small" color={hasTrend ? 'success' : 'primary'} variant="outlined" icon={hasTrend ? <ArrowUpwardRoundedIcon /> : undefined} label={detail} />
      </Stack>
      <Typography color="text.secondary" mt={2}>{title}</Typography>
      <Typography className="kpi-value">{value}</Typography>
    </Paper>
  )
}

function FinancialKpiCard({ original = 0, received = 0, discount = 0 }) {
  return (
    <Paper className="kpi-card financial-kpi-card">
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Avatar variant="rounded" sx={{ bgcolor: '#F0EAF6', color: '#8B6DB1', width: 44, height: 44 }}>
          <AccountBalanceWalletRoundedIcon />
        </Avatar>
        <Chip size="small" color="error" variant="outlined" label={`${compactMoney.format(discount)} descontos`} />
      </Stack>
      <Typography color="text.secondary" mt={2}>Financeiro do período</Typography>
      <Box className="financial-kpi-values">
        <Box>
          <Typography variant="caption" color="text.secondary">Sem desconto</Typography>
          <Typography className="financial-kpi-value">{compactMoney.format(original)}</Typography>
        </Box>
        <Divider orientation="vertical" flexItem />
        <Box>
          <Typography variant="caption" color="text.secondary">Com desconto</Typography>
          <Typography className="financial-kpi-value received">{compactMoney.format(received)}</Typography>
        </Box>
      </Box>
    </Paper>
  )
}

function DonutChart({ summary }) {
  const items = clientStatusMeta.map((item) => ({ ...item, value: summary?.statuses?.[item.key] || 0 }))
  const total = summary?.total || 0
  const gradient = total ? items.map((item, index) => {
    const start = items.slice(0, index).reduce((sum, previous) => sum + (previous.value / total) * 100, 0)
    return `${item.color} ${start}% ${start + (item.value / total) * 100}%`
  }).join(', ') : '#E7EDF0 0% 100%'
  return (
    <Box className="donut-wrap">
      <Box className="donut" sx={{ background: `conic-gradient(${gradient})` }}>
        <Box><Typography className="donut-value">{total.toLocaleString('pt-BR')}</Typography><Typography variant="caption" color="text.secondary">clientes</Typography></Box>
      </Box>
      <Stack className="status-list">
        {items.map((item) => (
          <Box className="status-item" key={item.label}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box className="legend-dot" sx={{ bgcolor: item.color }} />
              <Typography>{item.label}</Typography>
            </Stack>
            <Typography fontWeight={700}>{item.value.toLocaleString('pt-BR')}</Typography>
          </Box>
        ))}
      </Stack>
    </Box>
  )
}

function StatusOverview({ summary, loading, error }) {
  const total = summary?.total || 0
  const statuses = summary?.statuses || {}
  const groups = [
    ['Base ativa', statuses.active || 0, '#2D9C75'],
    ['Com restrição', (statuses.suspended || 0) + (statuses.blocked || 0), '#E27B58'],
    ['Aguardando instalação', statuses.awaitingInstallation || 0, '#3B82C4'],
    ['Fora da base ativa', (statuses.inactive || 0) + (statuses.canceled || 0), '#91A1AD'],
  ]
  return (
    <Panel title="Carteira de clientes" subtitle="Dados reais consultados no RouterBox">
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && !summary ? <Box className="loading-state"><CircularProgress size={28} /><Typography color="text.secondary">Consultando clientes…</Typography></Box> : <DonutChart summary={summary} />}
      <Divider sx={{ my: 2.5 }} />
      <Typography fontWeight={700} mb={1.5}>Composição da base</Typography>
      <Stack spacing={1.5}>
        {groups.map(([label, value, color]) => (
          <Box key={label}>
            <Stack direction="row" justifyContent="space-between" mb={0.7}>
              <Typography color="text.secondary">{label}</Typography>
              <Typography fontWeight={700}>{value.toLocaleString('pt-BR')} · {total ? ((value / total) * 100).toFixed(1).replace('.', ',') : '0,0'}%</Typography>
            </Stack>
            <LinearProgress variant="determinate" value={total ? (value / total) * 100 : 0} sx={{ '& .MuiLinearProgress-bar': { bgcolor: color } }} />
          </Box>
        ))}
      </Stack>
      {summary?.codes && (
        <Typography variant="caption" color="text.secondary" display="block" mt={2}>
          Códigos recebidos: {Object.entries(summary.codes).map(([code, value]) => `${code}: ${value}`).join(' · ')}
        </Typography>
      )}
    </Panel>
  )
}

function Attendance({ data, loading, error }) {
  const totals = data?.totals || {}
  const rows = [
    ['Em aberto', totals.open || 0, '#176B87'],
    ['Concluídos', totals.completed || 0, '#2D9C75'],
    ['Abertos hoje', totals.createdToday || 0, '#8B6DB1'],
    ['Encerrados hoje', totals.closedToday || 0, '#E8A23A'],
  ]
  const statusColors = { F: '#E8A23A', A: '#3B82C4', E: '#2D9C75', P: '#8B6DB1', C: '#91A1AD', B: '#DC6471', O: '#B8C2C8' }
  const typesTotal = data?.types?.reduce((sum, type) => sum + type.value, 0) || 0
  return (
    <Panel title="Atendimento" subtitle="Visão operacional do período">
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && !data ? <Box className="loading-state"><CircularProgress size={28} /><Typography color="text.secondary">Consultando atendimentos…</Typography></Box> : <Box className="attendance-grid">
        {rows.map(([label, value, color]) => (
          <Box className="attendance-item" key={label}>
            <Box className="mini-accent" sx={{ bgcolor: color }} />
            <Typography className="attendance-value">{value}</Typography>
            <Typography variant="body2" color="text.secondary">{label}</Typography>
          </Box>
        ))}
      </Box>}
      <Divider sx={{ my: 2 }} />
      <Typography fontWeight={700} mb={1}>Situação das ordens</Typography>
      <Stack className="attendance-status-list" spacing={0.8}>
        {data?.statuses?.filter((status) => status.value > 0).map((status) => (
          <Box className="attendance-status-row" key={status.code}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <CircleIcon sx={{ color: statusColors[status.code], fontSize: 11 }} />
              <Typography variant="body2">{status.label}</Typography>
            </Stack>
            <Typography variant="body2" fontWeight={700}>{status.value.toLocaleString('pt-BR')}</Typography>
          </Box>
        ))}
      </Stack>
      <Typography fontWeight={700} mt={2.5} mb={1.5}>Por área</Typography>
      <Stack spacing={1.4}>
        {data?.types?.filter((type) => type.code !== 'O').map((type, index) => {
          const colors = ['#8B6DB1', '#3B82C4', '#2D9C75']
          const percentage = typesTotal ? (type.value / typesTotal) * 100 : 0
          return (
            <Box key={type.code}>
              <Stack direction="row" justifyContent="space-between" mb={0.6}>
                <Typography variant="body2" color="text.secondary">{type.label}</Typography>
                <Typography variant="body2" fontWeight={700}>{type.value.toLocaleString('pt-BR')} · {percentage.toFixed(1).replace('.', ',')}%</Typography>
              </Stack>
              <LinearProgress variant="determinate" value={percentage} sx={{ '& .MuiLinearProgress-bar': { bgcolor: colors[index] } }} />
            </Box>
          )
        })}
      </Stack>
    </Panel>
  )
}

function FinancialByGroupTable({ groups = [] }) {
  return (
    <TableContainer>
      <Table size="small">
        <TableHead><TableRow>{['Grupo', 'Documentos', 'Valor original', 'Juros / multa', 'Descontos', 'Valor baixado', 'Participação'].map(x => <TableCell key={x}>{x}</TableCell>)}</TableRow></TableHead>
        <TableBody>
          {groups.map((group) => (
            <TableRow hover key={group.groupId || group.groupName}>
              <TableCell>
                <Stack direction="row" alignItems="center" spacing={1}>
                  {group.groupId && <Chip size="small" label={group.groupId} />}
                  <Typography fontWeight={600} fontSize="inherit">{group.groupName}</Typography>
                </Stack>
              </TableCell>
              <TableCell>{group.paidDocuments.toLocaleString('pt-BR')}</TableCell>
              <TableCell className="positive">{money.format(group.original)}</TableCell>
              <TableCell>{money.format(group.fees)}</TableCell>
              <TableCell className={group.discounts > 0 ? 'negative' : ''}>{money.format(group.discounts)}</TableCell>
              <TableCell><Typography fontWeight={700} fontSize="inherit">{money.format(group.received)}</Typography></TableCell>
              <TableCell>{group.share.toFixed(1).replace('.', ',')}%</TableCell>
            </TableRow>
          ))}
          {!groups.length && <TableRow><TableCell colSpan={7} align="center">Nenhuma movimentação no período.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

function ReceiptsChart({ daily = [] }) {
  const values = daily.map((item) => item.value)
  const max = Math.max(...values, 1)
  const denominator = Math.max(daily.length - 1, 1)
  const points = daily.map((item, index) => `${index * (920 / denominator)},${126 - (Math.max(item.value, 0) / max) * 104}`).join(' ')
  const areaPoints = daily.length ? `0,126 ${points} 920,126` : ''
  return (
    <Box className="chart-block">
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
        <Box><Typography fontWeight={700}>Recebimentos no período</Typography><Typography variant="body2" color="text.secondary">Valor diário processado</Typography></Box>
        <Stack direction="row" spacing={2}>
          <Stack direction="row" alignItems="center" spacing={0.7}><Box className="legend-dot" sx={{ bgcolor: '#176B87' }} /><Typography variant="caption">Valor</Typography></Stack>
          <Stack direction="row" alignItems="center" spacing={0.7}><Box className="legend-dot" sx={{ bgcolor: '#E8A23A' }} /><Typography variant="caption">Quantidade</Typography></Stack>
        </Stack>
      </Stack>
      <Box className="chart">
        <Box className="y-labels"><span>100 mil</span><span>50 mil</span><span>0</span></Box>
        <svg viewBox="0 0 920 150" preserveAspectRatio="none" aria-label="Gráfico de títulos recebidos">
          <defs>
            <linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#176B87" stopOpacity=".2" /><stop offset="100%" stopColor="#176B87" stopOpacity=".01" /></linearGradient>
            <pattern id="grid" width="76" height="26" patternUnits="userSpaceOnUse"><path d="M 76 0 L 0 0 0 26" fill="none" stroke="#EAF0F3" /></pattern>
          </defs>
          <rect width="920" height="126" fill="url(#grid)" />
          {daily.length > 0 && <polygon points={areaPoints} fill="url(#area)" />}
          {daily.length > 0 && <polyline points={points} fill="none" stroke="#176B87" strokeWidth="3" strokeLinejoin="round" />}
          {daily.map((item, index) => <circle key={item.date} cx={index * (920 / denominator)} cy={126 - (Math.max(item.value, 0) / max) * 104} r="3" fill="#fff" stroke="#176B87" strokeWidth="2" />)}
          {daily.map((item, index) => <text key={item.date} x={index * (920 / Math.max(daily.length, 1)) + 8} y="146" fontSize="8" fill="#8796A1">{item.date.slice(8, 10)}</text>)}
        </svg>
      </Box>
    </Box>
  )
}

function FinancialPanel({ data, loading, error, selectedMonth, onMonthChange, onRefresh }) {
  const totals = data?.totals || {}
  return (
    <Panel
      title="Fluxo financeiro"
      subtitle="Recebimentos e ajustes consolidados por grupo"
      className="finance-panel"
      action={<Tooltip title="Atualizar dados"><span><IconButton disabled={loading} onClick={onRefresh}>{loading ? <CircularProgress size={20} /> : <RefreshRoundedIcon />}</IconButton></span></Tooltip>}
    >
      {error && <Alert severity="error" sx={{ mx: 2.5, mb: 2 }}>{error}</Alert>}
      <Stack className="filter-row" direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Chip icon={<CalendarMonthRoundedIcon />} label={data ? `${data.period.from.split('-').reverse().join('/')} a ${data.period.to.split('-').reverse().join('/')}` : 'Carregando período'} variant="outlined" />
        <Stack direction="row" gap={0.7} flexWrap="wrap" justifyContent="flex-end">
          {monthOptions.map(item => (
            <Button size="small" className="month-button" variant={selectedMonth === item.key ? 'contained' : 'text'} onClick={() => onMonthChange(item)} key={item.key}>{item.label}</Button>
          ))}
        </Stack>
      </Stack>
      {loading && !data ? <Box className="loading-state"><CircularProgress size={28} /><Typography color="text.secondary">Consultando documentos baixados…</Typography></Box> : <FinancialByGroupTable groups={data?.groups} />}
      <Box className="finance-summary">
        <Box><Typography variant="caption" color="text.secondary">Sem desconto (valor original)</Typography><Typography fontWeight={700}>{money.format(totals.original || 0)}</Typography></Box>
        <Divider orientation="vertical" flexItem />
        <Box><Typography variant="caption" color="text.secondary">Documentos pagos</Typography><Typography fontWeight={700}>{(totals.paidDocuments || 0).toLocaleString('pt-BR')}</Typography></Box>
        <Divider orientation="vertical" flexItem />
        <Box><Typography variant="caption" color="text.secondary">Juros / multa</Typography><Typography fontWeight={700}>{money.format(totals.fees || 0)}</Typography></Box>
        <Divider orientation="vertical" flexItem />
        <Box><Typography variant="caption" color="text.secondary">Descontos</Typography><Typography fontWeight={700} color="error.main">{money.format(totals.discount || 0)}</Typography></Box>
        <Divider orientation="vertical" flexItem />
        <Box><Typography variant="caption" color="text.secondary">Com desconto (valor baixado)</Typography><Typography fontWeight={700} color="primary.main">{money.format(totals.received || 0)}</Typography></Box>
      </Box>
      {(totals.duplicatesRemoved || 0) > 0 && (
        <Typography variant="caption" color="text.secondary" display="block" mx={2.5} mb={1}>
          {totals.duplicatesRemoved.toLocaleString('pt-BR')} lançamento(s) repetido(s) do mesmo boleto consolidado(s) automaticamente.
        </Typography>
      )}
      <ReceiptsChart daily={data?.daily} />
    </Panel>
  )
}

function AttendanceRecentPanel({ data }) {
  const statusColors = {
    F: 'warning', A: 'primary', E: 'success', P: 'secondary',
    C: 'default', B: 'error', O: 'default',
  }
  return (
    <Panel title="Atendimentos recentes" subtitle="Últimas ocorrências abertas no período selecionado">
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>{['Número', 'Abertura', 'Área', 'Situação', 'Tópico', 'Designado para', 'Usuário'].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow>
          </TableHead>
          <TableBody>
            {data?.recent?.map((attendance) => (
              <TableRow hover key={attendance.number}>
                <TableCell><Chip size="small" label={`#${attendance.number}`} /></TableCell>
                <TableCell>{attendance.openedAt}</TableCell>
                <TableCell><Chip size="small" variant="outlined" label={attendance.typeName} /></TableCell>
                <TableCell><Chip size="small" color={statusColors[attendance.status]} label={attendance.statusName} /></TableCell>
                <TableCell className="topic-cell">{attendance.topic}</TableCell>
                <TableCell>{attendance.assignedTo}</TableCell>
                <TableCell>{attendance.openingUser}</TableCell>
              </TableRow>
            ))}
            {!data?.recent?.length && <TableRow><TableCell colSpan={7} align="center">Nenhum atendimento no período.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
      {!!data?.topTopics?.length && (
        <Box className="topics-summary">
          <Typography fontWeight={700} mb={1.2}>Tópicos mais frequentes</Typography>
          <Box className="topics-grid">
            {data.topTopics.map((topic) => (
              <Chip
                className="topic-chip"
                key={topic.topic}
                variant="outlined"
                label={`${topic.topic} · ${topic.value}`}
              />
            ))}
          </Box>
        </Box>
      )}
    </Panel>
  )
}

function App() {
  const [clientsSummary, setClientsSummary] = useState(null)
  const [clientsLoading, setClientsLoading] = useState(true)
  const [clientsError, setClientsError] = useState('')
  const initialMonth = monthOptions.at(-1)
  const [selectedMonth, setSelectedMonth] = useState(initialMonth.key)
  const [financialPeriod, setFinancialPeriod] = useState({ from: initialMonth.from, to: initialMonth.to })
  const [financialData, setFinancialData] = useState(null)
  const [financialLoading, setFinancialLoading] = useState(true)
  const [financialError, setFinancialError] = useState('')
  const [attendanceData, setAttendanceData] = useState(null)
  const [attendanceLoading, setAttendanceLoading] = useState(true)
  const [attendanceError, setAttendanceError] = useState('')
  const [pdfLoading, setPdfLoading] = useState(false)

  const loadClients = useCallback(async (forceRefresh = false, signal) => {
    setClientsLoading(true)
    setClientsError('')
    try {
      const response = await fetch(`/api/clientes/resumo${forceRefresh ? '?refresh=1' : ''}`, { signal })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || payload.message || 'Falha ao consultar clientes.')
      setClientsSummary(payload)
    } catch (error) {
      if (error.name !== 'AbortError') setClientsError(error.message)
    } finally {
      if (!signal?.aborted) setClientsLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/clientes/resumo', { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.detail || payload.message || 'Falha ao consultar clientes.')
        return payload
      })
      .then((payload) => setClientsSummary(payload))
      .catch((error) => {
        if (error.name !== 'AbortError') setClientsError(error.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setClientsLoading(false)
      })
    return () => controller.abort()
  }, [])

  const loadFinancial = useCallback(async (period = financialPeriod, forceRefresh = false) => {
    setFinancialLoading(true)
    setFinancialError('')
    try {
      const params = new URLSearchParams({ from: period.from, to: period.to })
      if (forceRefresh) params.set('refresh', '1')
      const response = await fetch(`/api/financeiro/resumo?${params}`)
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || payload.message || 'Falha ao consultar dados financeiros.')
      setFinancialData(payload)
    } catch (error) {
      setFinancialError(error.message)
    } finally {
      setFinancialLoading(false)
    }
  }, [financialPeriod])

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ from: initialMonth.from, to: initialMonth.to })
    fetch(`/api/financeiro/resumo?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.detail || payload.message || 'Falha ao consultar dados financeiros.')
        return payload
      })
      .then((payload) => setFinancialData(payload))
      .catch((error) => {
        if (error.name !== 'AbortError') setFinancialError(error.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setFinancialLoading(false)
      })
    return () => controller.abort()
  }, [initialMonth.from, initialMonth.to])

  const loadAttendance = useCallback(async (period = financialPeriod, forceRefresh = false) => {
    setAttendanceLoading(true)
    setAttendanceError('')
    try {
      const params = new URLSearchParams({ from: period.from, to: period.to })
      if (forceRefresh) params.set('refresh', '1')
      const response = await fetch(`/api/atendimentos/resumo?${params}`)
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || payload.message || 'Falha ao consultar atendimentos.')
      setAttendanceData(payload)
    } catch (error) {
      setAttendanceError(error.message)
    } finally {
      setAttendanceLoading(false)
    }
  }, [financialPeriod])

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ from: initialMonth.from, to: initialMonth.to })
    fetch(`/api/atendimentos/resumo?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.detail || payload.message || 'Falha ao consultar atendimentos.')
        return payload
      })
      .then((payload) => setAttendanceData(payload))
      .catch((error) => {
        if (error.name !== 'AbortError') setAttendanceError(error.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setAttendanceLoading(false)
      })
    return () => controller.abort()
  }, [initialMonth.from, initialMonth.to])

  const handleMonthChange = useCallback((month) => {
    const period = { from: month.from, to: month.to }
    setSelectedMonth(month.key)
    setFinancialPeriod(period)
    loadFinancial(period)
    loadAttendance(period)
  }, [loadAttendance, loadFinancial])

  const refreshAll = useCallback(() => {
    loadClients(true)
    loadFinancial(financialPeriod, true)
    loadAttendance(financialPeriod, true)
  }, [financialPeriod, loadAttendance, loadClients, loadFinancial])

  const handleExportPdf = useCallback(async () => {
    setPdfLoading(true)
    try {
      await exportDashboardPdf({
        clients: clientsSummary,
        financial: financialData,
        attendance: attendanceData,
      })
    } finally {
      setPdfLoading(false)
    }
  }, [attendanceData, clientsSummary, financialData])

  const activeClients = clientsSummary?.statuses?.active || 0
  const totalClients = clientsSummary?.total || 0
  const activePercentage = totalClients ? `${((activeClients / totalClients) * 100).toFixed(1).replace('.', ',')}% ativos` : 'API RouterBox'
  const financialTotals = financialData?.totals || {}
  const attendanceTotals = attendanceData?.totals || {}
  const isRefreshing = clientsLoading || financialLoading || attendanceLoading

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box component="main" className="dashboard">
        <Box className="dashboard-shell">
          <Box component="header" className="topbar">
            <Stack direction="row" alignItems="center" spacing={1.4}>
              <Avatar className="brand-mark"><DashboardRoundedIcon /></Avatar>
              <Box><Typography variant="h6">Central de operações</Typography><Typography variant="body2" color="text.secondary">Visão geral da SOL Provedor</Typography></Box>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Box className="sync-status"><CircleIcon color={clientsError ? 'error' : 'success'} sx={{ fontSize: 8 }} /><Typography variant="body2">{clientsLoading ? 'Sincronizando clientes…' : clientsError ? 'Falha na sincronização' : 'Clientes atualizados'}</Typography></Box>
              <Avatar className="user-avatar">SOL</Avatar>
            </Stack>
          </Box>

          <Box className="page-heading">
            <Box><Typography variant="h4">Dashboard</Typography><Typography color="text.secondary">Acompanhe os principais indicadores da operação.</Typography></Box>
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                disabled={pdfLoading || !clientsSummary || !financialData || !attendanceData}
                startIcon={pdfLoading ? <CircularProgress size={17} /> : <DownloadRoundedIcon />}
                onClick={handleExportPdf}
              >
                Exportar PDF
              </Button>
              <Button variant="contained" disabled={isRefreshing} startIcon={isRefreshing ? <CircularProgress size={17} color="inherit" /> : <RefreshRoundedIcon />} onClick={refreshAll}>Atualizar dados</Button>
            </Stack>
          </Box>

          <Box className="kpi-grid">
            <KpiCard title="Clientes ativos" value={activeClients.toLocaleString('pt-BR')} detail={activePercentage} icon={GroupsRoundedIcon} color="#176B87" tint="#DDEFF3" />
            <KpiCard title="Total de clientes" value={totalClients.toLocaleString('pt-BR')} detail="API RouterBox" icon={DescriptionRoundedIcon} color="#2D9C75" tint="#E2F3EC" />
            <FinancialKpiCard
              original={financialTotals.original}
              received={financialTotals.received}
              discount={financialTotals.discount}
            />
            <KpiCard title="Atendimentos abertos" value={(attendanceTotals.open || 0).toLocaleString('pt-BR')} detail={`${(attendanceTotals.completed || 0).toLocaleString('pt-BR')} concluídos`} icon={SupportAgentRoundedIcon} color="#E27B58" tint="#FBEAE5" />
          </Box>

          <Box className="content-grid">
            <Box className="side-column">
              <StatusOverview summary={clientsSummary} loading={clientsLoading} error={clientsError} />
              <Attendance data={attendanceData} loading={attendanceLoading} error={attendanceError} />
            </Box>
            <Box className="main-column">
              <FinancialPanel
                data={financialData}
                loading={financialLoading}
                error={financialError}
                selectedMonth={selectedMonth}
                onMonthChange={handleMonthChange}
                onRefresh={() => loadFinancial(financialPeriod, true)}
              />
              <AttendanceRecentPanel data={attendanceData} />
            </Box>
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  )
}

export default App
