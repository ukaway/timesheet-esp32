// ===========================================================================
/**
 * 勤怠サマリ生成（別スプレッドシート出力可）
 * 生データ各職員タブ [日時, staff_id, in/out] → 日次サマリ表を書き出す。
 *
 * 列: A日付 B曜日 C勤務 D出勤 E退勤 F休憩 G残業 H実働 | I〜(I+47) 8:00-20:00の15分帯
 */

// ===== サマリ設定 =====
const SUMMARY = {
  OUTPUT_SS_ID: getScriptProp_('KINTAI_SUMMARY_OUTPUT_SS_ID', ''), // 別ブックに出すならそのID。空なら同一ブック
  GRAPH_START_HOUR: 8,       // 帯の開始時刻
  GRAPH_END_HOUR: 20,        // 帯の終了時刻
  SLOT_MIN: 10,              // 帯の粒度（分）
  OVERTIME_AFTER: 18,        // 所定終業（時）। これ以降の実働を残業
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

  Object.keys(STAFF).forEach(staffId => {
    const name = STAFF[staffId].name;
    const src = srcSs.getSheetByName(name);
    if (!src) return;
    buildSummaryForStaff_(src, outSs, name + '_勤怠', tz);
  });
}

/**
 * 1職員分のサマリを outSheetName に書き出す。
 */
function buildSummaryForStaff_(srcSheet, outSs, outSheetName, tz) {
  const raw = srcSheet.getDataRange().getValues();

  const events = {};
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SUMMARY.DAYS_BACK);
  for (let i = 1; i < raw.length; i++) {
    if (!raw[i][0]) continue;
    const t = new Date(raw[i][0]);
    if (isNaN(t.getTime()) || t < cutoff) continue;
    const dateStr = Utilities.formatDate(t, tz, 'yyyy-MM-dd');
    (events[dateStr] = events[dateStr] || []).push({ t: t, kind: raw[i][2] });
  }

  const dates = Object.keys(events).sort();
  const slotCount = (SUMMARY.GRAPH_END_HOUR - SUMMARY.GRAPH_START_HOUR)
                    * 60 / SUMMARY.SLOT_MIN;                 // 144
  const BASE_COL = 9;                                        // 帯開始列(I)

  // ヘッダ（正時のみラベル）
  const header = ['日付', '曜日', '勤務', '出勤', '退勤', '休憩', '残業', '実働'];
  for (let s = 0; s < slotCount; s++) {
    const mins = SUMMARY.GRAPH_START_HOUR * 60 + s * SUMMARY.SLOT_MIN;
    header.push((mins % 60 === 0) ? `${mins / 60}` : '');
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
    40, // 残業
    40  // 実働
  ].forEach((width, i) => {
    out.setColumnWidth(i + 1, width);
  });

  out.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  out.setFrozenRows(1);
  out.setFrozenColumns(3);

  const slotsPerHour = 60 / SUMMARY.SLOT_MIN;          // 5分刻み → 12
  const hours = SUMMARY.GRAPH_END_HOUR - SUMMARY.GRAPH_START_HOUR; // 12
  for (let h = 0; h < hours; h++) {
    const c1 = BASE_COL + h * slotsPerHour;            // その時間帯の先頭列
    const hourRange = out.getRange(1, c1, 1, slotsPerHour);
    hourRange.merge()
             .setHorizontalAlignment('left')
            //  .setBorder(true, true, true, true, false, false); // 時間帯の枠線
  }

  const dataRows = [];
  const intervalsByRow = [];        // 各行の在室区間を後で結合描画に使う

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

    const otTh = new Date(firstIn);
    otTh.setHours(SUMMARY.OVERTIME_AFTER, 0, 0, 0);
    let otMin = 0;
    intervals.forEach(([a, b]) => {
      const end = b || new Date();
      const s = Math.max(a.getTime(), otTh.getTime());
      if (end.getTime() > s) otMin += (end.getTime() - s) / 60000;
    });

    const dObj = new Date(dateStr + 'T00:00:00');
    dataRows.push([
      dateStr, WEEK_JP[dObj.getDay()], true,
      Utilities.formatDate(firstIn, tz, 'HH:mm'),
      stillIn ? '勤務中' : Utilities.formatDate(lastOut, tz, 'HH:mm'),
      fmtMin_(breakMin),
      otMin > 0 ? fmtMin_(otMin) : '',
      fmtMin_(workMin),
    ]);
    intervalsByRow.push({ dateStr: dateStr, intervals: intervals });
  });

  if (dataRows.length === 0) return;

  // A〜H列の値を一括書き込み
  out.getRange(2, 1, dataRows.length, 8).setValues(dataRows);

  // A〜H列の値を左揃え
  out.getRange(1, 1, dataRows.length + 1, 8).setHorizontalAlignment('left');

  // 帯列を細く
  out.setColumnWidths(BASE_COL, slotCount, 8);

  // 各行に結合バーを描画
  intervalsByRow.forEach((info, idx) => {
    const rowIndex = 2 + idx;
    drawGanttBar_(out, rowIndex, BASE_COL, info.intervals, info.dateStr, slotCount);
  });
}

/**
 * 在室区間ごとにセルを結合して連続バーを描く（5分粒度）。
 */
function drawGanttBar_(out, rowIndex, baseCol, intervals, dateStr, slotCount) {
  const startMin = SUMMARY.GRAPH_START_HOUR * 60;
  const slotMin = SUMMARY.SLOT_MIN;
  const dayStart = new Date(dateStr + 'T00:00:00');

  intervals.forEach(([a, b]) => {
    const end = b || new Date();
    const aMin = (a - dayStart) / 60000;
    const eMin = (end - dayStart) / 60000;
    const fromSlot = Math.max(0, Math.floor((aMin - startMin) / slotMin));
    const toSlot   = Math.min(slotCount, Math.ceil((eMin - startMin) / slotMin));
    if (toSlot <= fromSlot) return;

    const range = out.getRange(rowIndex, baseCol + fromSlot, 1, toSlot - fromSlot);
    range.setBackground('#4a90d9');
    if (toSlot - fromSlot > 1) range.merge();
  });
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