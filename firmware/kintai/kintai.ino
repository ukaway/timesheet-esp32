/*
 * 勤怠パネル ESP32 — Google Sheets(GAS)直書き版 / サーバー不要
 * ボタン押下 → GAS WebアプリへHTTPS POST → スプレッドシートに1行追記
 */
#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <U8g2lib.h>
#include "secrets.h"

const int OLED_SDA = 21;
const int OLED_SCL = 22;
const int OLED_ADDR = 0x3C;

U8G2_SSD1306_128X64_NONAME_F_HW_I2C display(U8G2_R0, U8X8_PIN_NONE, OLED_SCL, OLED_SDA);
bool displayReady = false;

const int   BUTTON_PINS[8] = {4, 5, 13, 14, 18, 19, 25, 26};
const char* STAFF_IDS[8]   = {"staff1","staff2","staff3","staff4",
                              "staff5","staff6","staff7","staff8"};
const char* STAFF_NAMES[8] = {"スタッフ1","スタッフ2","スタッフ3","スタッフ4",
                              "スタッフ5","スタッフ6","スタッフ7","スタッフ8"};
const int NUM_BUTTONS = 8;
const int LED_PIN = 2;

const unsigned long DEBOUNCE_MS  = 50;
const unsigned long LOCKOUT_MS   = 3000;
const unsigned long WIFI_TIMEOUT = 15000;
const unsigned long WIFI_KEEPALIVE_MS = 10UL * 60UL * 1000UL;
const unsigned long DISPLAY_IDLE_MS = 30UL * 1000UL;
const bool DEBUG_WIFI = true;

int           lastState[8];
unsigned long lastPress[8] = {0};
unsigned long lastWifiUse = 0;
unsigned long lastDisplayUse = 0;
bool displayOn = false;

void showMessage(const char* line1, const char* line2 = "", const char* line3 = "") {
  if (!displayReady) return;

  display.setPowerSave(0);
  displayOn = true;
  lastDisplayUse = millis();
  display.clearBuffer();
  display.setFont(u8g2_font_unifont_t_japanese1);
  display.drawUTF8(0, 16, line1);
  display.drawUTF8(0, 38, line2);
  display.drawUTF8(0, 60, line3);
  display.sendBuffer();
}

void updateDisplayPower() {
  if (!displayReady || !displayOn) return;
  if (millis() - lastDisplayUse < DISPLAY_IDLE_MS) return;

  display.clearBuffer();
  display.sendBuffer();
  display.setPowerSave(1);
  displayOn = false;
}

void updateWifiPower() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (millis() - lastWifiUse < WIFI_KEEPALIVE_MS) return;

  if (DEBUG_WIFI) Serial.println("WiFi idle timeout, disconnecting");
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
}

void setupDisplay() {
  display.setI2CAddress(OLED_ADDR << 1);
  displayReady = display.begin();
  if (!displayReady) {
    Serial.println("OLED not found");
    return;
  }

  showMessage("OLED", "OK", "");
  delay(1000);
}

const char* wifiStatusName(wl_status_t status) {
  switch (status) {
    case WL_IDLE_STATUS: return "WL_IDLE_STATUS";
    case WL_NO_SSID_AVAIL: return "WL_NO_SSID_AVAIL";
    case WL_SCAN_COMPLETED: return "WL_SCAN_COMPLETED";
    case WL_CONNECTED: return "WL_CONNECTED";
    case WL_CONNECT_FAILED: return "WL_CONNECT_FAILED";
    case WL_CONNECTION_LOST: return "WL_CONNECTION_LOST";
    case WL_DISCONNECTED: return "WL_DISCONNECTED";
    default: return "UNKNOWN";
  }
}

