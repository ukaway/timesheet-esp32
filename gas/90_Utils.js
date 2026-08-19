// 分 → "H:MM" 表記
function fmtMin_(min) {
  min = Math.round(min);
  const h = Math.floor(min / 60), m = min % 60;
  return `${h}:${('0' + m).slice(-2)}`;
}

// ===========================================================================
// ヘルパー
// ===========================================================================
function getOrCreateStaffSheet_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(['日時', 'staff_id', '区分']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function markState_(sheet, rowIndex0, text) {
  sheet.getRange(rowIndex0 + 1, CONFIG.STATE_COL).setValue(text);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}