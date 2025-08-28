/**
 * "Умные Часы-Хаб" на ESP8266 с tg-relay
 * Разработано для Wemos D1 Mini
 * 
 * Функциональность:
 * - Часы/Дата
 * - Telegram уведомления через tg-relay
 * - Викторины через Telegram
 * - Режим "Квест"
 * - OTA обновления
 * - WiFi Manager
 * 
 * Версия: 2.0.0 (с tg-relay)
 */

#include <GyverOLED.h>
#include <FastBot2.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ESP8266httpUpdate.h>
#include <Wire.h>
#include <time.h>
#include <ArduinoJson.h>
#include <EEPROM.h>
#include <Ticker.h>
#include <ESP8266WebServer.h>
#include <ESP8266mDNS.h>

// Версия прошивки
#define FIRMWARE_VERSION "2.1.0"

// Пины
#define OLED_SDA D2
#define OLED_SCL D1
#define BUTTON_ACTION D5  // Кнопка действия
#define BUTTON_BACK D6    // Кнопка назад
#define LED_PIN D7        // Светодиод индикации
#define JUMPER_PIN D4     // Перемычка для режима "Квест"

// Настройки WiFi и tg-relayе 
const char* DEFAULT_WIFI_SSID = "persimmon";
const char* DEFAULT_WIFI_PASS = "9990042530";
const char* RELAY_SERVER = "http://84.201.179.109";
const char* RELAY_SECRET = "8265903af2e71589c70ae97bdd23fc81";
String DEVICE_ID; // Будет сгенерирован из MAC адреса

// Telegram каналы (для парсинга вопросов)
const char* QUESTIONS_CHANNEL = "-1003043763271";
const char* ANSWERS_CHANNEL = "-1002700939819";

// Адреса в EEPROM
#define EEPROM_WIFI_FLAG 0    // Флаг наличия данных
#define EEPROM_SSID_ADDR 1    // Начальный адрес SSID
#define EEPROM_PASS_ADDR 33   // Начальный адрес пароля
#define EEPROM_SIZE 100       // Размер EEPROM

// Константы для состояний приложения
enum AppState {
  STATE_CLOCK,      // Режим часов
  STATE_VIEWING,    // Просмотр уведомления
  STATE_ANSWER,     // Выбор ответа
  STATE_QUEST,      // Режим квеста
  STATE_WIFI_CONFIG // Режим настройки WiFi
};

// Типы уведомлений
enum NotificationType {
  TYPE_TG = 1,      // Уведомление из Telegram
  TYPE_QUIZ = 2     // Вопрос викторины
};

// Структура уведомления
struct Notification {
  uint8_t type;           // Тип уведомления
  String text;            // Текст уведомления/вопроса
  bool correctAnswer;     // Правильный ответ для викторины
  time_t timestamp;       // Время получения
};

// Объекты
GyverOLED<SSD1306_128x64> display;
FastBot2 bot; // Без токена - используем relay
WiFiClientSecure client;
ESP8266WebServer server(80);
Ticker ledTicker;
Ticker wifiReconnectTimer;
Ticker otaCheckTimer;
WiFiClient wifiClient;

// Состояния
AppState currentState = STATE_CLOCK;
bool questModeEnabled = false;
bool wifiConnected = false;
bool answerSelected = false;
bool telegramWebhookCleared = false;

// Переменные для очереди уведомлений
Notification notificationQueue[5];
uint8_t queueHead = 0;
uint8_t queueTail = 0;

// Переменные для времени
time_t now;
struct tm timeinfo;

// Переменные для викторины
String currentQuestion = "";
bool currentCorrectAnswer = false;
String currentQuestionDate = "";

// Переменные для режима квеста
unsigned long questStartTime = 0;
unsigned long questDuration = 300000; // 5 минут
bool questActive = false;

// Переменные для OTA
bool otaUpdateAvailable = false;
String otaUpdateUrl = "";

