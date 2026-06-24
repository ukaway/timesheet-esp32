# 勤怠管理システム（ESP32 + 8ボタン）

クリニックのスタッフ8名向けの、低コスト勤怠打刻システム。
壁掛けのボタンパネルを押すと、Wi-Fi 経由でサーバーに打刻が記録される。
カードリーダーや顔認証を使わず、**1人1ボタン**のシンプルな構成で、最小構成なら部品代 約1,000〜1,500円。

---

## 構成概要

```
[8個のボタンパネル(ESP32)]  ──Wi-Fi(HTTP POST)──>  [サーバー(FastAPI + SQLite)]
   壁掛け・USB給電                                    在室状況をWeb画面で表示
```

- **打刻端末**: ESP32-WROOM。ボタンを押すと、押した職員の識別子をサーバーへ送信。
- **サーバー**: FastAPI。打刻を記録し、各職員の「当日最終打刻」で出勤/退勤をトグル判定。
- **在室表示**: `/presence` ページで「今誰が在室中か」を一覧表示（30秒ごと自動更新）。

### 出勤/退勤の判定方式

1ボタンで出退勤を兼ねる **自動トグル方式**。
その日の最終打刻が出勤(`in`)なら次は退勤(`out`)、という交互判定。サーバー側で処理する。

---

## 必要なもの

### ハードウェア（最小構成）

| 部品 | 数 | 概算 | 必須 |
|---|---|---|---|
| ESP32 開発ボード（Freenove ESP32-WROOM 等） | 1 | 700〜1,300円 | ◎ |
| タクトスイッチ | 8 | 約200円 | ◎ |
| ジャンパーワイヤー | 一式 | 200〜400円 | ◎ |
| ブレッドボード（テスト用） | 1〜2 | 300〜700円 | ◎ |
| USB ケーブル・電源 | 1 | 手持ち可 | ◎ |
| WS2812B LED（状態表示・任意） | 1 | 200〜400円 | △ |
| ユニバーサル基板＋はんだ一式（完成品用） | 一式 | 別途 | △ |

### ソフトウェア

- **Arduino IDE 2.x**（端末ファーム書き込み用）
- **Python 3.x + FastAPI + Uvicorn**（サーバー用）

---

## セットアップ

### 1. Arduino IDE のインストール

公式サイトからダウンロード（2026年時点の最新安定版は 2.3.x 系）:

- Arduino 公式ソフトウェアページ: https://www.arduino.cc/en/software/
- ダウンロード手順（公式ヘルプ）: https://support.arduino.cc/hc/en-us/articles/360019833020-Download-and-install-Arduino-IDE
- リリース一覧（GitHub）: https://github.com/arduino/arduino-ide/releases

OS に合ったインストーラ（Windows: `.exe` / macOS: `.dmg` / Linux: `.AppImage`）を入れる。

### 2. USB ドライバのインストール

本ボードは **CH340** USB-シリアルチップを使用（ボードにより CP2102 の場合あり）。

- Windows: 手動インストールが必要なことが多い。デバイスマネージャーの「ポート(COM と LPT)」に
  `USB-SERIAL CH340 (COMx)` が表示されれば成功。表示されなければ CH340 ドライバを導入。
  - CH340 ドライバ（WCH 公式）: http://www.wch-ic.com/search?t=all&q=ch340
- macOS / Linux: 多くの場合は自動認識。

> **メモ**: データ通信対応の USB ケーブルを使うこと。充電専用ケーブルだと認識しない。

### 3. Arduino IDE に ESP32 ボード定義を追加

1. **File > Preferences**（macOS は **Arduino IDE > Settings**）を開く。
2. 「Additional Board Manager URLs」に以下を追加:
   ```
   https://espressif.github.io/arduino-esp32/package_esp32_index.json
   ```
3. **Tools > Board > Boards Manager** を開き、「esp32」で検索 →
   「ESP32 by Espressif Systems」をインストール。
4. **Tools > Board > ESP32 Arduino > ESP32 Dev Module** を選択。
5. **Tools > Port** で該当 COM ポート（例: COM3）を選択。

### 4. サーバーのセットアップ

```bash
pip install fastapi uvicorn
python kintai.py
```

サーバー起動後、ブラウザで以下にアクセス:

- 打刻ログ / 職員登録: `http://<サーバーIP>:8000/`
- 在室状況: `http://<サーバーIP>:8000/presence`
- 月次 CSV 出力: `http://<サーバーIP>:8000/export?month=YYYY-MM`

---

## 配線

### 基本

- 各ボタン: 片足 → 個別の GPIO、対角の足 → **共通 GND（並列接続）**
- ESP32 内蔵プルアップ（`INPUT_PULLUP`）を使うため、外付け抵抗は不要。
- GND はブレッドボードの「−レール」に集約すると配線が楽。

### GPIO 割り当て（起動制約ピンを回避）

