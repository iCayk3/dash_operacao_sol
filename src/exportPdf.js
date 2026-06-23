const COLORS = {
  primary: [23, 107, 135],
  dark: [23, 43, 58],
  muted: [108, 124, 137],
  light: [244, 247, 249],
  border: [225, 235, 239],
  success: [45, 156, 117],
  warning: [232, 162, 58],
  danger: [220, 100, 113],
}

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

function formatDate(value) {
  if (!value) return '-'
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

function addSectionTitle(doc, title, y) {
  doc.setTextColor(...COLORS.dark)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(title, 14, y)
  doc.setDrawColor(...COLORS.border)
  doc.line(14, y + 3, 196, y + 3)
  return y + 9
}

function addKpi(doc, x, y, width, label, value, accent) {
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(...COLORS.border)
  doc.roundedRect(x, y, width, 22, 2.5, 2.5, 'FD')
  doc.setFillColor(...accent)
  doc.roundedRect(x, y, 2.5, 22, 2.5, 2.5, 'F')
  doc.setTextColor(...COLORS.muted)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(label, x + 6, y + 7)
  doc.setTextColor(...COLORS.dark)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(String(value), x + 6, y + 16)
}

async function loadImageData(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Não foi possível carregar ${url}.`)
  const blob = await response.blob()

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function addContainedImage(doc, imageData, x, y, maxWidth, maxHeight) {
  const properties = doc.getImageProperties(imageData)
  const scale = Math.min(maxWidth / properties.width, maxHeight / properties.height)
  const width = properties.width * scale
  const height = properties.height * scale
  doc.addImage(
    imageData,
    'PNG',
    x + (maxWidth - width) / 2,
    y + (maxHeight - height) / 2,
    width,
    height,
  )
}

export async function exportDashboardPdf({ clients, financial, attendance }) {
  const [{ jsPDF }, { default: autoTable }, logoData] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadImageData('/logo-sol.png').catch(() => null),
  ])

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const period = financial?.period || attendance?.period
  const clientStatuses = clients?.statuses || {}
  const financialTotals = financial?.totals || {}
  const attendanceTotals = attendance?.totals || {}

  doc.setFillColor(...COLORS.primary)
  doc.rect(0, 0, 210, 35, 'F')
  if (logoData) {
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(12, 6, 31, 23, 2.5, 2.5, 'F')
    addContainedImage(doc, logoData, 14, 8, 27, 19)
  }
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(logoData ? 16 : 20)
  doc.text('SOL Provedor', logoData ? 48 : 14, 15)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text('Relatorio executivo da operacao', logoData ? 48 : 14, 23)
  doc.setFontSize(9)
  doc.text(
    period ? `Periodo: ${formatDate(period.from)} a ${formatDate(period.to)}` : 'Periodo atual',
    196,
    16,
    { align: 'right' },
  )
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, 196, 23, { align: 'right' })

  addKpi(doc, 14, 43, 42, 'Clientes ativos', (clientStatuses.active || 0).toLocaleString('pt-BR'), COLORS.primary)
  addKpi(doc, 60, 43, 42, 'Total de clientes', (clients?.total || 0).toLocaleString('pt-BR'), COLORS.success)
  addKpi(doc, 106, 43, 42, 'Recebimento liquido', money.format(financialTotals.net || 0), [139, 109, 177])
  addKpi(doc, 152, 43, 44, 'Atendimentos abertos', (attendanceTotals.open || 0).toLocaleString('pt-BR'), [226, 123, 88])

  let y = addSectionTitle(doc, 'Clientes por situacao', 75)
  autoTable(doc, {
    startY: y,
    head: [['Situacao', 'Quantidade', 'Participacao']],
    body: [
      ['Ativos', clientStatuses.active || 0],
      ['Inativos', clientStatuses.inactive || 0],
      ['Suspensos', clientStatuses.suspended || 0],
      ['Bloqueados', clientStatuses.blocked || 0],
      ['Aguardando instalacao', clientStatuses.awaitingInstallation || 0],
      ['Cancelados', clientStatuses.canceled || 0],
      ['Outros', clientStatuses.other || 0],
    ].map(([label, value]) => [
      label,
      Number(value).toLocaleString('pt-BR'),
      clients?.total ? `${((Number(value) / clients.total) * 100).toFixed(1).replace('.', ',')}%` : '0,0%',
    ]),
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 2.5, lineColor: COLORS.border },
    headStyles: { fillColor: COLORS.primary, textColor: 255 },
    alternateRowStyles: { fillColor: COLORS.light },
  })

  y = addSectionTitle(doc, 'Financeiro por grupo', doc.lastAutoTable.finalY + 12)
  autoTable(doc, {
    startY: y,
    head: [['Grupo', 'Docs.', 'Recebimentos', 'Ajustes', 'Liquido', '%']],
    body: (financial?.groups || []).map((group) => [
      `${group.groupId ? `${group.groupId} - ` : ''}${group.groupName}`,
      group.paidDocuments.toLocaleString('pt-BR'),
      money.format(group.entries),
      money.format(group.adjustments),
      money.format(group.net),
      `${group.share.toFixed(1).replace('.', ',')}%`,
    ]),
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 2.2, lineColor: COLORS.border },
    headStyles: { fillColor: COLORS.primary, textColor: 255 },
    alternateRowStyles: { fillColor: COLORS.light },
    columnStyles: {
      0: { cellWidth: 53 },
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
    },
  })

  doc.addPage()
  y = addSectionTitle(doc, 'Atendimento por situacao', 18)
  autoTable(doc, {
    startY: y,
    head: [['Situacao', 'Quantidade']],
    body: (attendance?.statuses || []).map((status) => [
      status.label,
      status.value.toLocaleString('pt-BR'),
    ]),
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 3, lineColor: COLORS.border },
    headStyles: { fillColor: COLORS.primary, textColor: 255 },
    alternateRowStyles: { fillColor: COLORS.light },
  })

  y = addSectionTitle(doc, 'Atendimento por area', doc.lastAutoTable.finalY + 12)
  autoTable(doc, {
    startY: y,
    head: [['Area', 'Quantidade', 'Participacao']],
    body: (attendance?.types || []).filter((type) => type.value > 0).map((type) => [
      type.label,
      type.value.toLocaleString('pt-BR'),
      attendanceTotals.records
        ? `${((type.value / attendanceTotals.records) * 100).toFixed(1).replace('.', ',')}%`
        : '0,0%',
    ]),
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 3, lineColor: COLORS.border },
    headStyles: { fillColor: COLORS.primary, textColor: 255 },
    alternateRowStyles: { fillColor: COLORS.light },
  })

  y = addSectionTitle(doc, 'Topicos mais frequentes', doc.lastAutoTable.finalY + 12)
  autoTable(doc, {
    startY: y,
    head: [['Topico', 'Quantidade']],
    body: (attendance?.topTopics || []).map((topic) => [
      topic.topic,
      topic.value.toLocaleString('pt-BR'),
    ]),
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 3, lineColor: COLORS.border },
    headStyles: { fillColor: COLORS.primary, textColor: 255 },
    alternateRowStyles: { fillColor: COLORS.light },
    columnStyles: { 1: { cellWidth: 30, halign: 'right' } },
  })

  const pageCount = doc.getNumberOfPages()
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page)
    doc.setDrawColor(...COLORS.border)
    doc.line(14, 286, 196, 286)
    doc.setTextColor(...COLORS.muted)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text('Dashboard local SOL Provedor', 14, 291)
    doc.text(`Pagina ${page} de ${pageCount}`, 196, 291, { align: 'right' })
  }

  const suffix = period ? `${period.from}_${period.to}` : localStorage.getItem('periodo') || 'atual'
  doc.save(`relatorio-sol-${suffix}.pdf`)
}