// Переменные для Telegram
unsigned long lastTelegramCheck = 0;
const unsigned long TELEGRAM_CHECK_INTERVAL = 10000; // 10 секунд

void setup() {
  Serial.begin(115200);
  Serial.println("QCTQ Relay v" FIRMWARE_VERSION);
  
  // Генерация DEVICE_ID из MAC адреса
  WiFi.mode(WIFI_STA);
  String mac = WiFi.macAddress();
  DEVICE_ID = "QCTQ_" + mac.substring(12); // Последние 4 символа MAC
  Serial.print("Device ID: ");
  Serial.println(DEVICE_ID);
  
  // Инициализация пинов
  pinMode(BUTTON_ACTION, INPUT_PULLUP);
  pinMode(BUTTON_BACK, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  pinMode(JUMPER_PIN, INPUT_PULLUP);
  
  // Инициализация I2C
  Wire.begin(OLED_SDA, OLED_SCL);
  
  // Инициализация EEPROM
  EEPROM.begin(EEPROM_SIZE);
  
  // Инициализация дисплея
  display.init();
  display.clear();
  display.setScale(2);
  display.home();
  display.print("QCTQ");
  display.setScale(1);
  display.setCursor(0, 3);
  display.print("v" FIRMWARE_VERSION);
  display.update();
  
  // Настройка WiFi
  setupWiFi();
  
  // Настройка времени
  configTime(3 * 3600, 0, "pool.ntp.org", "time.nist.gov");
  
  // Настройка Telegram
  setupTelegram();
  
  // Настройка веб-сервера
  setupWebServer();
  
  // Настройка OTA
  setupOTA();
  
  // Проверка режима квеста
  checkQuestMode();
  
  Serial.println("Setup complete");
}

void loop() {
  // Обработка WiFi
  if (WiFi.status() != WL_CONNECTED) {
    if (wifiConnected) {
      wifiConnected = false;
      Serial.println("WiFi disconnected");
    }
    // Если WiFi не подключен, показываем AP информацию
    currentState = STATE_WIFI_CONFIG;
  } else if (!wifiConnected) {
    wifiConnected = true;
    Serial.println("WiFi connected");
    // Если WiFi подключился, возвращаемся к часам
    currentState = STATE_CLOCK;
  }
  
  // Обновление времени только если WiFi подключен
  if (wifiConnected) {
    updateTime();
    
    // Обработка Telegram
    if (millis() - lastTelegramCheck > TELEGRAM_CHECK_INTERVAL) {
      Serial.println("[LOOP] Calling checkTelegramUpdates()");
      checkTelegramUpdates();
      lastTelegramCheck = millis();
    }
    
    // Обработка OTA
    if (otaUpdateAvailable) {
      performOTAUpdate();
    }
  }
  
  // Обработка кнопок
  handleButtons();
  
  // Обработка веб-сервера
  server.handleClient();
  
  // Отрисовка интерфейса
  draw();
  
  // Проверка режима квеста
  checkQuestMode();
  
  delay(100);
}

void setupWiFi() {
  // Загрузка сохраненных данных WiFi
  String savedSSID = loadWiFiSSID();
  String savedPass = loadWiFiPass();
  
  if (savedSSID.length() > 0) {
    Serial.print("Connecting to saved WiFi: ");
    Serial.println(savedSSID);
    WiFi.begin(savedSSID.c_str(), savedPass.c_str());
    
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
      delay(500);
      Serial.print(".");
      attempts++;
    }
    
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("\nWiFi connected");
      Serial.print("IP: ");
      Serial.println(WiFi.localIP());
      
      wifiConnected = true;
      return;
    }
  }
  
  // Если нет сохраненных данных или не удалось подключиться, запускаем AP режим
  Serial.println("\nNo saved WiFi or connection failed");
  startAPMode();
}

