// 8ボタン読み取りテスト
// 各ボタン: 片足→GPIO、対角足→GND(共通)

// 使うGPIOと、職員名(あとでサーバー送信に使う識別子)
const int   BUTTON_PINS[8] = {4, 5, 13, 14, 18, 19, 21, 22};
const char* STAFF_NAMES[8] = {
  "院長", "看護A", "看護B", "受付A",
  "受付B", "検査技師", "事務A", "事務B"
};

#define LED_PIN 2

int lastState[8];                 // 各ボタンの前回状態
unsigned long lastPress[8] = {0}; // 各ボタンの最終押下時刻(チャタリング/連打対策)
const unsigned long DEBOUNCE_MS = 200;

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  for (int i = 0; i < 8; i++) {
    pinMode(BUTTON_PINS[i], INPUT_PULLUP);
    lastState[i] = HIGH;          // 未押下=HIGH
  }
  delay(500);
  Serial.println("=== 8ボタンテスト開始。どれか押してください ===");
}

void loop() {
  unsigned long now = millis();

  for (int i = 0; i < 8; i++) {
    int state = digitalRead(BUTTON_PINS[i]);

    // HIGH→LOW = 押した瞬間
    if (lastState[i] == HIGH && state == LOW) {
      // 連打/チャタリング無視
      if (now - lastPress[i] > DEBOUNCE_MS) {
        lastPress[i] = now;
        Serial.print(">>> 押されました: ");
        Serial.print(STAFF_NAMES[i]);
        Serial.print(" (GPIO");
        Serial.print(BUTTON_PINS[i]);
        Serial.println(")");

        // 押下確認に内蔵LEDを一瞬光らせる
        digitalWrite(LED_PIN, HIGH);
        delay(80);
        digitalWrite(LED_PIN, LOW);
      }
    }
    lastState[i] = state;
  }

  delay(10);  // CPUを少し休ませる
}
