# QCTQ - Умные Часы-Хаб с OTA обновлениями

## 📱 Описание проекта

QCTQ - это система умных часов на базе ESP8266 (Wemos D1 Mini) с поддержкой:
- ⏰ Часов и даты
- 📱 Telegram уведомлений через relay сервер
- 🎯 Викторин и квестов
- 🔄 OTA (Over-The-Air) обновлений прошивки
- 📡 WiFi Manager

## 🚀 OTA Система обновлений

### Как это работает:

1. **Устройство проверяет обновления** каждые 5 минут
2. **Сервер сравнивает версии** и возвращает информацию об обновлении
3. **Устройство скачивает** новую прошивку с GitHub Releases
4. **Автоматическая установка** и перезагрузка

### Структура версий:

- **v2.0.0** - Базовая версия с relay сервером
- **v2.1.0** - Улучшенная OTA система
- **v2.2.0** - Оптимизация памяти и стабильности

## 📦 Установка

### Требования:
- Arduino IDE или Arduino CLI
- ESP8266 Board Package
- Библиотеки (см. `qctq_relay_firmware/qctq_relay_firmware.ino`)

### Компиляция:
```bash
cd qctq_relay_firmware
arduino-cli compile --fqbn esp8266:esp8266:d1_mini . --output-dir ./build
```

### Прошивка:
```bash
esptool.py --port /dev/tty.usbserial-110 --baud 115200 write_flash 0x0 build/qctq_relay_firmware.ino.bin
```

## 🔧 Конфигурация

### Настройки в прошивке:
```cpp
#define FIRMWARE_VERSION "2.0.0"


```

### Relay сервер:
- **Адрес:** http://84.201.179.109
- **Админ-панель:** http://84.201.179.109/admin
- **API:** REST API для управления устройствами

## 📊 Статистика

- **Поддерживаемые устройства:** 12+ QCTQ устройств
- **Размер прошивки:** ~456KB
- **Использование RAM:** 43%
- **Использование Flash:** 39%

## 🔄 OTA Endpoints

### Проверка обновлений:
```
GET /firmware/check/{device_id}?current_version={version}
```

### Скачивание прошивки:
```
GET /firmware/download/{version}
```

### Регистрация прошивки:
```
POST /firmware/register
{
  "version": "2.1.0",
  "url": "https://github.com/pl0schadka/qctq/releases/download/v2.1.0/qctq_relay_firmware_v2.1.0.bin",
  "size": 456352,
  "checksum": "sha256:...",
  "description": "Улучшенная OTA система"
}
```

## 📝 Лицензия

MIT License - см. файл LICENSE

## 🤝 Вклад в проект

1. Fork репозитория
2. Создайте feature branch
3. Commit изменения
4. Push в branch
5. Создайте Pull Request

## 📞 Поддержка

- **Issues:** https://github.com/pl0schadka/qctq/issues
- **Discussions:** https://github.com/pl0schadka/qctq/discussions
