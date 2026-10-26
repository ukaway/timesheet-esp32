# 勤怠管理システム（ESP32 + Google Apps Script）

クリニックのスタッフ8名向けの、サーバー不要の勤怠打刻システムです。壁掛けのESP32ボタンパネルからGoogle Apps Script（GAS）のWebアプリへHTTPS POSTし、Googleスプレッドシートへ打刻を記録します。

カードリーダーや顔認証を使わず、1人1ボタンで出勤・退勤を切り替えるシンプルな構成です。

## 構成

```text
[ESP32 8ボタンパネル]
  └─ HTTPS POST
      └─ [GAS Webアプリ doPost]
          └─ [Googleスプレッドシート 打刻ログ + 現在状態]

[ブラウザ]
  └─ [GAS Webアプリ doGet]
      └─ 勤怠閲覧画面

[Googleフォーム]
  └─ 修正申請
      └─ [GAS onFormSubmit / applyEdits]
          └─ 生データへ反映
```

## リポジトリ構成

```text
firmware/kintai/   ESP32 / Arduino スケッチ
gas/               Google Apps Script 本体
  00_Config.js         設定・職員マスタ・スクリプトプロパティ
  10_Post.js           ESP32からの打刻POST
  20_SummaryOutput.js  スプレッドシート向けサマリ出力
  30_WebApp.js         Webアプリ入口・表示データ生成
  31_WebRender.js      勤怠閲覧画面HTML
  40_FormEdits.js      Googleフォーム修正申請の反映
  50_Notifications.js  退勤漏れ通知
  60_Setup.js          トリガー・シート保護
  90_Utils.js          共通ヘルパー
docs/              セットアップ用メモ
```

GASへ反映されるのは `gas/` 配下の対象ファイルだけです。

```bash
npm run gas:status
npm run gas:push
npm run gas:open
```

## 必要なもの

- ESP32開発ボード
- タクトスイッチ 8個
- ジャンパーワイヤー、ブレッドボード、USBケーブル
- Arduino IDE 2.x
- Googleアカウント
- Googleスプレッドシート
- Google Apps Script
- Googleフォーム（打刻修正申請用）
- Node.js / npm（claspでGASを管理するため）

## GASセットアップ

1. Googleスプレッドシートを作成し、タイムゾーンを `Asia/Tokyo` にする
2. Apps Scriptプロジェクトを作成する
3. `clasp login` 済みの環境で、このリポジトリからGASへpushする
4. GASのスクリプトプロパティを設定する
5. `setupTriggers()` を手動実行して権限承認する
6. `setupDataSheets()` を手動実行して `打刻ログ` / `現在状態` を作成する
7. 既存の職員別シートから移行する場合は `migrateStaffSheetsToLog()` を1回だけ手動実行する
8. `protectAllStaffSheets()` を必要に応じて手動実行する
9. Webアプリとしてデプロイする
10. 発行された `/exec` URLをESP32側の `GAS_URL` に設定する

スクリプトプロパティの例は以下を参照してください。

[docs/SecretProperties.example.md](docs/SecretProperties.example.md)

## スクリプトプロパティ

GASの「プロジェクトの設定 > スクリプト プロパティ」に以下を設定します。実値はGitHubに置きません。

```text
KINTAI_TOKEN
KINTAI_FORM_URL
KINTAI_ADMIN_EMAILS
KINTAI_SUMMARY_OUTPUT_SS_ID
KINTAI_STAFF_NAMES_JSON
KINTAI_STAFF_EMAILS_JSON
KINTAI_STAFF_WORK_STYLES_JSON
KINTAI_WORK_STYLES_JSON
KINTAI_LATE_EARLY_GRACE_MIN
```

`KINTAI_STAFF_NAMES_JSON` は職員IDと表示名の対応をJSONで持ちます。

```json
{"staff1":"職員名1","staff2":"職員名2"}
```

`KINTAI_STAFF_EMAILS_JSON` は職員IDとメールアドレスの対応をJSONで持ちます。

```json
{"staff1":"doctor@example.com","staff2":"nurse-a@example.com"}
```

`KINTAI_STAFF_WORK_STYLES_JSON` は職員IDと働き方IDの対応をJSONで持ちます。未指定の職員は `normal_full_time` です。

```json
{"staff1":"normal_full_time","staff2":"early_full_time","staff3":"hourly_part_time"}
```

## ESP32セットアップ

Arduino IDEで `firmware/kintai/kintai.ino` を開きます。Arduino IDEの仕様上、スケッチファイル名とフォルダ名を揃えるため、現在は `firmware/kintai/` に置いています。

ローカルの秘密情報は `secrets.h` に入れます。

```bash
cp firmware/kintai/secrets.example.h firmware/kintai/secrets.h
```

`secrets.h` に以下を設定します。

```cpp
const char* WIFI_SSID = "...";
const char* WIFI_PASS = "...";
const char* GAS_URL   = "https://script.google.com/macros/s/.../exec";
const char* TOKEN     = "GASのKINTAI_TOKENと同じ値";
```

`secrets.h` は `.gitignore` 済みです。

## 打刻方式

1ボタンで出勤・退勤を兼ねる自動トグル方式です。