void startAPMode() {
  Serial.println("Starting AP mode");
  
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(IPAddress(192, 168, 4, 1), IPAddress(192, 168, 4, 1), IPAddress(255, 255, 255, 0));
  
  String apSSID = "QCTQ_" + String(ESP.getChipId(), HEX);
  WiFi.softAP(apSSID.c_str(), "12345678");
  
  Serial.print("AP started: ");
  Serial.println(apSSID);
}

void setupTelegram() {
  // Инициализация FastBot2 без токена
  bot.setToken("");
  
  // Очистка webhook один раз при старте
  if (!telegramWebhookCleared) {
    clearTelegramWebhookOnce();
    telegramWebhookCleared = true;
  }
}

void clearTelegramWebhookOnce() {
  HTTPClient http;
  String url = String(RELAY_SERVER) + "/relay";
  
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-relay-secret", RELAY_SECRET);
  
      String data = "{\"device_id\":\"" + DEVICE_ID + "\",\"message\":\"Webhook cleared\",\"type\":\"system\"}";
  
  int httpCode = http.POST(data);
  http.end();
  
  Serial.print("Webhook clear response: ");
  Serial.println(httpCode);
}

void setupWebServer() {
  // Главная страница
  server.on("/", HTTP_GET, []() {
    String html = "<html><head><title>QCTQ Setup</title></head><body>";
    html += "<h1>QCTQ Relay Setup</h1>";
    html += "<p>Device ID: " + DEVICE_ID + "</p>";
    html += "<p>Firmware: v" FIRMWARE_VERSION "</p>";
    html += "<p>WiFi: " + String(WiFi.isConnected() ? "Connected" : "AP Mode") + "</p>";
    html += "<form method='post' action='/save'>";
    html += "<p>SSID: <input type='text' name='ssid' required></p>";
    html += "<p>Password: <input type='password' name='pass' required></p>";
    html += "<input type='submit' value='Save'>";
    html += "</form></body></html>";
    server.send(200, "text/html", html);
  });
  
  // Сохранение WiFi
  server.on("/save", HTTP_POST, handleSave);
  
  server.begin();
  Serial.println("Web server started");
}

void handleSave() {
  String ssid = server.arg("ssid");
  String pass = server.arg("pass");
  
  if (ssid.length() > 0) {
    saveWiFiCredentials(ssid, pass);
    
    // Перезагрузка для применения новых настроек
    server.send(200, "text/html", "<html><body><h1>WiFi saved</h1><p>Device will restart...</p></body></html>");
    delay(1000);
    ESP.restart();
  } else {
    server.send(400, "text/html", "<html><body><h1>Error</h1><p>SSID required</p></body></html>");
  }
}

void setupOTA() {
  otaCheckTimer.attach(300, checkOTAUpdate);
}

void checkOTAUpdate() {
  // Проверка обновлений через relay сервер
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[OTA] WiFi not connected, skipping OTA check");
    return;
  }
  
  Serial.println("[OTA] Checking for updates...");
  
  WiFiClient client;
  if (!client.connect("84.201.179.109", 80)) {
    Serial.println("[OTA] Connection failed!");
    return;
  }
  
  // Формируем HTTP запрос для проверки обновлений
  String request = "GET /firmware/check/" + DEVICE_ID + "?current_version=" + FIRMWARE_VERSION;
  request += " HTTP/1.1\r\n";
  request += "Host: 84.201.179.109\r\n";
  request += "User-Agent: QCTQ-Device\r\n";
  request += "Accept: application/json\r\n";
  request += "Connection: keep-alive\r\n\r\n";
  
  Serial.print("[OTA] Request: ");
  Serial.println(request);
  
  client.print(request);
  delay(500);
  
  // Читаем ответ
  String response = "";
  while (client.available()) {
    response += client.readString();
  }
  client.stop();
  
  Serial.print("[OTA] Response: ");
  Serial.println(response);
  
  // Парсим JSON ответ
  DynamicJsonDocument doc(1024);
  DeserializationError error = deserializeJson(doc, response);
  
  if (!error && doc.containsKey("ok") && doc["ok"] == true) {
    if (doc.containsKey("update_available") && doc["update_available"] == true) {
      otaUpdateAvailable = true;
      otaUpdateUrl = doc["firmware_url"].as<String>();
      Serial.print("[OTA] Update available: ");
      Serial.println(otaUpdateUrl);
    } else {
      Serial.println("[OTA] No updates available");
    }
  } else {
    Serial.println("[OTA] Failed to parse response");
  }
}

