// 分 → "H:MM" 表記
function fmtMin_(min) {
  min = Math.round(min);
  const h = Math.floor(min / 60), m = min % 60;
  return `${h}:${('0' + m).slice(-2)}`;
}

function calcOvertimeBreakdown_(workMin) {
  const scheduledMin = 7 * 60 + 30;
  const statutoryMin = 8 * 60;
  return {
    legalOtM: Math.max(0, Math.min(workMin, statutoryMin) - scheduledMin),
    statutoryOtM: Math.max(0, workMin - statutoryMin)
  };
}

// ===========================================================================
// ヘルパー
// ===========================================================================
function getOrCreateLogSheet_(ss) {
  let sh = ss.getSheetByName(CONFIG.LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.LOG_SHEET);
    sh.appendRow(['日時', 'staff_id', '職員', '区分']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function getOrCreateStatusSheet_(ss) {
  let sh = ss.getSheetByName(CONFIG.STATUS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.STATUS_SHEET);
    sh.appendRow(['staff_id', '職員', 'status', 'lastTime', 'lastDate']);
    sh.setFrozenRows(1);
  }
  syncStatusStaffRows_(sh);
  return sh;
}

function syncStatusStaffRows_(sh) {
  const values = sh.getDataRange().getValues();
  const rowByStaffId = {};
  for (let i = 1; i < values.length; i++) {
    const staffId = String(values[i][0] || '').trim();
    if (staffId) rowByStaffId[staffId] = i + 1;
  }

  const rowsToAppend = [];
  Object.keys(STAFF).forEach(staffId => {
    if (!rowByStaffId[staffId]) {
      rowsToAppend.push([staffId, STAFF[staffId].name, 'out', '', '']);
    }
  });
  if (rowsToAppend.length > 0) {
    sh.getRange(sh.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length)
      .setValues(rowsToAppend);
  }
}

function getStatusRow_(sh, staffId) {
  const values = sh.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === staffId) {
      return { row: i + 1, values: values[i] };
    }
  }
  sh.appendRow([staffId, STAFF[staffId].name, 'out', '', '']);
  return { row: sh.getLastRow(), values: [staffId, STAFF[staffId].name, 'out', '', ''] };
}

function rebuildStatusSheetFromLog_(ss, tz) {
  const logSh = getOrCreateLogSheet_(ss);
  const statusSh = getOrCreateStatusSheet_(ss);
  const logRows = logSh.getDataRange().getValues();
  const latestByStaffId = {};

  for (let i = 1; i < logRows.length; i++) {
    const t = logRows[i][0] ? new Date(logRows[i][0]) : null;
    const staffId = String(logRows[i][1] || '').trim();
    const kind = String(logRows[i][3] || '').trim();
    if (!t || isNaN(t.getTime()) || !STAFF[staffId] || !kind) continue;
    if (!latestByStaffId[staffId] || t > latestByStaffId[staffId].time) {
      latestByStaffId[staffId] = { time: t, kind: kind };
    }
  }

  const rows = Object.keys(STAFF).map(staffId => {
    const latest = latestByStaffId[staffId];
    if (!latest) return [staffId, STAFF[staffId].name, 'out', '', ''];

    return [
      staffId,
      STAFF[staffId].name,
      latest.kind,
      Utilities.formatDate(latest.time, tz, 'yyyy-MM-dd HH:mm:ss'),
      Utilities.formatDate(latest.time, tz, 'yyyy-MM-dd')
    ];
  });

  if (statusSh.getLastRow() > 1) {
    statusSh.getRange(2, 1, statusSh.getLastRow() - 1, 5).clearContent();
  }
  if (rows.length > 0) {
    statusSh.getRange(2, 1, rows.length, 5).setValues(rows);
  }
}

function markState_(sheet, rowIndex0, text) {
  sheet.getRange(rowIndex0 + 1, CONFIG.STATE_COL).setValue(text);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
