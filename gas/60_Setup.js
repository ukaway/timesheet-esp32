// ===========================================================================
// 初回セットアップ（手動実行）
// ===========================================================================
function setupTriggers() {
  // 既存の同名トリガーを削除（二重登録防止）
  ScriptApp.getProjectTriggers().forEach(t => {
    const fn = t.getHandlerFunction();
    if (['dailyCheckMissingClockout', 'applyEdits', 'onFormSubmit'].includes(fn)) {
      ScriptApp.deleteTrigger(t);
    }
  });

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();

  // 退勤漏れ日次チェック
  ScriptApp.newTrigger('dailyCheckMissingClockout')
    .timeBased().atHour(CONFIG.DAILY_HOUR).nearMinute(CONFIG.DAILY_MIN)
    .everyDays(1).inTimezone(tz).create();

  // フォーム送信で即反映
  ScriptApp.newTrigger('onFormSubmit')
    .forSpreadsheet(ss).onFormSubmit().create();

  // 取りこぼし対策の予備（1分毎の掃除）
  ScriptApp.newTrigger('applyEdits')
    .timeBased().everyMinutes(1).create();

  Logger.log('トリガー設置完了');
}

function protectAllStaffSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [CONFIG.LOG_SHEET, CONFIG.STATUS_SHEET].forEach(sheetName => {
    const sh = ss.getSheetByName(sheetName);
    if (!sh) return;
    const p = sh.protect().setDescription(sheetName + '（直接編集注意）');
    p.setWarningOnly(true);   // 警告のみ。完全ロックにするなら削除
  });
  Logger.log('生データシート保護完了');
}

function setupDataSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  getOrCreateLogSheet_(ss);
  getOrCreateStatusSheet_(ss);
  rebuildStatusSheetFromLog_(ss, tz);
  Logger.log('打刻ログ・現在状態シートの準備完了');
}

function migrateStaffSheetsToLog() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  const logSh = getOrCreateLogSheet_(ss);
  const existingKeys = {};
  const logRows = logSh.getDataRange().getValues();

  for (let i = 1; i < logRows.length; i++) {
    if (!logRows[i][0]) continue;
    const ts = Utilities.formatDate(new Date(logRows[i][0]), tz, 'yyyy-MM-dd HH:mm:ss');
    existingKeys[[ts, logRows[i][1], logRows[i][3]].join('|')] = true;
  }

  const rowsToAppend = [];
  Object.keys(STAFF).forEach(staffId => {
    const sh = ss.getSheetByName(STAFF[staffId].name);
    if (!sh) return;

    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i][0]) continue;
      const t = new Date(rows[i][0]);
      if (isNaN(t.getTime())) continue;
      const kind = String(rows[i][2] || '').trim();
      if (!kind) continue;

      const ts = Utilities.formatDate(t, tz, 'yyyy-MM-dd HH:mm:ss');
      const key = [ts, staffId, kind].join('|');
      if (existingKeys[key]) continue;
      existingKeys[key] = true;
      rowsToAppend.push([ts, staffId, STAFF[staffId].name, kind]);
    }
  });

  if (rowsToAppend.length > 0) {
    rowsToAppend.sort((a, b) => new Date(a[0]) - new Date(b[0]));
    logSh.getRange(logSh.getLastRow() + 1, 1, rowsToAppend.length, 4)
      .setValues(rowsToAppend);
  }
  rebuildStatusSheetFromLog_(ss, tz);
  Logger.log('職員別シートから打刻ログへ移行: ' + rowsToAppend.length + '件');
}
