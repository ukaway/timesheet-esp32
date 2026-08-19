// ===========================================================================
// 退勤漏れの日次チェック → 本人Gmailへ通知
// ===========================================================================
function dailyCheckMissingClockout() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  Object.keys(STAFF).forEach(staffId => {
    const { name, email } = STAFF[staffId];
    const sh = ss.getSheetByName(name);
    if (!sh) return;

    const data = sh.getDataRange().getValues();
    const todayRows = [];
    for (let i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      const day = Utilities.formatDate(new Date(data[i][0]), tz, 'yyyy-MM-dd');
      if (day === today) todayRows.push(data[i]);
    }
    if (todayRows.length === 0) return;                       // 当日出勤なし
    if (todayRows[todayRows.length - 1][2] !== 'in') return;  // 退勤済み
    if (!email) return;

    const firstIn = todayRows.find(r => r[2] === 'in');
    const inTime = firstIn
      ? Utilities.formatDate(new Date(firstIn[0]), tz, 'HH:mm') : '不明';

    MailApp.sendEmail({
      to: email,
      subject: `【勤怠】${today} の退勤打刻がありません`,
      body:
        `${name} さん\n\n` +
        `${today} は ${inTime} に出勤打刻がありますが、退勤打刻が記録されていません。\n` +
        `下記フォームから退勤を追加申請してください。\n\n` +
        `  職員: ${name}\n` +
        `  対象日時: ${today} 18:00:00（実際の退勤時刻に変更）\n` +
        `  区分: 退勤\n` +
        `  操作: 追加\n\n` +
        `${CONFIG.FORM_URL}\n\n` +
        `※ このメールは自動送信です。`,
    });
    Logger.log(`退勤漏れ通知: ${name} <${email}>`);
  });
}