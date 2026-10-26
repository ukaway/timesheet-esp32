// ===========================================================================
/**
 * 勤怠サマリ生成（別スプレッドシート出力可）
 * 打刻ログ [日時, staff_id, 職員, in/out] → 日次サマリ表を書き出す。
 *
 * 列: A日付 B曜日 C勤務 D出勤 E退勤 F休憩 G遅早 H所定外労働 Iうち時間外 J実働
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
  const header = ['日付', '曜日', '勤務', '出勤', '退勤', '休憩', '遅早', '所定外労働', 'うち時間外', '実働'];

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

    const metrics = calcAttendanceMetrics_(staffId, dateStr, intervals, workMin, breakMin);

    const dObj = new Date(dateStr + 'T00:00:00');
    dataRows.push([
      dateStr, WEEK_JP[dObj.getDay()], true,
      Utilities.formatDate(firstIn, tz, 'HH:mm'),
      stillIn ? '勤務中' : Utilities.formatDate(lastOut, tz, 'HH:mm'),
      fmtMin_(breakMin),
      metrics.lateEarlyM > 0 ? fmtSignedMin_(-metrics.lateEarlyM) : '',
      metrics.scheduledOutsideM > 0 ? fmtMin_(metrics.scheduledOutsideM) : '',
      metrics.statutoryOtM > 0 ? fmtMin_(metrics.statutoryOtM) : '',
      fmtMin_(workMin),
    ]);
  });

  if (dataRows.length === 0) {
    // 以前の自動サマリがあれば、過去データを表示し続けないよう空にする。
    const previous = outSs.getSheetByName(outSheetName);
    if (previous) previous.clearContents();
    return;
  }

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
    50, // 遅早
    80, // 所定外労働
    70, // うち時間外
    40  // 実働
  ].forEach((width, i) => {
    out.setColumnWidth(i + 1, width);
  });

  out.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  out.setFrozenRows(1);
  out.setFrozenColumns(3);

  // A〜J列の値を一括書き込み
  out.getRange(2, 1, dataRows.length, 10).setValues(dataRows);

  // A〜J列の値を左揃え
  out.getRange(1, 1, dataRows.length + 1, 10).setHorizontalAlignment('left');
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

// ===== 任意期間の保存用ブック（既存サマリとは別に毎回新規作成） =====
function onOpen() {
  SpreadsheetApp.getUi().createMenu('勤怠出力')
    .addItem('出力設定シートを作成・開く', 'setupAttendanceExportSettings')
    .addItem('設定した期間でブック保存', 'exportAttendanceBookFromSettings')
    .addToUi();
}

function exportAttendanceBookPrompt() {
  const ui = SpreadsheetApp.getUi();
  const start = ui.prompt('勤怠ブック保存', '開始日（yyyy/mm/dd）', ui.ButtonSet.OK_CANCEL);
  if (start.getSelectedButton() !== ui.Button.OK) return;
  const end = ui.prompt('勤怠ブック保存', '終了日（yyyy/mm/dd・当日を含む）', ui.ButtonSet.OK_CANCEL);
  if (end.getSelectedButton() !== ui.Button.OK) return;
  try {
    const result = exportAttendanceBook(start.getResponseText(), end.getResponseText());
    ui.alert('保存完了', result.url, ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('保存できませんでした', err.message, ui.ButtonSet.OK);
  }
}

function parseExportDate_(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(text)) {
    throw new Error('日付は yyyy/mm/dd 形式で入力してください。');
  }
  const key = text.replace(/\//g, '-');
  const date = new Date(key + 'T00:00:00Z');
  if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== key) {
    throw new Error('存在する日付を入力してください。');
  }
  return key;
}

/** 全職員1人1シート。元ログや過去の保存ブックは変更しない。 */
function exportAttendanceBook(startDate, endDate) {
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email || !ADMIN_SET.has(email)) throw new Error('全職員の勤怠出力は管理者のみ利用できます。');
  const start = parseExportDate_(startDate);
  const end = parseExportDate_(endDate);
  if (start > end) throw new Error('終了日は開始日以降にしてください。');
  const src = SpreadsheetApp.getActiveSpreadsheet();
  const tz = src.getSpreadsheetTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  if (end > today) throw new Error('未来の日付は指定できません。');
  const ids = Object.keys(STAFF);
  if (!ids.length) throw new Error('職員が登録されていません。');
  const log = src.getSheetByName(CONFIG.LOG_SHEET);
  if (!log) throw new Error('打刻ログがありません。');
  const report = buildPeriodReport_(log.getDataRange().getValues(), start, end, tz);
  const activeIds = staffIdsWithRecords_(report);
  if (!activeIds.length) throw new Error('指定期間に出勤記録がありません。');
  const book = SpreadsheetApp.create('勤怠_' + start + '~' + end);
  book.setSpreadsheetTimeZone(tz);
  activeIds.forEach((id, index) => {
    // IDを付けて同姓同名や使用不可文字によるタブ名の重複を避ける。
    const name = (STAFF[id].name).replace(/[\[\]:*?\/\\]/g, '_').slice(0, 90) + '_' + (index + 1);
    const sheet = index === 0 ? book.getSheets()[0].setName(name) : book.insertSheet(name);
    writePeriodSheet_(sheet, STAFF[id].name, start, end, report.days, report.byStaff[id], report.scheduled);
  });
  SpreadsheetApp.flush();
  return { url: book.getUrl(), id: book.getId() };
}