void performOTAUpdate() {
  // Выполнение OTA обновления
  Serial.println("[OTA] Starting firmware update...");
  
  if (otaUpdateUrl.length() == 0) {
    Serial.println("[OTA] No update URL available");
    otaUpdateAvailable = false;
    return;
  }
  
  // Показываем на дисплее процесс обновления
  display.clear();
  display.setScale(1);
  display.home();
  display.print("OTA Update...");
  display.setCursor(0, 2);
  display.print("Downloading...");
  display.update();
  
  // Выполняем обновление
  WiFiClient client;
  ESPhttpUpdate.setLedPin(LED_BUILTIN, LOW);
  
  t_httpUpdate_return ret = ESPhttpUpdate.update(client, otaUpdateUrl);
  
  switch (ret) {
    case HTTP_UPDATE_OK:
      Serial.println("[OTA] Update successful, restarting...");
      display.clear();
      display.home();
      display.print("Update OK!");
      display.setCursor(0, 2);
      display.print("Restarting...");
      display.update();
      delay(2000);
      ESP.restart();
      break;
      
    case HTTP_UPDATE_FAILED:
      Serial.printf("[OTA] Update failed: %s\n", ESPhttpUpdate.getLastErrorString().c_str());
      display.clear();
      display.home();
      display.print("Update Failed!");
      display.setCursor(0, 2);
      display.print(ESPhttpUpdate.getLastErrorString());
      display.update();
      delay(3000);
      break;
      
    case HTTP_UPDATE_NO_UPDATES:
      Serial.println("[OTA] No updates available");
      break;
      
    default:
      Serial.println("[OTA] Update failed with unknown error");
      break;
  }
  
  otaUpdateAvailable = false;
}

void checkTelegramUpdates() {
  Serial.println("[TG] Checking for updates...");
  
  // Проверяем WiFi подключение
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[TG] WiFi not connected!");
    return;
  }
  
  Serial.print("[TG] WiFi IP: ");
  Serial.println(WiFi.localIP());
  
  // Получение вопросов через relay сервер
  WiFiClient client;
  
  Serial.println("[TG] Connecting to server...");
  if (!client.connect("84.201.179.109", 80)) {
    Serial.println("[TG] Connection failed!");
    return;
  }
  
  Serial.println("[TG] Connected to server");
  
  // Формируем HTTP запрос
  String request = "GET /get-questions?device_id=" + DEVICE_ID;
  
  // Добавляем текущую дату для фильтрации
  if (getLocalTime(&timeinfo)) {
    char today[11];
    sprintf(today, "%02d.%02d.%04d", timeinfo.tm_mday, timeinfo.tm_mon + 1, timeinfo.tm_year + 1900);
    request += "&date=" + String(today);
  }
  
  request += " HTTP/1.1\r\n";
  request += "Host: 84.201.179.109\r\n";
  request += "User-Agent: QCTQ-Device\r\n";
  request += "Accept: */*\r\n";
  request += "Connection: keep-alive\r\n\r\n";
  
  Serial.print("[TG] Request: ");
  Serial.println(request);
  
  client.print(request);
  
  // Ждем немного перед чтением ответа
  delay(500);
  
  Serial.println("[TG] Reading response...");
  
  // Читаем ответ
  String response = "";
  int available = client.available();
  Serial.print("[TG] Available bytes: ");
  Serial.println(available);
  
  if (available > 0) {
    while (client.available()) {
      String chunk = client.readString();
      response += chunk;
      Serial.print("[TG] Read chunk: ");
      Serial.println(chunk);
    }
  } else {
    Serial.println("[TG] No data available");
  }
  
  Serial.print("[TG] Full Response: ");
  Serial.println(response);
  
  client.stop();
  
  // Парсим ответ
  if (response.indexOf("200 OK") > 0) {
    int bodyStart = response.indexOf("\r\n\r\n");
    if (bodyStart > 0) {
      String payload = response.substring(bodyStart + 4);
      Serial.print("[TG] JSON payload: ");
      Serial.println(payload);
      parseQuestionsFromRelay(payload);
    } else {
      Serial.println("[TG] No body found in response");
    }
  } else {
    Serial.println("[TG] Response not OK");
  }
}

