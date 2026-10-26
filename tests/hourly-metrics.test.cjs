const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
process.env.TZ = 'Asia/Tokyo';
const ctx = vm.createContext({
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) }
});
vm.runInContext(fs.readFileSync('gas/00_Config.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('gas/90_Utils.js', 'utf8'), ctx);
vm.runInContext(`
  STAFF.staff1.workStyleId = 'hourly_part_time';
  WORK_STYLES.hourly_part_time.schedule = { weekday: [['09:00','13:00'], ['14:00','15:00']] };
`, ctx);
function metrics(id, minutes, breakM) {
  const start = new Date('2026-10-26T09:00:00+09:00');
  return ctx.calcAttendanceMetrics_(id, '2026-10-26', [[start, new Date(+start + minutes * 60000)]], minutes, breakM);
}
test('hourly ignores old scheduled segments and has no lateness', () => {
  const m = metrics('staff1', 300, 0);
  assert.equal(m.scheduledM, 0);
  assert.equal(m.lateEarlyM, 0);
  assert.equal(m.scheduledOutsideM, 0);
});
test('hourly overtime starts strictly after eight actual hours even without a break', () => {
  for (const minutes of [450, 480, 481, 540]) {
    const m = metrics('staff1', minutes, 0);
    assert.equal(m.scheduledOutsideM, Math.max(0, minutes - 480));
    assert.equal(m.statutoryOtM, Math.max(0, minutes - 480));
    assert.equal(m.scheduledOutsideM - m.statutoryOtM, 0);
  }
});
test('full time retains schedule and existing break-shortage overtime calculation', () => {
  const m = metrics('staff2', 480, 0);
  assert.equal(m.scheduledM, 450);
  assert.equal(m.legalBreakShortageM, 45);
  assert.equal(m.statutoryOtM, 45);
});
