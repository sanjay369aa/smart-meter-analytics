import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ReportPayload } from '../types/smartMeter';

export function exportReportPdf(report: ReportPayload): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 40;

  // Dark Navy executive header banner
  doc.setFillColor(11, 23, 42);
  doc.rect(0, 0, pageWidth, 84, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Smart Meter Analytics', marginX, 34);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const titleMap: Record<ReportPayload['report_type'], string> = {
    daily: 'Daily Electricity Consumption Report',
    weekly: 'Weekly Electricity Consumption Report',
    monthly: 'Monthly Electricity Consumption Report',
    forecast: 'Short-Term ARIMA Load Forecast Report',
  };
  doc.text(titleMap[report.report_type], marginX, 53);

  doc.setTextColor(148, 163, 184);
  doc.setFontSize(8.5);
  const dateLabel =
    report.date_range.start && report.date_range.end
      ? `Coverage: ${report.date_range.start} to ${report.date_range.end}`
      : 'Coverage: Active Dataset';
  doc.text(`${dateLabel}  |  Generated: ${new Date(report.generated_at).toUTCString()}`, marginX, 70);

  // Summary KPI Row
  const kpiY = 104;
  const kpiHeight = 52;
  const gap = 10;
  const cardWidth = (pageWidth - marginX * 2 - gap * 3) / 4;

  const kpis =
    report.report_type === 'forecast' && report.forecast_metrics
      ? [
          {
            label: '24h Forecast Total',
            value: `${report.forecast_rows.reduce((a, b) => a + b.predicted_kwh, 0).toFixed(1)} kWh`,
          },
          { label: 'Model MAE', value: `${report.forecast_metrics.mae.toFixed(2)} kWh` },
          { label: 'Model RMSE', value: `${report.forecast_metrics.rmse.toFixed(2)} kWh` },
          { label: 'Model MAPE', value: `${report.forecast_metrics.mape.toFixed(2)} %` },
        ]
      : [
          { label: 'Total Consumption', value: `${report.summary.total_energy_kwh.toLocaleString()} kWh` },
          { label: 'Period Average', value: `${report.summary.average_period_kwh.toLocaleString()} kWh` },
          { label: 'Peak Period Load', value: `${report.summary.peak_period_kwh.toLocaleString()} kWh` },
          { label: 'Active Smart Meters', value: String(report.summary.total_meters) },
        ];

  kpis.forEach((item, idx) => {
    const x = marginX + idx * (cardWidth + gap);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, kpiY, cardWidth, kpiHeight, 4, 4, 'FD');

    doc.setTextColor(100, 116, 139);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(item.label, x + 10, kpiY + 18);

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(item.value, x + 10, kpiY + 38);
  });

  // Visual bar summary embedded directly in PDF
  let tableStartY = kpiY + kpiHeight + 24;
  const chartItems =
    report.report_type === 'forecast'
      ? report.forecast_rows.slice(0, 12).map((r) => ({ label: r.timestamp.slice(11, 16), value: r.predicted_kwh }))
      : report.rows.slice(-12).map((r) => ({ label: r.period.slice(-5), value: r.total_kwh }));

  if (chartItems.length > 0) {
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text(
      report.report_type === 'forecast'
        ? 'Next 12 Hours Predicted Load Profile (kWh)'
        : 'Recent Consumption Trend Summary (kWh)',
      marginX,
      tableStartY
    );

    const chartTop = tableStartY + 12;
    const chartH = 92;
    const chartW = pageWidth - marginX * 2;
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(marginX, chartTop, chartW, chartH, 4, 4, 'FD');

    const maxVal = Math.max(...chartItems.map((c) => c.value), 1);
    const barGap = 8;
    const innerPad = 14;
    const barW = Math.max(10, (chartW - innerPad * 2 - barGap * (chartItems.length - 1)) / chartItems.length);
    const usableH = chartH - 30;

    chartItems.forEach((item, idx) => {
      const h = (item.value / maxVal) * usableH;
      const x = marginX + innerPad + idx * (barW + barGap);
      const y = chartTop + chartH - 18 - h;
      doc.setFillColor(29, 78, 216);
      doc.rect(x, y, barW, h, 'F');

      doc.setTextColor(71, 85, 105);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text(item.label, x + barW / 2, chartTop + chartH - 6, { align: 'center' });
    });

    tableStartY = chartTop + chartH + 22;
  }

  // Data Table
  if (report.report_type === 'forecast') {
    autoTable(doc, {
      startY: tableStartY,
      margin: { left: marginX, right: marginX },
      headStyles: { fillColor: [11, 23, 42], textColor: 255, fontSize: 8.5 },
      bodyStyles: { fontSize: 8.5, textColor: [15, 23, 42] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      head: [['Timestamp (UTC)', 'Predicted Load (kWh)', 'Lower 95% CI', 'Upper 95% CI']],
      body: report.forecast_rows.map((r) => [
        r.timestamp,
        r.predicted_kwh.toFixed(2),
        r.lower_bound.toFixed(2),
        r.upper_bound.toFixed(2),
      ]),
    });
  } else {
    autoTable(doc, {
      startY: tableStartY,
      margin: { left: marginX, right: marginX },
      headStyles: { fillColor: [11, 23, 42], textColor: 255, fontSize: 8.5 },
      bodyStyles: { fontSize: 8.5, textColor: [15, 23, 42] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      head: [['Period', 'Total (kWh)', 'Avg Hourly', 'Peak Hourly', 'Residential', 'Commercial', 'Industrial']],
      body: report.rows.map((r) => [
        r.period,
        r.total_kwh.toFixed(2),
        r.average_kwh.toFixed(2),
        r.peak_kwh.toFixed(2),
        r.residential_kwh.toFixed(2),
        r.commercial_kwh.toFixed(2),
        r.industrial_kwh.toFixed(2),
      ]),
    });
  }

  doc.save(`smart_meter_${report.report_type}_report.pdf`);
}
