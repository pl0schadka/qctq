# Быстрая настройка QCTQ + tg-relay

## 1. Настройка tg-relay на VPS

### Подключение к VPS
```bash
ssh user@84.201.179.109
```

### Установка и запуск
```bash
# Установка Docker
sudo apt-get update && sudo apt-get install -y docker.io docker-compose git
sudo usermod -aG docker $USER

# Создание проекта
mkdir ~/tg-relay && cd ~/tg-relay

# Файлы уже созданы, запускаем
sudo docker-compose build
sudo docker-compose up -d
```

### Настройка ботов
Отредактируйте `docker-compose.yml`:
```yaml
environment:
  - BOTS=YOUR_BOT_TOKEN:CHANNEL_ID1;CHANNEL_ID2
```

Пример:
```yaml
environment:
  - BOTS=1234567890:ABCDEF:-1001234567890,-1009876543210
```

### Доступ к веб-интерфейсу
- URL: `http://84.201.179.109/admin`
- Пароль: `080824`

## 2. Настройка QCTQ устройства

### Прошивка
1. Откройте `qctq_relay.ino` в Arduino IDE
2. Установите библиотеки:
   - GyverOLED
   - FastBot2
   - ArduinoJson
3. Настройте параметры в коде:
   ```cpp
   const char* RELAY_SERVER = "http://84.201.179.109";
   const char* RELAY_SECRET = "change_me";
   const char* DEVICE_ID = "QCTQ_2502";
   ```
4. Загрузите на ESP8266

### Подключение к WiFi
1. При первом запуске устройство создаст AP `QCTQ_XXXX`
2. Подключитесь к AP (пароль: `12345678`)
3. Откройте `http://192.168.4.1`
4. Введите данные WiFi

## 3. Создание вопросов

1. Откройте `http://84.201.179.109/admin`
2. Войдите с паролем `080824`
3. Заполните форму:
   - **Вопрос:** Текст вопроса
   - **Ответ:** True (ВЕРЮ) или False (НЕ ВЕРЮ)
   - **Дата:** Дата для показа
   - **Канал:** Выберите канал
4. Нажмите "Send Question"

## 4. Тестирование

### Проверка tg-relay
```bash
# Проверка API
curl http://84.201.179.109/health

# Тест отправки
curl -X POST http://84.201.179.109/relay \
  -H "Content-Type: application/json" \
  -H "x-relay-secret: change_me" \
  -d '{"device_id":"test","message":"Test message","type":"status"}'
```

### Проверка устройства
1. Устройство должно показывать время
2. При получении вопроса переходит в режим ответа
3. Кнопки ACTION/BACK для ответов
4. Перемычка D4 для режима квеста

## 5. Мониторинг

### Логи сервера
```bash
sudo docker-compose logs -f relay
```

### Статистика
- Веб-интерфейс: `http://84.201.179.109/admin`
- API: `http://84.201.179.109/stats`

## 6. Устранение неполадок

### Сервер не отвечает
```bash
sudo docker-compose ps
sudo docker-compose restart
```

### Устройство не подключается
1. Проверьте WiFi данные
2. Устройство создаст AP при неудаче
3. Настройте через `192.168.4.1`

### Вопросы не приходят
1. Проверьте настройки ботов в `docker-compose.yml`
2. Убедитесь, что бот добавлен в канал
3. Проверьте логи: `sudo docker-compose logs relay`

## Полезные команды

```bash
# Перезапуск сервера
sudo docker-compose restart

# Обновление кода
sudo docker-compose down
sudo docker-compose build
sudo docker-compose up -d

# Просмотр логов
sudo docker-compose logs -f relay

# Проверка статуса
sudo docker-compose ps
```