function buildPeriodReport_(raw, start, end, tz) {
  const days = [];
  for (let d = new Date(start + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  // 全員の所定日判定も、出力時点の同じログを使う。
  const filtered = [raw[0] || []];
  raw.slice(1).forEach(row => {
    if (!row[0]) return;
    const t = new Date(row[0]);
    if (isNaN(t.getTime())) return;
    const key = Utilities.formatDate(t, tz, 'yyyy-MM-dd');
    if (key >= start && key <= end && (row[3] === 'in' || row[3] === 'out')) filtered.push(row);
  });
  const source = { getDataRange: () => ({ getValues: () => filtered }) };
  const months = [...new Set(days.map(d => d.slice(0, 7)))];
  const byStaff = {};
  const scheduled = new Set();
  Object.keys(STAFF).forEach(id => {
    const rows = months.reduce((all, month) => all.concat(summarizeDaily_(source, tz, month, id)), []);
    byStaff[id] = {};
    rows.forEach(row => {
      byStaff[id][row.date] = row;
      scheduled.add(row.date);
    });
  });
  return { days: days, byStaff: byStaff, scheduled: scheduled };
}

function writePeriodSheet_(sheet, name, start, end, days, records, scheduled) {
  const headerRow = 10;
  const first = headerRow + 1;
  const last = headerRow + days.length;
  const header = ['日付', '曜日', '区分', '出勤', '退勤', '休憩', '遅刻早退', '所定外労働', '時間外労働', '実働', '所定日', '出勤日'];
  if (sheet.getMaxRows() < last) sheet.insertRowsAfter(sheet.getMaxRows(), last - sheet.getMaxRows());
  const data = days.map(day => {
    const r = records[day];
    const weekday = WEEK_JP[new Date(day + 'T00:00:00Z').getUTCDay()];
    if (!r) return [day.replace(/-/g, '/'), weekday, scheduled.has(day) ? '休み' : '全員休み', '', '', 0, 0, 0, 0, 0, scheduled.has(day) ? 1 : 0, 0];
    // 未退勤を現在時刻まで延長して確定値として保存しない。
    const duration = m => r.stillIn ? '' : Math.round(m) / 1440;
    return [day.replace(/-/g, '/'), weekday, r.stillIn ? '要確認（未退勤）' : '出勤', r.inStr, r.outStr,
      duration(r.breakM), duration(r.lateEarlyM), duration(r.scheduledOutsideM), duration(r.statutoryOtM), duration(r.workM), 1, 1];
  });
  sheet.getRange('A1').setValue(name + ' 勤怠記録');
  sheet.getRange('A2').setValue(start.replace(/-/g, '/') + '〜' + end.replace(/-/g, '/') + '（両端含む）');
  const sum = col => '=SUM(' + col + first + ':' + col + last + ')';
  sheet.getRange(4, 1, 5, 5).setValues([
    ['総労働時間', sum('J'), '=B4*24', '総出勤日数', sum('L')],
    ['総所定外労働（時間外を除く）', sum('H') + '-SUM(I' + first + ':I' + last + ')', '=B5*24', '所定日数（全員共通）', sum('K')],
    ['総時間外労働', sum('I'), '=B6*24', '休み（所定日の本人未出勤）', '=SUM(K' + first + ':K' + last + ')-SUM(L' + first + ':L' + last + ')'],
    ['総遅刻早退', sum('G'), '=B7*24', '全員休みの日数', '=' + days.length + '-SUM(K' + first + ':K' + last + ')'],
    ['未退勤の時間は集計対象外', '', '', '要確認日数', '=COUNTIF(C' + first + ':C' + last + ',"要確認*")']
  ]);
  sheet.getRange('B4:B7').setNumberFormat('[h]:mm');
  sheet.getRange('E4:E8').setNumberFormat('0');
  // Sheetsの時間は日単位なので、隣のC列に24倍した小数時間を併記する。
  sheet.getRange('B3:C3').setValues([['時間（hh:mm）', '時間（h）']]).setFontWeight('bold');
  sheet.getRange('C4:C7').setNumberFormat('0.00" h"');
  sheet.getRange(headerRow, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#dce6f1');
  sheet.getRange(first, 1, data.length, header.length).setValues(data);
  sheet.getRange(first, 6, data.length, 5).setNumberFormat('[h]:mm');
  sheet.getRange(first, 11, data.length, 2).setNumberFormat('0');
  sheet.setFrozenRows(headerRow);
  sheet.setFrozenColumns(0);
  // G列以降は折り返さず、見出し・日別データの最長表示に幅を合わせる。
  sheet.getRange(1, 7, last, header.length - 6).setWrap(false);
  SpreadsheetApp.flush();
  sheet.autoResizeColumns(1, 6);
  sheet.autoResizeColumns(7, header.length - 6);
  sheet.getRange('A1').setFontWeight('bold');
  sheet.getRange('K10:L10').setNote('所定日・出勤日は1、該当しない日は0。集計はこの列を参照します。');
}


/** 初回に実行。入力済みの期間は上書きしない。UIを使わずGASエディタから実行可能。 */
function setupAttendanceExportSettings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('出力設定');
  if (!sheet) {
    sheet = ss.insertSheet('出力設定');
    sheet.getRange('A1:B1').setValues([['勤怠ブック出力設定', '入力値']]).setFontWeight('bold');
    sheet.getRange('A2:A3').setValues([['開始日'], ['終了日']]);
    sheet.getRange('B2:B3').setNumberFormat('@');
    sheet.getRange('B2').setNote('yyyy/mm/dd形式で入力。例: 2026/09/21');
    sheet.getRange('B3').setNote('yyyy/mm/dd形式で入力。例: 2026/10/20（当日を含む）');
    sheet.getRange('A5:B7').setValues([
      ['使い方', 'B2に開始日、B3に終了日を入力してください。'],
      ['実行関数', 'exportAttendanceBookFromSettings'],
      ['保存先URL', '']
    ]);
    sheet.setColumnWidth(1, 180);
    sheet.setColumnWidth(2, 480);
    sheet.setFrozenRows(1);
  }
  ss.setActiveSheet(sheet);
  console.log('出力設定シートのB2・B3に日付（yyyy/mm/dd）を入力してください。');
}

/** 出力設定のB2/B3を読み取り、保存したブックのURLをB7に記録する。 */
function exportAttendanceBookFromSettings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('出力設定');
  if (!sheet) {
    setupAttendanceExportSettings();
    throw new Error('出力設定シートを作成しました。B2に開始日、B3に終了日を入力し、再実行してください。');
  }
  const values = sheet.getRange('B2:B3').getValues();
  const tz = ss.getSpreadsheetTimeZone();
  const start = exportSettingsDateText_(values[0][0], tz);
  const end = exportSettingsDateText_(values[1][0], tz);
  if (!start || !end) throw new Error('出力設定シートのB2・B3に日付（yyyy/mm/dd）を入力してください。');
  const result = exportAttendanceBook(start, end);
  sheet.getRange('B7').setValue(result.url);
  console.log('保存完了: ' + result.url);
  return result;
}

function exportSettingsDateText_(value, tz) {
  // Sheetsが入力を日付型に変換した場合も、ブックのタイムゾーンで扱う。
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, tz, 'yyyy/MM/dd');
  }
  return String(value == null ? '' : value).trim();
}


/** 期間内に出勤（未退勤も含む）がある職員のみ。IDの固定除外はしない。 */
function staffIdsWithRecords_(report) {
  return Object.keys(STAFF).filter(id => Object.keys(report.byStaff[id] || {}).length > 0);
}
