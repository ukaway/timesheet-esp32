/**
 * 鵜川医院 勤怠システム — Google Apps Script（サーバー不要）
 *
 * 構成:
 *   ESP32(8ボタン) --HTTPS POST--> doPost --> 打刻ログに追記 + 現在状態を更新
 *   修正はGoogleフォーム(メール収集ON) --> onFormSubmit --> applyEdits --> 生データ反映
 *   退勤漏れ日次チェック --> 本人Gmailへフォーム申請を案内
 *
 * セットアップ手順:
 *   1. スプレッドシートのTZをJSTに設定（ファイル > 設定）
 *   2. フォームを作成し「メールアドレスを収集」ON、回答先を本ブックに
 *      質問順: 職員(プルダウン) / 対象日時(記述) / 区分(出勤,退勤) / 操作(追加,削除)
 *   3. スクリプト プロパティに TOKEN / メール / URL / 出力先IDを設定
 *   4. setupTriggers() を手動実行（権限承認）
 *   5. protectAllStaffSheets() を手動実行
 *   6. デプロイ > 新しいデプロイ > ウェブアプリ
 *        アクセス: 全員 / 実行: 自分
 *      発行された /exec URL を ESP32 の GAS_URL に設定
 */

// ===========================================================================
// 設定
// ===========================================================================
function getScriptProp_(key, fallback) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  return value == null || value === '' ? fallback : value;
}

function getListScriptProp_(key) {
  const value = getScriptProp_(key, '');
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map(v => String(v).trim()).filter(Boolean);
    }
  } catch (_) {
    // カンマ区切りも許容する。
  }
  return value.split(',').map(v => v.trim()).filter(Boolean);
}

function getJsonScriptProp_(key, fallback) {
  const value = getScriptProp_(key, '');
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    throw new Error('Script property ' + key + ' is not valid JSON: ' + err);
  }
}

const CONFIG = {
  TOKEN: getScriptProp_('KINTAI_TOKEN', ''), // ESP32と一致させる打刻用トークン
  LOCKOUT_MS: 10000,                  // 連打ロックアウト（ミリ秒）
  LOG_SHEET: '打刻ログ',               // 全職員の打刻履歴
  STATUS_SHEET: '現在状態',            // IN/OUT判定とWeb表示用の最新状態
  FORM_TAB: 'フォームの回答 1',        // フォーム回答タブ名（実際の名前に合わせる）
  STATE_COL: 7,                       // 回答タブ 状態列（G列 = 7）
  DAILY_HOUR: 23,                     // 退勤漏れチェック実行時刻（時）
  DAILY_MIN: 55,                      // 同（分）
  FORM_URL: getScriptProp_('KINTAI_FORM_URL', ''), // 申請フォームURL
  ADMIN_EMAILS: getListScriptProp_('KINTAI_ADMIN_EMAILS'), // 管理者（申請許可＆本人性チェック除外）
};

// 職員名マスタ: staff_id -> name(=タブ名)
const STAFF_NAMES = {
  staff1: '院長',
  staff2: '看護A',
  staff3: '看護B',
  staff4: '受付A',
  staff5: '受付B',
  staff6: '検査技師',
  staff7: '事務A',
  staff8: '事務B',
};

// 職員メールはスクリプト プロパティ KINTAI_STAFF_EMAILS_JSON に置く。
const STAFF_EMAILS = getJsonScriptProp_('KINTAI_STAFF_EMAILS_JSON', {});

// 職員マスタ: staff_id -> { name(=タブ名), email }
const STAFF = Object.keys(STAFF_NAMES).reduce((m, id) => {
  m[id] = {
    name: STAFF_NAMES[id],
    email: String(STAFF_EMAILS[id] || '').trim()
  };
  return m;
}, {});

// フォーム回答の列インデックス（0基点、メール収集ON時の標準並び）
// A:タイムスタンプ B:メール C:職員 D:対象日時 E:区分 F:操作 G:状態
const COL = { TS: 0, EMAIL: 1, NAME: 2, DATETIME: 3, KIND: 4, OP: 5 };

// ラベル→内部値の変換
const KIND_MAP = { '出勤': 'in', '退勤': 'out' };
const OP_MAP   = { '追加': 'add', '削除': 'delete' };

// 導出テーブル（STAFFから自動生成）
const NAME_TO_ID = Object.keys(STAFF).reduce((m, id) => {
  m[STAFF[id].name] = id; return m;
}, {});
const ALLOWED_EMAILS = new Set(
  Object.values(STAFF).map(s => s.email.toLowerCase()).filter(Boolean)
    .concat(CONFIG.ADMIN_EMAILS.map(e => e.toLowerCase()))
);
const ADMIN_SET = new Set(CONFIG.ADMIN_EMAILS.map(e => e.toLowerCase()));