| ボタン | GPIO |
|---|---|
| 1 | 4 |
| 2 | 5 |
| 3 | 13 |
| 4 | 14 |
| 5 | 18 |
| 6 | 19 |
| 7 | 21 |
| 8 | 22 |

> **避けるピン**: GPIO 0, 2, 12, 15（起動時の状態に制約）、GPIO 6〜11（内部フラッシュ用）。

### ブレッドボードの基礎メモ

- 中央エリアは **縦5穴ずつ**が内部接続（`a-b-c-d-e` と `f-g-h-i-j` は溝で分断・別系統）。
- 電源レール（+/−）は **横一列**が接続。中央エリアとは独立（線でつながない限り無関係）。
- IC（ESP32）やスイッチは **溝をまたいで** 挿す（左右の足を絶縁するため）。
- 幅広の ESP32-WROOM はブレッドボード2枚連結＋内側の電源レールを外すと収まりやすい。

---

## ファームウェア（ESP32 / Arduino）

### 動作確認用: 8ボタン読み取りテスト

ボタンを押すと、押した職員名と GPIO 番号をシリアルに出力する。

```cpp
// 8ボタン読み取りテスト
// 各ボタン: 片足→GPIO、対角足→GND(共通)

const int   BUTTON_PINS[8] = {4, 5, 13, 14, 18, 19, 21, 22};
const char* STAFF_NAMES[8] = {
  "院長", "看護A", "看護B", "受付A",
  "受付B", "検査技師", "事務A", "事務B"
};

#define LED_PIN 2

int lastState[8];
unsigned long lastPress[8] = {0};
const unsigned long DEBOUNCE_MS = 200;

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  for (int i = 0; i < 8; i++) {
    pinMode(BUTTON_PINS[i], INPUT_PULLUP);
    lastState[i] = HIGH;
  }
  delay(500);
  Serial.println("=== 8ボタンテスト開始。どれか押してください ===");
}

void loop() {
  unsigned long now = millis();
  for (int i = 0; i < 8; i++) {
    int state = digitalRead(BUTTON_PINS[i]);
    if (lastState[i] == HIGH && state == LOW) {
      if (now - lastPress[i] > DEBOUNCE_MS) {
        lastPress[i] = now;
        Serial.print(">>> 押されました: ");
        Serial.print(STAFF_NAMES[i]);
        Serial.print(" (GPIO");
        Serial.print(BUTTON_PINS[i]);
        Serial.println(")");
        digitalWrite(LED_PIN, HIGH);
        delay(80);
        digitalWrite(LED_PIN, LOW);
      }
    }
    lastState[i] = state;
  }
  delay(10);
}
```

> **次のステップ**: 上記が動作したら、Wi-Fi 接続と HTTP POST 送信を追加して
> サーバーの `/punch` エンドポイントへ打刻を送る（実装予定）。

---

## サーバー（FastAPI / Python）

主要エンドポイント:

- `POST /punch` — 打刻受信（`X-Token` ヘッダで簡易認証、`staff_id` または `idm` を受ける）
- `GET /` — 当日の打刻ログ表示・職員名登録・CSV ダウンロードリンク
- `GET /presence` — 在室状況の一覧（自動更新）
- `GET /export?month=YYYY-MM` — 月次打刻の CSV 出力（Excel 用に BOM 付き）

打刻は SQLite（`kintai.db`）の `staff` / `punch` テーブルに記録。
連続押下による二重打刻は、端末側・サーバー側の二段ロックアウトで防止。

---

## 開発の進め方（フェーズ）

1. [x] Arduino IDE セットアップ＋ Lチカで動作確認
2. [x] タクトスイッチ1個の押下検知
3. [x] ボタン8個の個別検知（→ シリアルに職員名を出力）
4. [ ] Wi-Fi 接続＋サーバーへ HTTP POST 送信
5. [ ] サーバー側の在室表示・CSV 出力の仕上げ
6. [ ] ユニバーサル基板へはんだ付けで清書（ブレッドボードを卒業）
7. [ ] 3D プリント筐体に組み込み（白フィラメント・面分割＋差し色デザイン）

---

## 注意点

- **書き込み時に `Connecting...` で止まる**: BOOT ボタンを押し続けながら Upload、
  「Connecting...」表示後に離す（特に CH340 ボード）。
- **シリアルが表示されない**: Serial Monitor のボーレートを **115200** に。
  起動ログを見るには基板の EN(RST) を押す。
- **ボタンが反応しない**: スイッチは「対角」の足を使う。反応しなければ 90度回す。
- **コードはボードから吸い出せない**: 書き込まれるのはバイナリのみ。
  `.ino` ソースは必ず Git / クラウドで保管すること。
- **完成品はブレッドボード非推奨**: 常設は接触不良の原因に。
  ユニバーサル基板へのはんだ付けを推奨。
