# GAS Script Properties

Apps Script の「プロジェクトの設定 > スクリプト プロパティ」に設定する値です。
このファイルには実値を書かないでください。

```text
KINTAI_TOKEN=ESP32から送る打刻トークン
KINTAI_FORM_URL=https://docs.google.com/forms/d/e/.../viewform
KINTAI_ADMIN_EMAILS=admin1@example.com,admin2@example.com
KINTAI_SUMMARY_OUTPUT_SS_ID=別スプレッドシートにサマリ出力する場合のID
KINTAI_LATE_EARLY_GRACE_MIN=10
```

職員名はJSON文字列で入れます。GitHubには実名を書かず、このプロパティで管理します。

```json
{
  "staff1": "職員名1",
  "staff2": "職員名2",
  "staff3": "職員名3",
  "staff4": "職員名4",
  "staff5": "職員名5",
  "staff6": "職員名6",
  "staff7": "職員名7",
  "staff8": "職員名8"
}
```

上のJSONを1行にして、`KINTAI_STAFF_NAMES_JSON` の値に貼ります。

職員メールはJSON文字列で入れます。

```json
{
  "staff1": "doctor@example.com",
  "staff2": "nurse-a@example.com",
  "staff3": "nurse-b@example.com",
  "staff4": "reception-a@example.com",
  "staff5": "reception-b@example.com",
  "staff6": "lab@example.com",
  "staff7": "office-a@example.com",
  "staff8": "office-b@example.com"
}
```

上のJSONを1行にして、`KINTAI_STAFF_EMAILS_JSON` の値に貼ります。

働き方は `KINTAI_STAFF_WORK_STYLES_JSON` で職員IDごとに指定します。未指定の職員は `normal_full_time` です。

```json
{
  "staff1": "normal_full_time",
  "staff2": "normal_full_time",
  "staff3": "early_full_time",
  "staff4": "hourly_part_time"
}
```

上のJSONを1行にして、`KINTAI_STAFF_WORK_STYLES_JSON` の値に貼ります。

標準で使える働き方は次の3つです。

```text
normal_full_time
  平日 08:30-13:00, 14:00-17:00
  土曜 08:30-13:00, 14:00-16:00

early_full_time
  平日 07:00-12:30, 14:30-17:00
  土曜 07:00-12:30, 14:30-16:00

hourly_part_time
  平日/土曜 09:00-13:00, 14:00-15:00
```

働き方テンプレート自体を変更・追加したい場合は `KINTAI_WORK_STYLES_JSON` にJSONを入れます。指定したIDだけ標準設定を上書きします。

```json
{
  "short_part_time": {
    "type": "hourly",
    "schedule": {
      "weekday": [["09:00", "13:00"]],
      "saturday": [["09:00", "12:00"]]
    }
  }
}
```

上のJSONを1行にして、`KINTAI_WORK_STYLES_JSON` の値に貼ります。
