// ===========================================================================
// 勤怠閲覧画面（Webアプリ GET）
// ===========================================================================
function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const ctx = getViewerContext_(params.staff);
  if (!ctx.ok) return HtmlService.createHtmlOutput(ctx.error);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  const nowMonth = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  const month = isValidMonth_(params.month) ? params.month : nowMonth;
  const order = params.order === 'asc' ? 'asc' : 'desc';
  const view = buildAttendanceView_(ctx.targetId, month, order, tz);

  return HtmlService
    .createHtmlOutput(renderPage_(view, ctx))
    .setTitle('勤怠記録');
}

/**
 * 画面JSから呼ぶ関数。
 * URL遷移せず、表部分だけ差し替えるためのHTMLを返す。
 */
function getAttendanceData(month, order, staffId) {
  const ctx = getViewerContext_(staffId);
  if (!ctx.ok) return { ok: false, error: ctx.errorText || ctx.error };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  const nowMonth = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  const safeMonth = isValidMonth_(month) ? month : nowMonth;
  const safeOrder = order === 'asc' ? 'asc' : 'desc';
  const view = buildAttendanceView_(ctx.targetId, safeMonth, safeOrder, tz);

  return {
    ok: true,
    title: view.name + ' の勤怠 (' + view.month + ')',
    name: view.name,
    month: view.month,
    order: view.order,
    staffId: view.staffId,
    rowsHtml: view.rowsHtml,
    monthOptionsHtml: renderMonthOptions_(view.months, view.month),
    orderLabel: view.order === 'asc' ? '昇順↑' : '降順↓'
  };
}

function getViewerContext_(requestedStaffId) {
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) {
    return {
      ok: false,
      error: 'ログインが必要です。',
      errorText: 'ログインが必要です。'
    };
  }

  let ownStaffId = null;
  for (const id in STAFF) {
    if (STAFF[id].email.toLowerCase() === email) {
      ownStaffId = id;
      break;
    }
  }

  const isAdmin = ADMIN_SET.has(email);
  if (!ownStaffId && !isAdmin) {
    const msg = '勤怠記録が見つかりません。';
    return { ok: false, error: msg, errorText: msg };
  }

  const firstStaffId = Object.keys(STAFF)[0];
  const targetId = isAdmin
    ? (requestedStaffId && STAFF[requestedStaffId] ? requestedStaffId : (ownStaffId || firstStaffId))
    : ownStaffId;

  if (!targetId || !STAFF[targetId]) {
    const msg = 'あなたのアカウント（' + email + '）に対応する勤怠記録が見つかりません。';
    return {
      ok: false,
      error: msg + '<br>管理者にメールアドレスの登録を確認してください。',
      errorText: msg
    };
  }

  return {
    ok: true,
    email: email,
    ownStaffId: ownStaffId,
    targetId: targetId,
    isAdmin: isAdmin,
    staffOptions: getStaffOptions_()
  };
}

function buildAttendanceView_(staffId, month, order, tz) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const staff = STAFF[staffId];
  const sh = ss.getSheetByName(staff.name);
  const summary = sh ? summarizeDaily_(sh, tz, month) : [];

  summary.sort((a, b) => order === 'asc'
    ? a.date.localeCompare(b.date)
    : b.date.localeCompare(a.date));

  const nowMonth = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  const months = sh ? availableMonths_(sh, tz) : [nowMonth];
  if (months.indexOf(month) === -1) months.unshift(month);

  return {
    staffId: staffId,
    name: staff.name,
    month: month,
    order: order,
    months: months,
    rowsHtml: renderRows_(summary)
  };
}

/**
 * 指定月の日次サマリ配列を返す。
 * 返却: [{date, week, inStr, outStr, breakM, legalOtM, statutoryOtM, workM, intervals, stillIn}]
 */
function summarizeDaily_(sh, tz, month) {
  const raw = sh.getDataRange().getValues();
  const events = {};
  for (let i = 1; i < raw.length; i++) {
    if (!raw[i][0]) continue;
    const t = new Date(raw[i][0]);
    if (isNaN(t.getTime())) continue;
    const m = Utilities.formatDate(t, tz, 'yyyy-MM');
    if (m !== month) continue;
    const d = Utilities.formatDate(t, tz, 'yyyy-MM-dd');
    (events[d] = events[d] || []).push({ t: t, kind: raw[i][2] });
  }

  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const result = [];
  Object.keys(events).forEach(dateStr => {
    const evs = events[dateStr].sort((a, b) => a.t - b.t);
    const intervals = [];
    let curIn = null;

    evs.forEach(ev => {
      if (ev.kind === 'in') {
        if (curIn === null) curIn = ev.t;
      } else if (curIn !== null) {
        intervals.push([curIn, ev.t]);
        curIn = null;
      }
    });

    const stillIn = curIn !== null;
    if (stillIn) intervals.push([curIn, null]);
    if (intervals.length === 0) return;

    const firstIn = intervals[0][0];
    const lastOut = stillIn ? null : intervals[intervals.length - 1][1];

    let breakM = 0;
    for (let k = 0; k < intervals.length - 1; k++) {
      const end = intervals[k][1];
      const nextStart = intervals[k + 1][0];
      if (end && nextStart) breakM += (nextStart - end) / 60000;
    }

    let workM = 0;
    intervals.forEach(([start, end]) => {
      workM += ((end || new Date()) - start) / 60000;
    });

    const overtime = calcOvertimeBreakdown_(workM);

    result.push({
      date: dateStr,
      week: WEEK[new Date(dateStr + 'T00:00:00').getDay()],
      inStr: Utilities.formatDate(firstIn, tz, 'HH:mm'),
      outStr: stillIn ? '勤務中' : Utilities.formatDate(lastOut, tz, 'HH:mm'),
      breakM: breakM,
      legalOtM: overtime.legalOtM,
      statutoryOtM: overtime.statutoryOtM,
      workM: workM,
      intervals: intervals,
      stillIn: stillIn
    });
  });
  return result;
}

/** データのある月一覧（降順） */
function availableMonths_(sh, tz) {
  const raw = sh.getDataRange().getValues();
  const set = {};
  for (let i = 1; i < raw.length; i++) {
    if (!raw[i][0]) continue;
    const t = new Date(raw[i][0]);
    if (!isNaN(t.getTime())) set[Utilities.formatDate(t, tz, 'yyyy-MM')] = 1;
  }
  return Object.keys(set).sort().reverse();
}
