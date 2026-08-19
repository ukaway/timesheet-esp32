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
  Object.values(STAFF).forEach(({ name }) => {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const p = sh.protect().setDescription('打刻生データ（直接編集注意）');
    p.setWarningOnly(true);   // 警告のみ。完全ロックにするなら削除
  });
  Logger.log('生データシート保護完了');
}