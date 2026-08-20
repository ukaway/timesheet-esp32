// ===========================================================================
/**
 * 勤怠サマリ生成（別スプレッドシート出力可）
 * 打刻ログ [日時, staff_id, 職員, in/out] → 日次サマリ表を書き出す。
 *
 * 列: A日付 B曜日 C勤務 D出勤 E退勤 F休憩 G法定内残業 H時間外 I実働
 */

// ===== サマリ設定 =====
const SUMMARY = {
  OUTPUT_SS_ID: getScriptProp_('KINTAI_SUMMARY_OUTPUT_SS_ID', ''), // 別ブックに出すならそのID。空なら同一ブック
  DAYS_BACK: 31,             // 何日分さかのぼって集計するか
};
const WEEK_JP = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 全職員のサマリを生成。日次トリガー or 手動実行。
 */
function buildAllSummaries() {
  const srcSs = SpreadsheetApp.getActiveSpreadsheet();
  const tz = srcSs.getSpreadsheetTimeZone();
  const outSs = SUMMARY.OUTPUT_SS_ID
    ? SpreadsheetApp.openById(SUMMARY.OUTPUT_SS_ID)
    : srcSs;
  const logSh = srcSs.getSheetByName(CONFIG.LOG_SHEET);
  if (!logSh) return;

  Object.keys(STAFF).forEach(staffId => {
    const name = STAFF[staffId].name;
    buildSummaryForStaff_(logSh, outSs, name + '_勤怠', tz, staffId);
  });
}

/**
 * 1職員分のサマリを outSheetName に書き出す。
 */
function buildSummaryForStaff_(srcSheet, outSs, outSheetName, tz, staffId) {
  const raw = srcSheet.getDataRange().getValues();

  const events = {};
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SUMMARY.DAYS_BACK);
  for (let i = 1; i < raw.length; i++) {
    if (!raw[i][0]) continue;
    if (String(raw[i][1] || '').trim() !== staffId) continue;
    const t = new Date(raw[i][0]);
    if (isNaN(t.getTime()) || t < cutoff) continue;
    const dateStr = Utilities.formatDate(t, tz, 'yyyy-MM-dd');
    (events[dateStr] = events[dateStr] || []).push({ t: t, kind: raw[i][3] });
  }

  const dates = Object.keys(events).sort();
  const header = ['日付', '曜日', '勤務', '出勤', '退勤', '休憩', '法定内残業', '時間外', '実働'];

  // 出力タブは毎回作り直す（結合残り・古いデータを完全排除）
  const existing = outSs.getSheetByName(outSheetName);
  if (existing) outSs.deleteSheet(existing);
  const out = outSs.insertSheet(outSheetName);

  [
    80, // 日付
    30, // 曜日
    50, // 勤務
    40, // 出勤
    40, // 退勤
    40, // 休憩
    70, // 法定内残業
    50, // 時間外
    40  // 実働
  ].forEach((width, i) => {
    out.setColumnWidth(i + 1, width);
  });

  out.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  out.setFrozenRows(1);
  out.setFrozenColumns(3);

  const dataRows = [];

  dates.forEach(dateStr => {
    const evs = events[dateStr].sort((a, b) => a.t - b.t);

    const intervals = [];
    let curIn = null;
    evs.forEach(e => {
      if (e.kind === 'in') { if (curIn === null) curIn = e.t; }
      else { if (curIn !== null) { intervals.push([curIn, e.t]); curIn = null; } }
    });
    const stillIn = (curIn !== null);
    if (stillIn) intervals.push([curIn, null]);
    if (intervals.length === 0) return;

    const firstIn = intervals[0][0];
    const lastOut = stillIn ? null : intervals[intervals.length - 1][1];

    let breakMin = 0;
    for (let k = 0; k < intervals.length - 1; k++) {
      const g0 = intervals[k][1], g1 = intervals[k + 1][0];
      if (g0 && g1) breakMin += (g1 - g0) / 60000;
    }
    let workMin = 0;
    intervals.forEach(([a, b]) => { workMin += ((b || new Date()) - a) / 60000; });

    const overtime = calcOvertimeBreakdown_(workMin);

    const dObj = new Date(dateStr + 'T00:00:00');
    dataRows.push([
      dateStr, WEEK_JP[dObj.getDay()], true,
      Utilities.formatDate(firstIn, tz, 'HH:mm'),
      stillIn ? '勤務中' : Utilities.formatDate(lastOut, tz, 'HH:mm'),
      fmtMin_(breakMin),
      overtime.legalOtM > 0 ? fmtMin_(overtime.legalOtM) : '',
      overtime.statutoryOtM > 0 ? fmtMin_(overtime.statutoryOtM) : '',
      fmtMin_(workMin),
    ]);
  });

  if (dataRows.length === 0) return;

  // A〜I列の値を一括書き込み
  out.getRange(2, 1, dataRows.length, 9).setValues(dataRows);

  // A〜I列の値を左揃え
  out.getRange(1, 1, dataRows.length + 1, 9).setHorizontalAlignment('left');
}

// 日次トリガー設置（手動で一度実行）
function setupSummaryTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'buildAllSummaries') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('buildAllSummaries')
    .timeBased().atHour(1).nearMinute(0).everyDays(1)
    .inTimezone(SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone())
    .create();
}
