// ===========================================================================
// 打刻受信（ESP32 → HTTPS POST）
// ===========================================================================
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);

    if (!e || !e.postData || !e.postData.contents) {
      return json_({ ok: false, error: 'no body' });
    }
    let body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (_) {
      return json_({ ok: false, error: 'bad json' });
    }

    if (!CONFIG.TOKEN) {
      return json_({ ok: false, error: 'server token not configured' });
    }
    if (body.token !== CONFIG.TOKEN) {
      return json_({ ok: false, error: 'unauthorized' });
    }
    const staffId = String(body.staff_id || '').trim();
    if (!STAFF[staffId]) {
      return json_({ ok: false, error: 'unknown staff' });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tz = ss.getSpreadsheetTimeZone();
    const logSh = getOrCreateLogSheet_(ss);
    const statusSh = getOrCreateStatusSheet_(ss);

    const now = new Date();
    const today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    const nowStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm:ss');
    const state = getStatusRow_(statusSh, staffId);
    const lastTime = state.values[3] ? new Date(state.values[3]) : null;

    // 連打ロックアウト（この職員の最新状態だけを見る）
    if (lastTime && !isNaN(lastTime.getTime()) && (now - lastTime) < CONFIG.LOCKOUT_MS) {
      return json_({ ok: true, kind: 'duplicate', status: state.values[2] || 'out' });
    }

    // 日が変わっていたら必ず in。当日中は現在状態を反転する。
    const lastDate = String(state.values[4] || '');
    const lastStatus = String(state.values[2] || 'out');
    const kind = (lastDate === today && lastStatus === 'in') ? 'out' : 'in';

    logSh.appendRow([nowStr, staffId, STAFF[staffId].name, kind]);
    statusSh.getRange(state.row, 1, 1, 5)
      .setValues([[staffId, STAFF[staffId].name, kind, nowStr, today]]);
    return json_({ ok: true, kind: kind, status: kind });

  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