void parseQuestionsFromRelay(String payload) {
  DynamicJsonDocument doc(4096);
  DeserializationError error = deserializeJson(doc, payload);
  
  if (error) {
    Serial.println("JSON parse error");
    return;
  }
  
  if (doc.containsKey("ok") && doc["ok"] == true && doc.containsKey("questions")) {
    JsonArray questions = doc["questions"];
    
    for (JsonObject question : questions) {
      if (question.containsKey("question") && question.containsKey("answer") && question.containsKey("date")) {
        String questionText = question["question"].as<String>();
        bool answer = question["answer"].as<bool>();
        String date = question["date"].as<String>();
        
        // Проверяем, что это новый вопрос и мы еще не отвечали на него
        if ((questionText != currentQuestion || date != currentQuestionDate) && !answerSelected) {
          currentQuestion = questionText;
          currentCorrectAnswer = answer;
          currentQuestionDate = date;
          
          // Переход в режим ответа
          currentState = STATE_ANSWER;
          answerSelected = false;
          
          Serial.print("New quiz question: ");
          Serial.println(questionText);
        }
      }
    }
  }
}



bool isToday(String dateStr) {
  // Проверка, что дата соответствует сегодняшнему дню
  if (!getLocalTime(&timeinfo)) {
    return false;
  }
  
  char today[11];
  sprintf(today, "%02d.%02d.%04d", timeinfo.tm_mday, timeinfo.tm_mon + 1, timeinfo.tm_year + 1900);
  
  return dateStr == String(today);
}

void handleButtons() {
  static bool lastActionState = HIGH;
  static bool lastBackState = HIGH;
  static unsigned long lastActionTime = 0;
  static unsigned long lastBackTime = 0;
  
  bool actionState = digitalRead(BUTTON_ACTION);
  bool backState = digitalRead(BUTTON_BACK);
  
  // Обработка кнопки действия
  if (actionState == LOW && lastActionState == HIGH && millis() - lastActionTime > 200) {
    handleActionButton();
    lastActionTime = millis();
  }
  
  // Обработка кнопки назад
  if (backState == LOW && lastBackState == HIGH && millis() - lastBackTime > 200) {
    handleBackButton();
    lastBackTime = millis();
  }
  
  lastActionState = actionState;
  lastBackState = backState;
}

void handleActionButton() {
  switch (currentState) {
    case STATE_CLOCK:
      // Переход к первому уведомлению в очереди
      if (queueHead != queueTail) {
        currentState = STATE_VIEWING;
      }
      break;
      
    case STATE_VIEWING:
      // Переход к следующему уведомлению
      queueHead = (queueHead + 1) % 5;
      if (queueHead == queueTail) {
        currentState = STATE_CLOCK;
      }
      break;
      
    case STATE_ANSWER:
      // Выбор "ВЕРЮ"
      if (!answerSelected) {
        answerSelected = true;
        sendQuizAnswer(true);
      }
      break;
      
    case STATE_QUEST:
      // Действие в режиме квеста
      break;
      
    case STATE_WIFI_CONFIG:
      // Действие в режиме настройки WiFi
      break;
  }
}

