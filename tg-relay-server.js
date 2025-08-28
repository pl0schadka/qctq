const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const session = require("express-session");
const DataStorage = require("./data-storage");

const PORT = process.env.PORT || 8080;
const RELAY_SECRET = process.env.RELAY_SECRET || "change_me";
const ADMIN_PASS = process.env.ADMIN_PASS || "080824";
// Парсим один бот с несколькими каналами
const BOTS_RAW = process.env.BOTS || "";
console.log(`Raw BOTS env: ${BOTS_RAW}`);

const BOTS = (() => {
  if (!BOTS_RAW) return [];
  
  // Формат: token:chat1,chat2
  const lastColonIndex = BOTS_RAW.lastIndexOf(":");
  if (lastColonIndex === -1) return [];
  
  const token = BOTS_RAW.substring(0, lastColonIndex);
  const chatsStr = BOTS_RAW.substring(lastColonIndex + 1);
  const chats = chatsStr.split(",").filter(Boolean);
  
  console.log(`Parsed bot: token=${token}, chats=${chats.join(',')}`);
  return [{ token, chats }];
})();

let stats = { received: 0, sent: 0 };
let lastUpdateIds = {}; // Последние update_id для каждого бота

// Инициализация хранилища данных
const dataStorage = new DataStorage();
let questionsHistory = [];
let answersHistory = [];
let deviceVersions = {};
let firmwareVersions = {};

// Инициализация данных при запуске
async function initializeData() {
  await dataStorage.init();
  questionsHistory = await dataStorage.loadQuestions();
  answersHistory = await dataStorage.loadAnswers();
  deviceVersions = await dataStorage.loadDeviceVersions();
  firmwareVersions = await dataStorage.loadFirmwareConfig();
  console.log('Data initialized:', {
    questions: questionsHistory.length,
    answers: answersHistory.length,
    devices: Object.keys(deviceVersions).length,
    firmware: Object.keys(firmwareVersions.qctq_relay || {}).length
  });
}

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(session({
  secret: "qctq-secret-key",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 часа
}));

// Middleware для проверки авторизации
function requireAuth(req, res, next) {
  // Временно убрали авторизацию для тестирования
  next();
}

// API endpoints
app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/stats", (req, res) => res.json({ ...stats, bots: BOTS.length, answers: answersHistory.length }));

app.get("/answers", (req, res) => {
  const { device_id, limit = 50 } = req.query;
  
  let filteredAnswers = answersHistory;
  
  if (device_id) {
    filteredAnswers = answersHistory.filter(answer => answer.device_id === device_id);
  }
  
  if (limit) {
    filteredAnswers = filteredAnswers.slice(0, parseInt(limit));
  }
  
  res.json({ 
    ok: true, 
    answers: filteredAnswers,
    total: answersHistory.length,
    filtered: filteredAnswers.length
  });
});

// OTA endpoints
app.get("/firmware/check/:device_id", async (req, res) => {
  const { device_id } = req.params;
  const { current_version = "1.0.0" } = req.query;
  
  // Сохраняем текущую версию устройства
  deviceVersions = await dataStorage.updateDeviceVersion(device_id, current_version);
  
  // Проверяем доступные версии
  const availableVersions = Object.keys(firmwareVersions.qctq_relay)
    .filter(version => version > current_version)
    .sort((a, b) => {
      const aParts = a.split('.').map(Number);
      const bParts = b.split('.').map(Number);
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aPart = aParts[i] || 0;
        const bPart = bParts[i] || 0;
        if (aPart !== bPart) return bPart - aPart;
      }
      return 0;
    });
  
  if (availableVersions.length > 0) {
    const latestVersion = availableVersions[0];
    const firmware = firmwareVersions.qctq_relay[latestVersion];
    
    res.json({
      ok: true,
      update_available: true,
      current_version,
      latest_version: latestVersion,
      firmware_url: firmware.url,
      firmware_size: firmware.size,
      firmware_checksum: firmware.checksum,
      description: firmware.description
    });
  } else {
    res.json({
      ok: true,
      update_available: false,
      current_version,
      message: "Устройство обновлено до последней версии"
    });
  }
});

