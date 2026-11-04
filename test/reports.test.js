const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { sendExcel } = require('../src/server');

test('sendExcel creates a readable workbook with report rows and totals', async () => {
  const headers = {};
  let exported;
  const response = {
    setHeader(name, value) {
      headers[name] = value;
    },
    send(buffer) {
      exported = buffer;
    }
  };

  await sendExcel(response, 'reporte-ventas.xlsx', 'Ventas', [
    { header: 'Venta', key: 'saleId', width: 14 },
    { header: 'Total', key: 'total', width: 16, style: { numFmt: '$#,##0.00' } }
  ], [[15, 125.5]], ['Totales', 125.5]);

  assert.equal(headers['Content-Type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.match(headers['Content-Disposition'], /reporte-ventas\.xlsx/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(exported);
  const sheet = workbook.getWorksheet('Ventas');
  assert.deepEqual(sheet.getRow(1).values.slice(1), ['Venta', 'Total']);
  assert.deepEqual(sheet.getRow(2).values.slice(1), [15, 125.5]);
  assert.deepEqual(sheet.getRow(4).values.slice(1), ['Totales', 125.5]);
});
