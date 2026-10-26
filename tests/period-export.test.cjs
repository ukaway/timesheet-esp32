const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
process.env.TZ = 'Asia/Tokyo';
const ctx = vm.createContext({
  STAFF: { a: { name: 'A' }, b: { name: 'B' } },
  getScriptProp_: () => '',
  Utilities: { formatDate(date, tz, pattern) {
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(date);
    return pattern === 'HH:mm' ? parts.slice(11, 16) : parts.slice(0, pattern === 'yyyy-MM' ? 7 : 10);
  } },
  calcAttendanceMetrics_: () => ({ lateEarlyM: 15, scheduledOutsideM: 30, statutoryOtM: 10 })
});
for (const file of ['20_SummaryOutput.js', '30_WebApp.js']) {
  vm.runInContext(fs.readFileSync('gas/' + file, 'utf8'), ctx);
}
const raw = [['日時', 'staff_id', '職員', '区分'],
  ['2026-09-20T09:00:00+09:00', 'a', 'A', 'in'],
  ['2026-09-21T09:00:00+09:00', 'a', 'A', 'in'],
  ['2026-09-21T18:00:00+09:00', 'a', 'A', 'out'],
  ['2026-10-20T09:00:00+09:00', 'b', 'B', 'in'],
  ['2026-10-20T17:00:00+09:00', 'b', 'B', 'out'],
  ['2026-10-21T09:00:00+09:00', 'a', 'A', 'in']];
test('strict yyyy/mm/dd date validation', () => {
  assert.equal(ctx.parseExportDate_('2024/02/29'), '2024-02-29');
  for (const value of ['2026/02/29', '2026/04/31', '2026/9/21', '2026-09-21']) {
    assert.throws(() => ctx.parseExportDate_(value));
  }
});
test('inclusive month-spanning range and shared scheduled days', () => {
  const report = ctx.buildPeriodReport_(raw, '2026-09-21', '2026-10-20', 'Asia/Tokyo');
  assert.equal(report.days.length, 30);
  assert.equal(report.scheduled.size, 2);
  assert.equal(Object.keys(report.byStaff.a).length, 1);
  assert.equal(report.byStaff.a['2026-09-21'].workM, 540);
  assert.ok(report.byStaff.b['2026-10-20']);
});
test('editable numeric durations, formulas, rest classification and missing clockout', () => {
  const report = ctx.buildPeriodReport_(raw.concat([
    ['2026-09-22T09:00:00+09:00', 'a', 'A', 'in']
  ]), '2026-09-21', '2026-10-20', 'Asia/Tokyo');
  const writes = [];
  const range = { setValues(value) { writes.push(value); return this; } };
  for (const method of ['setValue', 'setFontWeight', 'setBackground', 'setNumberFormat', 'setNote']) range[method] = () => range;
  const layout = {};
  const sheet = { getMaxRows: () => 1000, getRange: () => range,
    setFrozenRows(n) { layout.rows = n; },
    setFrozenColumns(n) { layout.columns = n; },
    autoResizeColumns(start, count) { layout.resize = [start, count]; } };
  ctx.writePeriodSheet_(sheet, 'A', '2026-09-21', '2026-10-20', report.days, report.byStaff.a, report.scheduled);
  const data = writes.find(rows => rows.length === report.days.length);
  assert.deepEqual(Array.from(writes[0].slice(0, 4), row => row[2]), [
    '=B4*24', '=B5*24', '=B6*24', '=B7*24'
  ]);
  assert.deepEqual(Array.from(writes[1][0]), ['時間（hh:mm）', '時間（h）']);
  assert.equal(layout.rows, 10);
  assert.equal(layout.columns, 0);
  assert.deepEqual(layout.resize, [1, 12]);
  assert.equal(data[0][9], 540 / 1440);
  assert.equal(data[1][2], '要確認（未退勤）');
  assert.equal(data[1][9], '');
  assert.equal(data[2][2], '全員休み');
  assert.equal(data[29][2], '休み');
  assert.equal(writes[0][0][1], '=SUM(J11:J40)');
  assert.equal(writes[0][1][1], '=SUM(H11:H40)-SUM(I11:I40)');
  assert.equal(writes[0][2][1], '=SUM(I11:I40)');
  assert.equal(data[0][7], 30 / 1440);
  assert.equal(data[0][8], 10 / 1440);
  assert.equal(writes[0][2][4], '=SUM(K11:K40)-SUM(L11:L40)');
});