app.get("/firmware/download/:version", (req, res) => {
  const { version } = req.params;
  
  if (!firmwareVersions.qctq_relay[version]) {
    return res.status(404).json({ ok: false, error: "Firmware version not found" });
  }
  
  const firmware = firmwareVersions.qctq_relay[version];
  
  // Перенаправляем на URL прошивки
  res.redirect(firmware.url);
});

app.post("/firmware/register", async (req, res) => {
  const { version, url, size, checksum, description } = req.body;
  
  if (!version || !url) {
    return res.json({ ok: false, error: "Version and URL required" });
  }
  
  try {
    const firmwareData = {
      url,
      size: size || 0,
      checksum: checksum || "",
      description: description || "",
      release_date: new Date().toISOString().split('T')[0]
    };
    
    firmwareVersions = await dataStorage.addFirmwareVersion(version, firmwareData);
    res.json({ ok: true, message: `Firmware version ${version} registered` });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

app.get("/firmware/versions", (req, res) => {
  res.json({
    ok: true,
    versions: firmwareVersions.qctq_relay || {},
    device_versions: deviceVersions
  });
});

app.delete("/firmware/versions/:version", async (req, res) => {
  const { version } = req.params;
  
  try {
    firmwareVersions = await dataStorage.deleteFirmwareVersion(version);
    res.json({ ok: true, message: `Firmware version ${version} deleted` });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

// Новый endpoint для получения вопросов из локального хранилища
app.get("/get-questions", async (req, res) => {
  console.log("=== GET /get-questions called ===");
  const { device_id, date } = req.query;
  
  if (!device_id) {
    return res.status(400).json({ ok: false, error: "device_id required" });
  }
  
  try {
    console.log(`Getting questions for device ${device_id}, date: ${date}`);
    console.log(`About to register device: ${device_id}`);
    
    // Регистрируем устройство (обновляем время последней активности)
    console.log(`Calling updateDeviceActivity for: ${device_id}`);
    deviceVersions = await dataStorage.updateDeviceActivity(device_id);
    console.log(`Device registered successfully. Total devices: ${Object.keys(deviceVersions).filter(key => !key.includes('_last_seen')).length}`);
    
    // Получаем вопросы из локального хранилища
    let filteredQuestions = questionsHistory;
    
    // Если указана дата, фильтруем по ней
    if (date) {
      filteredQuestions = questionsHistory.filter(q => q.date === date);
      console.log(`Filtered questions for date ${date}: ${filteredQuestions.length}`);
    }
    
    console.log(`Total questions available: ${questionsHistory.length}`);
    console.log(`Returning questions:`, filteredQuestions);
    
    res.json({ 
      ok: true, 
      questions: filteredQuestions,
      count: filteredQuestions.length
    });
    
  } catch (error) {
    console.error("Error in get-questions:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/relay", async (req, res) => {
  if ((req.headers["x-relay-secret"] || req.body.secret) !== RELAY_SECRET) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  const { device_id, message, type } = req.body;
  if (!message) return res.status(400).json({ ok: false, error: "no_message" });

  stats.received++;
  
  // Если это ответ на викторину, сохраняем локально
  if (type === "quiz_answer") {
    const answerData = {
      device_id,
      message,
      timestamp: new Date().toISOString(),
      type
    };
    
    // Сохраняем в персистентное хранилище
    answersHistory = await dataStorage.addAnswer(answerData);
    console.log(`Answer saved from ${device_id}: ${message}`);
  }
  
  // Отправляем в Telegram только если это не ответ на викторину или если нужно дублирование
  let sent = 0;
  if (type !== "quiz_answer" || process.env.SEND_ANSWERS_TO_TG === "true") {
    for (const { token, chats } of BOTS) {
      for (const chat_id of chats) {
        try {
          await axios.post(
            `https://api.telegram.org/bot${token}/sendMessage`,
            new URLSearchParams({ chat_id, text: message }).toString(),
            {
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              timeout: 10000,
            }
          );
          sent++;
        } catch (e) {}
      }
    }
    stats.sent += sent;
  }
  
  res.json({ ok: true, sent });
});

// Admin pages
// Временно убрали авторизацию для тестирования
app.get("/admin/login", (req, res) => {
  res.redirect("/admin");
});

app.get("/admin", (req, res) => {
  const today = new Date().toLocaleDateString("ru-RU").split(".").reverse().join("-");
  const todayFormatted = new Date().toLocaleDateString("ru-RU");
  
  res.send(`
    <html>
    <head><title>QCTQ Admin Panel</title>
    <style>
      body { font-family: Arial; margin: 20px; background: #f5f5f5; }
      .container { max-width: 1200px; margin: 0 auto; }
      .header { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
      .form-section, .history-section { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
      input, textarea, select { width: 100%; padding: 10px; margin: 5px 0; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
      button { padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; margin: 5px; }
      button:hover { background: #0056b3; }
      button.danger { background: #dc3545; }
      button.danger:hover { background: #c82333; }
      .question-item { border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 4px; }
      .question-date { color: #666; font-size: 0.9em; }
      .stats { display: flex; gap: 20px; margin-bottom: 20px; }
      .stat-box { background: white; padding: 15px; border-radius: 8px; text-align: center; flex: 1; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
      .stat-number { font-size: 2em; font-weight: bold; color: #007bff; }
      .logout { float: right; }
    </style>
    <script>
      function sendQuestion() {
        const question = document.getElementById('question').value;
        const answer = document.getElementById('answer').value;
        const date = document.getElementById('date').value;
        const channel = document.getElementById('channel').value;
        
        if (!question || !answer || !date || !channel) {
          alert('Пожалуйста, заполните все поля');
          return;
        }
        
        const formattedDate = new Date(date).toLocaleDateString('ru-RU');
        
        fetch('/admin/send-question', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            message: question, 
            answer: answer, 
            date: formattedDate, 
            channel: channel 
          })
        })
        .then(response => response.json())
        .then(data => {
          if (data.ok) {
            alert('Вопрос отправлен успешно!');
            location.reload();
          } else {
            alert('Ошибка: ' + data.error);
          }
        });
      }
      
      function resendQuestion(id) {
        if (confirm('Отправить этот вопрос повторно?')) {
          fetch('/admin/resend-question', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
          })
          .then(response => response.json())
          .then(data => {
            if (data.ok) {
              alert('Вопрос отправлен повторно!');
            } else {
              alert('Ошибка: ' + data.error);
            }
          });
        }
      }
      
      function deleteQuestion(id) {
        if (confirm('Удалить этот вопрос?')) {
          fetch('/admin/delete-question', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
          })
          .then(response => response.json())
          .then(data => {
            if (data.ok) {
              location.reload();
            } else {
              alert('Error: ' + data.error);
            }
          });
        }
      }
    </script>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>QCTQ Панель администратора</h1>
          <a href="/admin/logout" class="logout">Выйти</a>
          <div class="stats">
            <div class="stat-box">
              <div class="stat-number">${stats.received}</div>
              <div>Получено сообщений</div>
            </div>
            <div class="stat-box">
              <div class="stat-number">${stats.sent}</div>
              <div>Отправлено сообщений</div>
            </div>
            <div class="stat-box">
              <div class="stat-number">${BOTS.length}</div>
              <div>Активных ботов</div>
            </div>
            <div class="stat-box">
              <div class="stat-number">${answersHistory.length}</div>
              <div>Получено ответов</div>
            </div>
            <div class="stat-box">
              <div class="stat-number">${Object.keys(deviceVersions).filter(key => !key.includes('_last_seen')).length}</div>
              <div>Устройств зарегистрировано</div>
            </div>
          </div>
        </div>
        
        <div class="form-section">
          <h2>Отправить новый вопрос</h2>
          <textarea id="question" placeholder="Введите ваш вопрос здесь..." rows="3"></textarea>
          <select id="answer">
            <option value="">Выберите ответ</option>
            <option value="true">True (ВЕРЮ)</option>
            <option value="false">False (НЕ ВЕРЮ)</option>
          </select>
          <input type="date" id="date" value="${today}">
          <select id="channel">
            <option value="">Выберите канал</option>
            ${BOTS.flatMap(bot => bot.chats).map((chat, index) => {
              const channelName = index === 0 ? 'QCTQ Вопросы' : 'QCTQ Ответы';
              return `<option value="${chat}">${channelName} (${chat})</option>`;
            }).join('')}
          </select>
          <button onclick="sendQuestion()">Отправить вопрос</button>
        </div>
        
        <div class="history-section">
          <h2>История вопросов</h2>
          ${questionsHistory.length === 0 ? '<p>Вопросы еще не отправлялись.</p>' : 
            questionsHistory.map((q, i) => `
              <div class="question-item">
                <div class="question-date">${q.date} - ${q.time}</div>
                <div><strong>Вопрос:</strong> ${q.question}</div>
                <div><strong>Ответ:</strong> ${q.answer === 'true' ? 'True (ВЕРЮ)' : 'False (НЕ ВЕРЮ)'}</div>
                <div><strong>Канал:</strong> ${q.channel === '-1003043763271' ? 'QCTQ Вопросы' : 'QCTQ Ответы'} (${q.channel})</div>
                <button onclick="resendQuestion(${i})">Отправить повторно</button>
                <button class="danger" onclick="deleteQuestion(${i})">Удалить</button>
              </div>
            `).join('')
          }
        </div>
        
        <div class="history-section">
          <h2>История ответов</h2>
          ${answersHistory.length === 0 ? '<p>Ответы еще не получены.</p>' : 
            answersHistory.slice(0, 20).map((a, i) => `
              <div class="question-item">
                <div class="question-date">${new Date(a.timestamp).toLocaleString('ru-RU')}</div>
                <div><strong>Устройство:</strong> ${a.device_id}</div>
                <div><strong>Ответ:</strong> ${a.message}</div>
              </div>
            `).join('')
          }
          ${answersHistory.length > 20 ? `<p><em>Показаны последние 20 из ${answersHistory.length} ответов</em></p>` : ''}
        </div>
        
        <div class="history-section">
          <h2>Управление прошивками</h2>
          <div style="margin-bottom: 20px;">
            <h3>Зарегистрировать новую прошивку</h3>
            <input type="text" id="fw_version" placeholder="Версия (например, 2.1.0)" style="width: 200px;">
            <input type="text" id="fw_url" placeholder="URL для скачивания" style="width: 400px;">
            <input type="number" id="fw_size" placeholder="Размер в байтах" style="width: 150px;">
            <input type="text" id="fw_checksum" placeholder="SHA256 контрольная сумма" style="width: 300px;">
            <textarea id="fw_description" placeholder="Описание" rows="2" style="width: 100%; margin-top: 10px;"></textarea>
            <button onclick="registerFirmware()">Зарегистрировать прошивку</button>
          </div>
          
          <div>
            <h3>Доступные версии</h3>
            ${Object.keys(firmwareVersions.qctq_relay || {}).length === 0 ? '<p>Прошивки не зарегистрированы</p>' : 
              Object.entries(firmwareVersions.qctq_relay || {}).map(([version, fw]) => `
                <div class="question-item">
                  <div><strong>Версия:</strong> ${version}</div>
                  <div><strong>Размер:</strong> ${fw.size} байт</div>
                  <div><strong>Описание:</strong> ${fw.description}</div>
                  <div><strong>URL:</strong> <a href="${fw.url}" target="_blank">${fw.url}</a></div>
                  <button onclick="deleteFirmware('${version}')" class="danger">Удалить</button>
                </div>
              `).join('')
            }
          </div>
          
          <div style="margin-top: 20px;">
            <h3>Версии устройств</h3>
            ${Object.keys(deviceVersions).filter(key => !key.includes('_last_seen')).length === 0 ? '<p>Устройства не подключены</p>' : 
              Object.entries(deviceVersions)
                .filter(([key, value]) => !key.includes('_last_seen'))
                                 .map(([device, version]) => {
                   const lastSeen = deviceVersions[`${device}_last_seen`];
                   let status = '⚪ Неизвестно';
                   if (lastSeen) {
                     const timeDiff = new Date() - new Date(lastSeen);
                     if (timeDiff < 60000) { // менее 1 минуты
                       status = '🟢 Онлайн';
                     } else if (timeDiff < 300000) { // менее 5 минут
                       status = '🟡 Недавно';
                     } else {
                       status = '🔴 Офлайн';
                     }
                   }
                   const lastSeenStr = lastSeen ? new Date(lastSeen).toLocaleString('ru-RU') : 'Никогда';
                  return `
                    <div class="question-item">
                      <div><strong>Устройство:</strong> ${device}</div>
                      <div><strong>Версия:</strong> ${version}</div>
                      <div><strong>Статус:</strong> ${status}</div>
                      <div><strong>Последняя активность:</strong> ${lastSeenStr}</div>
                      <button onclick="checkUpdate('${device}', '${version}')">Проверить обновления</button>
                    </div>
                  `;
                }).join('')
            }
          </div>
        </div>
        
        <div class="history-section">
          <h2>Тестирование устройств</h2>
          <div style="margin-bottom: 20px;">
            <h3>Тест связи с устройством</h3>
            <select id="test_device" style="width: 200px; margin-right: 10px;">
              <option value="">Выберите устройство</option>
              ${Object.keys(deviceVersions)
                .filter(key => !key.includes('_last_seen'))
                .map(device => {
                  const lastSeen = deviceVersions[`${device}_last_seen`];
                  let status = '⚪ Неизвестно';
                  if (lastSeen) {
                    const timeDiff = new Date() - new Date(lastSeen);
                    if (timeDiff < 60000) { // менее 1 минуты
                      status = '🟢 Онлайн';
                    } else if (timeDiff < 300000) { // менее 5 минут
                      status = '🟡 Недавно';
                    } else {
                      status = '🔴 Офлайн';
                    }
                  }
                  return `<option value="${device}">${device} (${status})</option>`;
                }).join('')}
              <option value="QCTQ_6011">QCTQ_6011 (Ручной)</option>
            </select>
            <button onclick="testDeviceStatus()">Отправить запрос статуса</button>
            <button onclick="testDeviceQuiz()">Отправить ответ викторины</button>
            <button onclick="testDeviceSystem()">Отправить системное сообщение</button>
            <button onclick="testDeviceQuestions()">Проверить вопросы</button>
            <button onclick="testDeviceOTA()">Проверить OTA обновления</button>
          </div>
          
          <div id="test_results" style="margin-top: 20px; padding: 10px; background: #f5f5f5; border-radius: 5px; display: none;">
            <h4>Результаты теста:</h4>
            <pre id="test_output"></pre>
          </div>
          
          <div style="margin-top: 20px; padding: 10px; background: #e8f4fd; border-radius: 5px;">
            <h4>Как тестировать:</h4>
            <ol>
              <li>Убедитесь, что устройство подключено к WiFi</li>
              <li>Выберите "QCTQ_6011 (Ручной)" из списка</li>
              <li>Нажмите любую кнопку теста</li>
              <li>Проверьте логи устройства на наличие входящих сообщений</li>
            </ol>
          </div>
        </div>
      </div>
      
      <script>
        function registerFirmware() {
          const version = document.getElementById('fw_version').value;
          const url = document.getElementById('fw_url').value;
          const size = document.getElementById('fw_size').value;
          const checksum = document.getElementById('fw_checksum').value;
          const description = document.getElementById('fw_description').value;
          
          if (!version || !url) {
            alert('Требуется версия и URL');
            return;
          }
          
          fetch('/firmware/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ version, url, size, checksum, description })
          })
          .then(response => response.json())
          .then(data => {
            if (data.ok) {
              alert('Прошивка зарегистрирована успешно!');
              location.reload();
            } else {
              alert('Ошибка: ' + data.error);
            }
          });
        }
        
        function deleteFirmware(version) {
          if (confirm('Удалить версию прошивки ' + version + '?')) {
            fetch('/firmware/versions/' + version, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' }
            })
            .then(response => response.json())
            .then(data => {
              if (data.ok) {
                alert('Прошивка удалена успешно!');
                location.reload();
              } else {
                alert('Ошибка: ' + data.error);
              }
            });
          }
        }
        
        function checkUpdate(deviceId, currentVersion) {
          fetch('/firmware/check/' + deviceId + '?current_version=' + currentVersion)
          .then(response => response.json())
          .then(data => {
            if (data.ok && data.update_available) {
              alert('Update available: ' + data.latest_version + '\\n' + data.description);
            } else {
              alert('No updates available');
            }
          });
        }
        
        function showTestResult(result) {
          document.getElementById('test_results').style.display = 'block';
          document.getElementById('test_output').textContent = JSON.stringify(result, null, 2);
        }
        
        function testDeviceStatus() {
          const deviceId = document.getElementById('test_device').value;
          if (!deviceId) {
            alert('Please select a device');
            return;
          }
          
          fetch('/admin/test-device', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId, type: 'status' })
          })
          .then(response => response.json())
          .then(data => showTestResult(data));
        }
        
        function testDeviceQuiz() {
          const deviceId = document.getElementById('test_device').value;
          if (!deviceId) {
            alert('Please select a device');
            return;
          }
          
          fetch('/admin/test-device', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId, type: 'quiz_answer' })
          })
          .then(response => response.json())
          .then(data => showTestResult(data));
        }
        
        function testDeviceSystem() {
          const deviceId = document.getElementById('test_device').value;
          if (!deviceId) {
            alert('Please select a device');
            return;
          }
          
          fetch('/admin/test-device', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId, type: 'system' })
          })
          .then(response => response.json())
          .then(data => showTestResult(data));
        }
        
        function testDeviceQuestions() {
          const deviceId = document.getElementById('test_device').value;
          if (!deviceId) {
            alert('Please select a device');
            return;
          }
          
          fetch('/admin/test-device', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId, type: 'questions' })
          })
          .then(response => response.json())
          .then(data => showTestResult(data));
        }
        
        function testDeviceOTA() {
          const deviceId = document.getElementById('test_device').value;
          if (!deviceId) {
            alert('Please select a device');
            return;
          }
          
          fetch('/admin/test-device', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId, type: 'ota' })
          })
          .then(response => response.json())
          .then(data => showTestResult(data));
        }
      </script>
    </body>
    </html>
  `);
});

app.post("/admin/send-question", async (req, res) => {
  console.log("Received send-question request:", req.body);
  const { message, answer, date, channel } = req.body;
  
  if (!message || !answer || !date || !channel) {
    console.log("Missing fields:", { message: !!message, answer: !!answer, date: !!date, channel: !!channel });
    return res.json({ ok: false, error: "Missing required fields" });
  }
  
  try {
    // Найти бота для этого канала
    const bot = BOTS.find(b => b.chats.includes(channel));
    if (!bot) {
      return res.json({ ok: false, error: "No bot found for this channel" });
    }
    
    // Создать сообщение в правильном формате
    const telegramMessage = `Q: ${message}|${answer}|${date}`;
    console.log("Sending to Telegram:", telegramMessage);
    
    // Отправить сообщение
    await axios.post(
      `https://api.telegram.org/bot${bot.token}/sendMessage`,
      new URLSearchParams({ chat_id: channel, text: telegramMessage }).toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 10000,
      }
    );
    
    // Добавить в историю
    const questionRecord = {
      question: message,
      answer: answer,
      date: date,
      channel: channel,
      time: new Date().toLocaleTimeString("ru-RU"),
      message: telegramMessage
    };
    
    console.log("Saving question record:", questionRecord);
    // Сохраняем в персистентное хранилище
    questionsHistory = await dataStorage.addQuestion(questionRecord);
    console.log("Question saved successfully");
    
    res.json({ ok: true });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

app.post("/admin/resend-question", async (req, res) => {
  const { id } = req.body;
  const question = questionsHistory[id];
  
  if (!question) {
    return res.json({ ok: false, error: "Question not found" });
  }
  
  try {
    const bot = BOTS.find(b => b.chats.includes(question.channel));
    if (!bot) {
      return res.json({ ok: false, error: "No bot found for this channel" });
    }
    
    await axios.post(
      `https://api.telegram.org/bot${bot.token}/sendMessage`,
      new URLSearchParams({ chat_id: question.channel, text: question.message }).toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 10000,
      }
    );
    
    res.json({ ok: true });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

app.post("/admin/delete-question", (req, res) => {
  const { id } = req.body;
  
  if (questionsHistory[id]) {
    questionsHistory.splice(id, 1);
    res.json({ ok: true });
  } else {
    res.json({ ok: false, error: "Question not found" });
  }
});

app.get("/admin/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/admin");
});

app.post("/admin/test-device", async (req, res) => {
  const { device_id, type } = req.body;
  
  if (!device_id || !type) {
    return res.json({ ok: false, error: "Missing device_id or type" });
  }
  
  try {
    let testData = {};
    
    switch (type) {
      case 'status':
        testData = {
          device_id: device_id,
          message: "Test status message from admin panel",
          type: "status"
        };
        break;
        
      case 'quiz_answer':
        testData = {
          device_id: device_id,
          message: "DEVICE:" + device_id + "|ANSWER:ВЕРЮ|RESULT:ПРАВИЛЬНО|Q:Test question?",
          type: "quiz_answer"
        };
        break;
        
      case 'system':
        testData = {
          device_id: device_id,
          message: "Test system message from admin panel",
          type: "system"
        };
        break;
        
      case 'questions':
        // Симулируем ответ на запрос вопросов
        const today = new Date().toLocaleDateString('ru-RU').split('.').reverse().join('-');
        const mockQuestions = [
          {
            question: "Test question from admin panel?",
            answer: "true",
            date: today
          }
        ];
        return res.json({ 
          ok: true, 
          type: "questions_response",
          questions: mockQuestions,
          message: "Mock questions sent to device"
        });
        
      case 'ota':
        // Симулируем проверку OTA обновлений
        return res.json({ 
          ok: true, 
          type: "ota_response",
          update_available: false,
          message: "No updates available for testing"
        });
        
      default:
        return res.json({ ok: false, error: "Unknown test type" });
    }
    
    // Отправляем тестовые данные через relay
    const response = await axios.post(`http://localhost:${PORT}/relay`, testData, {
      headers: { 
        'Content-Type': 'application/json',
        'x-relay-secret': RELAY_SECRET
      }
    });
    
    res.json({ 
      ok: true, 
      type: "test_sent",
      data: testData,
      response: response.data
    });
    
  } catch (error) {
    res.json({ 
      ok: false, 
      error: error.message,
      type: "test_error"
    });
  }
});

// Инициализация и запуск сервера
async function startServer() {
  await initializeData();
  
  app.listen(PORT, () => {
    console.log(`Relay listening on :${PORT}`);
  });
}

startServer().catch(console.error);