void handleBackButton() {
  switch (currentState) {
    case STATE_CLOCK:
      // Ничего не делаем
      break;
      
    case STATE_VIEWING:
      // Возврат к часам
      currentState = STATE_CLOCK;
      break;
      
    case STATE_ANSWER:
      // Выбор "НЕ ВЕРЮ"
      if (!answerSelected) {
        answerSelected = true;
        sendQuizAnswer(false);
      }
      break;
      
    case STATE_QUEST:
      // Выход из режима квеста
      questActive = false;
      currentState = STATE_CLOCK;
      break;
      
    case STATE_WIFI_CONFIG:
      // Возврат к часам
      currentState = STATE_CLOCK;
      break;
  }
}

void sendQuizAnswer(bool userAnswer) {
  // Отправка ответа через relay
  HTTPClient http;
  String url = String(RELAY_SERVER) + "/relay";
  
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-relay-secret", RELAY_SECRET);
  
  String message = "DEVICE:" + DEVICE_ID + "|ANSWER:" + (userAnswer ? "ВЕРЮ" : "НЕ ВЕРЮ") + "|RESULT:" + (userAnswer == currentCorrectAnswer ? "ПРАВИЛЬНО" : "НЕПРАВИЛЬНО") + "|Q:" + currentQuestion;
  
  String data = "{\"device_id\":\"" + DEVICE_ID + "\",\"message\":\"" + message + "\",\"type\":\"quiz_answer\"}";
  
  int httpCode = http.POST(data);
  http.end();
  
  Serial.print("Quiz answer sent: ");
  Serial.println(httpCode);
  
  // Очищаем текущий вопрос
  currentQuestion = "";
  currentQuestionDate = "";
  
  // Возврат к часам через 3 секунды
  delay(3000);
  currentState = STATE_CLOCK;
  answerSelected = false;
}

void checkQuestMode() {
  bool jumperConnected = (digitalRead(JUMPER_PIN) == LOW);
  
  if (jumperConnected && !questModeEnabled) {
    questModeEnabled = true;
    Serial.println("Quest mode enabled");
  } else if (!jumperConnected && questModeEnabled) {
    questModeEnabled = false;
    if (questActive) {
      questActive = false;
      currentState = STATE_CLOCK;
    }
    Serial.println("Quest mode disabled");
  }
  
  // Автоматический переход в режим квеста
  if (questModeEnabled && currentState == STATE_CLOCK && !questActive) {
    questActive = true;
    questStartTime = millis();
    currentState = STATE_QUEST;
    Serial.println("Entering quest mode");
  }
  
  // Автоматический выход из режима квеста
  if (questActive && (millis() - questStartTime > questDuration)) {
    questActive = false;
    currentState = STATE_CLOCK;
    Serial.println("Quest mode timeout");
  }
}

void updateTime() {
  if (getLocalTime(&timeinfo)) {
    now = mktime(&timeinfo);
  }
}

void draw() {
  display.clear();
  
  switch (currentState) {
    case STATE_CLOCK:
      drawClock();
      break;
      
    case STATE_VIEWING:
      drawNotification();
      break;
      
    case STATE_ANSWER:
      drawQuizAnswer();
      break;
      
    case STATE_QUEST:
      drawQuest();
      break;
      
    case STATE_WIFI_CONFIG:
      drawWiFiConfig();
      break;
  }
  
  display.update();
}