void printWifiScan() {
  if (!DEBUG_WIFI) return;

  Serial.println("WiFi scan start");
  int n = WiFi.scanNetworks();
  Serial.print("networks found=");
  Serial.println(n);

  bool foundTarget = false;
  for (int i = 0; i < n; i++) {
    String ssid = WiFi.SSID(i);
    if (ssid == WIFI_SSID) foundTarget = true;

    Serial.print(i + 1);
    Serial.print(": ");
    Serial.print(ssid);
    Serial.print(" RSSI=");
    Serial.print(WiFi.RSSI(i));
    Serial.print(" channel=");
    Serial.print(WiFi.channel(i));
    Serial.print(" encryption=");
    Serial.println(WiFi.encryptionType(i));
  }

  Serial.print("target SSID visible=");
  Serial.println(foundTarget ? "yes" : "no");
  WiFi.scanDelete();
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (DEBUG_WIFI) {
    Serial.print("WiFi connecting to ");
    Serial.println(WIFI_SSID);
  }
  showMessage("WiFi", "WAIT", "");
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < WIFI_TIMEOUT) {
    delay(250);
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    if (DEBUG_WIFI) Serial.print(".");
  }
  digitalWrite(LED_PIN, LOW);
  if (WiFi.status() == WL_CONNECTED) {
    WiFi.setSleep(true);
    lastWifiUse = millis();
    showMessage("WiFi", "OK", "");
  } else {
    showMessage("WiFi", "NG", "");
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
  }
  if (DEBUG_WIFI) {
    Serial.println();
    Serial.print("WiFi status=");
    Serial.println(wifiStatusName(WiFi.status()));
    if (WiFi.status() == WL_CONNECTED) {
      Serial.print("IP=");
      Serial.println(WiFi.localIP());
      Serial.print("RSSI=");
      Serial.println(WiFi.RSSI());
    }
  }
}

void blink(bool ok) {
  int n = ok ? 1 : 3;
  for (int i = 0; i < n; i++) {
    digitalWrite(LED_PIN, HIGH); delay(80);
    digitalWrite(LED_PIN, LOW);  delay(80);
  }
}

bool sendPunch(const char* staffId, char* kindOut, size_t kindOutSize) {
  if (kindOutSize > 0) kindOut[0] = '\0';

  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
    if (WiFi.status() != WL_CONNECTED) {
      showMessage("FAILED", "WiFi", "");
      return false;
    }
  }
  lastWifiUse = millis();

  showMessage("SENDING", "", "");

  WiFiClientSecure client;
  client.setInsecure();
  client.setHandshakeTimeout(30);

  HTTPClient http;
  http.begin(client, GAS_URL);
  http.setConnectTimeout(15000);
  http.setTimeout(20000);
  http.addHeader("Content-Type", "text/plain");
  // 追従しない。302が来たら「受理された」とみなす。
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);

  String body = String("{\"token\":\"") + TOKEN +
                "\",\"staff_id\":\"" + staffId + "\"}";
  int code = http.POST(body);
  Serial.print("code="); Serial.println(code);

  // 200(直接応答) か 302(結果ページへ誘導=処理成功) を成功とみなす
  bool ok = (code == HTTP_CODE_OK ||
             code == HTTP_CODE_FOUND ||          // 302
             code == HTTP_CODE_MOVED_PERMANENTLY); // 301

  if (code == HTTP_CODE_OK) {
    String payload = http.getString();
    ok = payload.indexOf("\"ok\":true") >= 0;
    if (ok && kindOutSize > 0) {
      if (payload.indexOf("\"kind\":\"in\"") >= 0) {
        snprintf(kindOut, kindOutSize, "%s", "IN");
      } else if (payload.indexOf("\"kind\":\"out\"") >= 0) {
        snprintf(kindOut, kindOutSize, "%s", "OUT");
      } else if (payload.indexOf("\"kind\":\"duplicate\"") >= 0) {
        snprintf(kindOut, kindOutSize, "%s", "DUP");
      }
    }
    Serial.print("応答 -> "); Serial.println(payload);
  }
  http.end();
  lastWifiUse = millis();
  return ok;
}

void setup() {
  Serial.begin(115200);
  Wire.begin(OLED_SDA, OLED_SCL);
  setupDisplay();
  pinMode(LED_PIN, OUTPUT);
  for (int i = 0; i < NUM_BUTTONS; i++) {
    pinMode(BUTTON_PINS[i], INPUT_PULLUP);
    lastState[i] = HIGH;
  }
  delay(300);
  showMessage("READY", "PUSH", "");
  WiFi.mode(WIFI_OFF);
}

void loop() {
  unsigned long now = millis();
  for (int i = 0; i < NUM_BUTTONS; i++) {
    int state = digitalRead(BUTTON_PINS[i]);
    if (lastState[i] == HIGH && state == LOW) {
      if (now - lastPress[i] > LOCKOUT_MS) {
        lastPress[i] = now;
        showMessage("PUSH", STAFF_NAMES[i], "");
        char kind[4];
        bool ok = sendPunch(STAFF_IDS[i], kind, sizeof(kind));
        blink(ok);
        showMessage(ok ? "OK" : "FAILED", STAFF_NAMES[i], kind);
      }
      delay(DEBOUNCE_MS);
    }
    lastState[i] = state;
  }
  updateWifiPower();
  updateDisplayPower();
  delay(10);
}
