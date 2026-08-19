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
    const sh = getOrCreateStaffSheet_(ss, STAFF[staffId].name);

    const now = new Date();
    const today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    const data = sh.getDataRange().getValues(); // [日時, staff_id, 区分]

    // 連打ロックアウト（このシートの最終行）
    if (data.length > 1) {
      const last = data[data.length - 1];
      if (last[0] && (now - new Date(last[0])) < CONFIG.LOCKOUT_MS) {
        return json_({ ok: true, kind: 'duplicate' });
      }
    }

    // 当日の最終区分を見てトグル（日跨ぎで自動的に in から再開）
    let lastKind = null;
    for (let i = data.length - 1; i >= 1; i--) {
      if (!data[i][0]) continue;
      const day = Utilities.formatDate(new Date(data[i][0]), tz, 'yyyy-MM-dd');
      if (day !== today) break;
      lastKind = data[i][2];
      break;
    }
    const kind = (lastKind === 'in') ? 'out' : 'in';

    sh.appendRow([Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm:ss'),
                  staffId, kind]);
    return json_({ ok: true, kind: kind });

  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}