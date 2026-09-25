// 分 → "H:MM" 表記
function fmtMin_(min) {
  min = Math.round(min);
  const h = Math.floor(min / 60), m = min % 60;
  return `${h}:${('0' + m).slice(-2)}`;
}

function fmtSignedMin_(min) {
  min = Math.round(min);
  if (min === 0) return '0:00';
  return (min < 0 ? '-' : '') + fmtMin_(Math.abs(min));
}

function requiredLegalBreakMin_(workMin) {
  if (workMin > 8 * 60) return 60;
  if (workMin > 6 * 60) return 45;
  return 0;
}

function getWorkStyleForStaff_(staffId) {
  const styleId = STAFF[staffId] && STAFF[staffId].workStyleId
    ? STAFF[staffId].workStyleId
    : 'normal_full_time';
  return WORK_STYLES[styleId] || WORK_STYLES.normal_full_time;
}

function getDayKind_(dateStr) {
  const dow = new Date(dateStr + 'T00:00:00').getDay();
  if (dow === 0) return 'sunday';
  if (dow === 6) return 'saturday';
  return 'weekday';
}

function parseTimeMin_(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function getScheduledSegments_(staffId, dateStr) {
  const style = getWorkStyleForStaff_(staffId);
  const schedule = style.schedule || {};
  const dayKind = getDayKind_(dateStr);
  const source = schedule[dayKind] || [];
  return source.map(pair => {
    return [parseTimeMin_(pair[0]), parseTimeMin_(pair[1])];
  }).filter(pair => pair[0] != null && pair[1] != null && pair[1] > pair[0]);
}

function sumSegmentsMin_(segments) {
  return segments.reduce((sum, pair) => sum + pair[1] - pair[0], 0);
}

function dateAtMinute_(dateStr, minute) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMinutes(minute);
  return d;
}

function calcOverlapMin_(intervals, dateStr, segments) {
  let total = 0;
  intervals.forEach(([start, end]) => {
    const finish = end || new Date();
    segments.forEach(([segStartM, segEndM]) => {
      const segStart = dateAtMinute_(dateStr, segStartM);
      const segEnd = dateAtMinute_(dateStr, segEndM);
      const overlapStart = Math.max(start.getTime(), segStart.getTime());
      const overlapEnd = Math.min(finish.getTime(), segEnd.getTime());
      if (overlapEnd > overlapStart) total += (overlapEnd - overlapStart) / 60000;
    });
  });
  return total;
}

function calcBeforeFirstScheduledMin_(intervals, dateStr, segments) {
  if (segments.length === 0) return 0;
  const firstStartM = segments.reduce((min, pair) => Math.min(min, pair[0]), segments[0][0]);
  return calcOverlapMin_(intervals, dateStr, [[0, firstStartM]]);
}

function calcAfterScheduledSpanMin_(intervals, dateStr, span) {
  if (!span) return 0;
  return calcOverlapMin_(intervals, dateStr, [[span[1], 24 * 60]]);
}

function getScheduledSpan_(segments) {
  if (segments.length === 0) return null;
  return segments.reduce((span, pair) => {
    return [
      Math.min(span[0], pair[0]),
      Math.max(span[1], pair[1])
    ];
  }, [segments[0][0], segments[0][1]]);
}

function calcAttendanceMetrics_(staffId, dateStr, intervals, workMin, breakMin) {
  const style = getWorkStyleForStaff_(staffId);
  const scheduledSegments = getScheduledSegments_(staffId, dateStr);
  const scheduledMin = sumSegmentsMin_(scheduledSegments);
  const scheduledSpan = getScheduledSpan_(scheduledSegments);
  const scheduledSpanMin = scheduledSpan ? scheduledSpan[1] - scheduledSpan[0] : 0;
  const scheduledWorkMin = scheduledSpan
    ? calcOverlapMin_(intervals, dateStr, [scheduledSpan])
    : 0;
  const earlyBeforeScheduleM = calcBeforeFirstScheduledMin_(intervals, dateStr, scheduledSegments);
  const afterScheduledSpanM = calcAfterScheduledSpanMin_(intervals, dateStr, scheduledSpan);
  const scheduledBreakM = Math.max(0, scheduledSpanMin - scheduledMin);
  const actualBreakInScheduledSpanM = Math.max(0, scheduledSpanMin - scheduledWorkMin);
  const shortBreakM = Math.max(0, scheduledBreakM - actualBreakInScheduledSpanM);
  const overtimeBaseM = workMin;
  const requiredLegalBreakM = requiredLegalBreakMin_(overtimeBaseM);
  const legalBreakShortageM = Math.max(0, requiredLegalBreakM - (breakMin || 0));
  const adjustedWorkM = overtimeBaseM + legalBreakShortageM;
  const shortageMin = Math.max(0, scheduledMin - scheduledWorkMin);
  const lateEarlyM = style.type === 'full_time' &&
      scheduledMin > 0 &&
      shortageMin >= ATTENDANCE_RULES.LATE_EARLY_GRACE_MIN
    ? shortageMin
    : 0;
  const outsideWorkM = earlyBeforeScheduleM + afterScheduledSpanM + shortBreakM;
  const outsideWorkWithLegalBreakM = outsideWorkM + legalBreakShortageM;
  const overScheduledM = Math.max(0, adjustedWorkM - scheduledMin);
  const scheduledOutsideM = scheduledMin > 0
    ? (overScheduledM > 0 ? overScheduledM : outsideWorkWithLegalBreakM)
    : Math.max(0, adjustedWorkM - ATTENDANCE_RULES.LEGAL_DAILY_LIMIT_MIN);
  const statutoryOtM = Math.max(0, adjustedWorkM - ATTENDANCE_RULES.LEGAL_DAILY_LIMIT_MIN);

  return {
    workStyleType: style.type || '',
    scheduledM: scheduledMin,
    scheduledSpanM: scheduledSpanMin,
    scheduledWorkM: scheduledWorkMin,
    earlyBeforeScheduleM: earlyBeforeScheduleM,
    afterScheduledSpanM: afterScheduledSpanM,
    scheduledBreakM: scheduledBreakM,
    actualBreakInScheduledSpanM: actualBreakInScheduledSpanM,
    shortBreakM: shortBreakM,
    requiredLegalBreakM: requiredLegalBreakM,
    legalBreakShortageM: legalBreakShortageM,
    adjustedWorkM: adjustedWorkM,
    outsideWorkM: outsideWorkM,
    outsideWorkWithLegalBreakM: outsideWorkWithLegalBreakM,
    overScheduledM: overScheduledM,
    overtimeBaseM: overtimeBaseM,
    lateEarlyM: lateEarlyM,
    scheduledOutsideM: scheduledOutsideM,
    statutoryOtM: statutoryOtM
  };
}

function toDateKey_(value, tz) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  }

  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const d = new Date(text);
  return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, tz, 'yyyy-MM-dd');
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
  sh.getRange('A:E').setNumberFormat('@');
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
    const row = rowByStaffId[staffId];
    if (row) {
      sh.getRange(row, 2).setValue(STAFF[staffId].name);
    } else {
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