- `現在状態` の `lastDate` が今日でなければ `in`
- `lastDate` が今日で、現在状態が `in` なら次は `out`
- `lastDate` が今日で、現在状態が `out` なら次は `in`
- 連打対策としてGAS側にロックアウト時間を設ける

打刻履歴は `打刻ログ` へ1行ずつ残し、IN/OUT判定とWeb表示の現在状態は `現在状態` の対象スタッフ行だけを見ます。

## 閲覧画面

WebアプリURLをブラウザで開くと `doGet` が動き、ログイン中Googleアカウントに対応する職員の勤怠を表示します。

- 月切替
- 昇順/降順切替
- 管理者の職員切替
- スタッフIN/OUT一覧表示

画面操作は `google.script.run` でGAS関数を呼び、ページ全体をリロードせずに表を更新します。

## Googleフォーム修正申請

修正はGoogleフォームから申請し、GASの `onFormSubmit()` / `applyEdits()` で生データに反映します。

想定する質問順:

```text
職員
対象日時
区分（出勤 / 退勤）
操作（追加 / 削除）
```

フォームはメールアドレス収集をONにします。管理者以外は本人の打刻だけ修正できるようにしています。

## 開発

GASの状態確認:

```bash
npm run gas:status
```

GASへ反映:

```bash
npm run gas:push
```

GASエディタを開く:

```bash
npm run gas:open
```

構文チェックの目安:

```bash
for f in gas/[0-9]*.js; do node --check "$f" || exit 1; done
```

## 注意点

- GASにデプロイしたWebアプリは、コードをpushしただけでは公開中バージョンに反映されないことがあります。必要に応じて「デプロイを管理 > 編集 > バージョンを新規作成 > デプロイ」を行います。
- GASのスクリプトプロパティはGitHubには出ませんが、GASプロジェクトの編集権限を持つ人には見えます。
- ESP32は2.4GHz Wi-Fiに接続します。
- USBケーブルはデータ通信対応のものを使います。
- 常設する場合、ブレッドボードは接触不良が起きやすいため、ユニバーサル基板などへの移行を推奨します。

## 任意期間の勤怠ブック保存

初回はGASエディタから `setupAttendanceExportSettings` を実行します（入力ダイアログ不要）。
元のスプレッドシートに「出力設定」シートを自動作成します。再実行しても入力済みの値は上書きしません。

1. 「出力設定」の **B2に開始日、B3に終了日** を `yyyy/mm/dd` で入力します（例: `2026/09/21` ～ `2026/10/20`）。
2. 登録済み管理者でGAS関数 **`exportAttendanceBookFromSettings`** を実行します。
3. 作成したブックのURLが「出力設定」の **B7** と実行ログに表示されます。

スプレッドシートを開き直すと、メニュー **勤怠出力 → 出力設定シートを作成・開く / 設定した期間でブック保存** からも操作できます。
スクリプトプロパティに開始日・終了日を追加する必要はありません。
両端の日付を含む全職員分を、新しいGoogleスプレッドシートへ1人1シートで保存し、保存先URLを表示します。
GASから直接実行する場合は `exportAttendanceBook('2026/09/21', '2026/10/20')` を呼びます。

各シートはグラフなしの日別記録と、先頭の総労働時間・総所定外労働（時間外を除く）・総時間外労働・総遅刻早退・総出勤日数・所定日数・休み・全員休みの日数を含みます。
誰か1人でも出勤記録がある日を全員共通の所定日とし、その日に本人の出勤がなければ「休み」とします。
全員に出勤記録がない日は「全員休み」です。休みは有休・欠勤等の区別をしません。
時間の計算は既存の勤務形態・勤怠ルールを使用し、未退勤日は要確認として時間合計から除外します（出勤日数には含む）。

セルは編集可能で、合計は数式です。日別の休憩・遅刻早退・所定外・時間外・実働は数値の時間として保存し、24時間を超える合計も `[h]:mm` で表示します。
出退勤を編集した場合、日別の計算結果も手動で修正してください。合計はF〜L列の値を参照し、出退勤から日別時間を再計算するものではありません。
所定日・出勤日のK/L列は該当日を1、非該当日を0で編集できます。
保存のたびに別ブックを作るため、過去に編集した保存ブックは上書きしません。保存先は実行ユーザーのGoogleドライブです。
初回実行時には新規スプレッドシート作成の認可が必要です。

ローカル検証: `node --test tests/period-export.test.cjs`

接続設定 `.clasp.json` はGit管理外です。新規環境では `.clasp.example.json` を `.clasp.json` にコピーし、実際の `scriptId` を設定してください。

先頭の総所定外労働は、日別の所定外労働合計から時間外労働合計を差し引きます。日別表の所定外労働・時間外労働は従来どおりです。

先頭の時間集計は `[h]:mm` に加え、小数第2位までの時間（h）も併記します（例: `7:30` → `7.50 h`）。小数の時間は同じ合計セルを参照する数式です。出力シートは1〜10行のみ固定し、列は固定せず、A〜L列の幅を内容に合わせて自動調整します。

`hourly_part_time`（type: `hourly`）は所定時間なしとして扱います。既存設定に勤務区間が残っていても無視し、遅刻早退は計上しません。実働8時間以内の所定外・時間外は0、8時間超の分を日別の所定外・時間外の両方に表示します。上部の総所定外（時間外を除く）は0です。時給制は休憩不足分を時間外判定の実働に加算しません。
