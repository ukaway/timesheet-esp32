// ===========================================================================
// 修正申請の反映（Googleフォーム回答 → 生データ）
// ===========================================================================
function onFormSubmit() {
  applyEdits();
}

/**
 * フォーム回答タブを走査し、未処理（状態が空）の申請を生データへ反映する。
 * Google認証で収集した回答者メールをホワイトリスト照合する。
 */
function applyEdits() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tz = ss.getSpreadsheetTimeZone();
    const form = ss.getSheetByName(CONFIG.FORM_TAB);
    if (!form) return;

    const rows = form.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      const state = rows[i][CONFIG.STATE_COL - 1];
      if (state === '済'
          || String(state).indexOf('済:') === 0
          || String(state).indexOf('エラー') === 0
          || String(state).indexOf('却下') === 0) continue;

      // 認証: 回答者メールがホワイトリストにあるか
      const email = String(rows[i][COL.EMAIL]).trim().toLowerCase();
      if (!ALLOWED_EMAILS.has(email)) {
        markState_(form, i, '却下:未許可メール');
        continue;
      }

      const name    = rows[i][COL.NAME];
      const staffId = NAME_TO_ID[name];
      const kind    = KIND_MAP[rows[i][COL.KIND]];
      const op      = OP_MAP[rows[i][COL.OP]];
      const tsRaw   = rows[i][COL.DATETIME];

      if (!staffId) { markState_(form, i, 'エラー:職員不明'); continue; }
      if (!kind)    { markState_(form, i, 'エラー:区分'); continue; }
      if (!op)      { markState_(form, i, 'エラー:操作'); continue; }

      // 本人性チェック: 管理者以外は自分の分のみ申請可
      if (!ADMIN_SET.has(email) && STAFF[staffId].email.toLowerCase() !== email) {
        markState_(form, i, '却下:本人不一致');
        continue;
      }

      const d = new Date(tsRaw);
      if (isNaN(d.getTime())) { markState_(form, i, 'エラー:日時'); continue; }
      const target = Utilities.formatDate(d, tz, 'yyyy-MM-dd HH:mm:ss');

      const sh = getOrCreateLogSheet_(ss);

      if (op === 'add') {
        sh.appendRow([target, staffId, STAFF[staffId].name, kind]);
        markState_(form, i, '済:' + email);
      } else { // delete
        const data = sh.getDataRange().getValues();
        let deleted = false;
        for (let r = data.length - 1; r >= 1; r--) {
          if (!data[r][0]) continue;
          const rowTs = Utilities.formatDate(new Date(data[r][0]), tz, 'yyyy-MM-dd HH:mm:ss');
          if (rowTs === target
              && String(data[r][1] || '').trim() === staffId
              && String(data[r][3] || '').trim() === kind) {
            sh.deleteRow(r + 1);
            deleted = true;
            break;
          }
        }
        markState_(form, i, deleted ? ('済:' + email) : 'エラー:該当無');
      }
      rebuildStatusSheetFromLog_(ss, tz);
    }
  } catch (err) {
    Logger.log('applyEdits失敗: ' + err);
  } finally {
    lock.releaseLock();
  }
}