void drawClock() {
  display.setScale(2);
  display.home();
  
  if (getLocalTime(&timeinfo)) {
    char timeStr[6];
    sprintf(timeStr, "%02d:%02d", timeinfo.tm_hour, timeinfo.tm_min);
    display.print(timeStr);
    
    display.setScale(1);
    display.setCursor(0, 3);
    char dateStr[11];
    sprintf(dateStr, "%02d.%02d.%04d", timeinfo.tm_mday, timeinfo.tm_mon + 1, timeinfo.tm_year + 1900);
    display.print(dateStr);
  } else {
    display.print("00:00");
    display.setScale(1);
    display.setCursor(0, 3);
    display.print("01.01.1970");
  }
  
  // Индикатор режима квеста
  if (questModeEnabled) {
    display.setCursor(110, 0);
    display.print("Q");
  }
  
  // Индикатор WiFi
  display.setCursor(110, 7);
  display.print(wifiConnected ? "W" : "X");
}

void drawNotification() {
  display.setScale(1);
  display.home();
  display.print("Notification:");
  
  if (queueHead != queueTail) {
    Notification& notif = notificationQueue[queueHead];
    display.setCursor(0, 2);
    
    // Обрезка текста для дисплея
    String displayText = notif.text;
    if (displayText.length() > 20) {
      displayText = displayText.substring(0, 17) + "...";
    }
    
    display.print(displayText);
  }
}

void drawQuizAnswer() {
  display.setScale(1);
  display.home();
  display.print("Quiz:");
  
  display.setCursor(0, 2);
  String displayQuestion = currentQuestion;
  if (displayQuestion.length() > 20) {
    displayQuestion = displayQuestion.substring(0, 17) + "...";
  }
  display.print(displayQuestion);
  
  display.setCursor(0, 4);
  display.print("Press ACTION: VERO");
  display.setCursor(0, 5);
  display.print("Press BACK: NE VERO");
  
  if (answerSelected) {
    display.setCursor(0, 7);
    display.print("Sending...");
  }
}

void drawQuest() {
  display.setScale(1);
  display.home();
  display.print("QUEST MODE");
  
  unsigned long elapsed = millis() - questStartTime;
  unsigned long remaining = questDuration - elapsed;
  
  display.setCursor(0, 2);
  display.print("Time: ");
  display.print(remaining / 1000);
  display.print("s");
  
  display.setCursor(0, 4);
  display.print("Press BACK to exit");
}

void drawWiFiConfig() {
  display.setScale(1);
  display.home();
  display.print("WiFi Setup");
  display.setCursor(0, 2);
  display.print("AP: QCTQ_6011");
  display.setCursor(0, 3);
  display.print("Pass: 12345678");
  display.setCursor(0, 4);
  display.print("IP: 192.168.4.1");
  display.setCursor(0, 5);
  display.print("Connect & go to IP");
  display.setCursor(0, 6);
  display.print("to configure WiFi");
}

String loadWiFiSSID() {
  if (EEPROM.read(EEPROM_WIFI_FLAG) == 0xFF) {
    String ssid = "";
    for (int i = 0; i < 32; i++) {
      char c = EEPROM.read(EEPROM_SSID_ADDR + i);
      if (c == 0) break;
      ssid += c;
    }
    return ssid;
  }
  return "";
}

String loadWiFiPass() {
  if (EEPROM.read(EEPROM_WIFI_FLAG) == 0xFF) {
    String pass = "";
    for (int i = 0; i < 64; i++) {
      char c = EEPROM.read(EEPROM_PASS_ADDR + i);
      if (c == 0) break;
      pass += c;
    }
    return pass;
  }
  return "";
}

void saveWiFiCredentials(String ssid, String pass) {
  EEPROM.write(EEPROM_WIFI_FLAG, 0xFF);
  
  for (int i = 0; i < 32; i++) {
    if (i < ssid.length()) {
      EEPROM.write(EEPROM_SSID_ADDR + i, ssid[i]);
    } else {
      EEPROM.write(EEPROM_SSID_ADDR + i, 0);
    }
  }
  
  for (int i = 0; i < 64; i++) {
    if (i < pass.length()) {
      EEPROM.write(EEPROM_PASS_ADDR + i, pass[i]);
    } else {
      EEPROM.write(EEPROM_PASS_ADDR + i, 0);
    }
  }
  
  EEPROM.commit();
}
