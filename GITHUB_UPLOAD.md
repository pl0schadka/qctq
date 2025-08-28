# 🚀 Автоматическая загрузка релизов на GitHub

## 📋 Быстрый старт

### 1. Авторизация GitHub CLI

```bash
# Авторизуйтесь в GitHub
gh auth login

# Выберите:
# - GitHub.com
# - HTTPS
# - Yes (authenticate Git with your GitHub credentials)
# - Login with a web browser
```

### 2. Загрузка релиза одной командой

```bash
# Загрузить релиз v2.1.0
./upload_release.sh 2.1.0 "Улучшенная OTA система"

# Загрузить релиз v2.2.0
./upload_release.sh 2.2.0 "Новые функции"
```

## 🔧 Как это работает

Скрипт `upload_release.sh` автоматически:

1. ✅ **Проверяет** наличие файлов в папке `releases/<version>/`
2. ✅ **Создает** GitHub Release с описанием
3. ✅ **Загружает** .bin файл и release_info.json
4. ✅ **Регистрирует** прошивку в relay сервере
5. ✅ **Уведомляет** о готовности OTA обновления

## 📁 Структура файлов

```
releases/
├── v2.0.0/
│   ├── qctq_relay_firmware_v2.0.0.bin
│   └── release_info.json
├── v2.1.0/
│   ├── qctq_relay_firmware_v2.1.0.bin
│   └── release_info.json
└── v2.2.0/
    ├── qctq_relay_firmware_v2.2.0.bin
    └── release_info.json
```

## 🛠️ Создание нового релиза

### 1. Обновите версию в прошивке

```cpp
// В qctq_relay_firmware.ino
#define FIRMWARE_VERSION "2.2.0"
```

### 2. Скомпилируйте прошивку

```bash
cd qctq_relay_firmware
arduino-cli compile --fqbn esp8266:esp8266:d1_mini . --output-dir ./build
```

### 3. Создайте папку релиза

```bash
mkdir -p releases/v2.2.0
cp qctq_relay_firmware/build/qctq_relay_firmware.ino.bin releases/v2.2.0/qctq_relay_firmware_v2.2.0.bin
```

### 4. Создайте release_info.json

```json
{
  "version": "2.2.0",
  "release_date": "2025-08-28",
  "description": "Новые функции и улучшения",
  "changes": [
    "Добавлена новая функция X",
    "Исправлена ошибка Y",
    "Улучшена производительность"
  ],
  "firmware": {
    "filename": "qctq_relay_firmware_v2.2.0.bin",
    "size": 456352,
    "checksum": "sha256:NEW_HASH_HERE",
    "url": "https://github.com/pl0schadka/qctq/releases/download/v2.2.0/qctq_relay_firmware_v2.2.0.bin"
  }
}
```

### 5. Загрузите релиз

```bash
./upload_release.sh 2.2.0 "Новые функции и улучшения"
```

## 🔍 Проверка результата

### GitHub Release
- Перейдите в https://github.com/pl0schadka/qctq/releases
- Увидите новый релиз с .bin файлом

### Relay сервер
```bash
# Проверьте зарегистрированные версии
curl -X GET "http://84.201.179.109/firmware/versions"

# Проверьте доступность обновления
curl -X GET "http://84.201.179.109/firmware/check/QCTQ_6011?current_version=2.1.0"
```

### Админ-панель
- Откройте http://84.201.179.109/admin
- В разделе "Управление прошивками" увидите новую версию

## 🚨 Устранение неполадок

### Ошибка авторизации
```bash
gh auth login
```

### Ошибка создания релиза
```bash
# Проверьте права доступа к репозиторию
gh repo view pl0schadka/qctq
```

### Ошибка регистрации в relay
```bash
# Проверьте доступность сервера
curl -X GET "http://84.201.179.109/health"
```

## 🎯 Результат

После выполнения скрипта:

✅ **GitHub Release** создан с .bin файлом  
✅ **Relay сервер** зарегистрировал прошивку  
✅ **Устройства** автоматически обновятся  
✅ **OTA система** полностью работает  

## 📱 Тестирование OTA

1. **Подождите 5 минут** (устройство проверяет обновления каждые 5 минут)
2. **Проверьте Serial Monitor** - увидите логи OTA процесса
3. **На дисплее** появится "OTA Update..." во время обновления
4. **После перезагрузки** версия изменится на новую

## 🔄 Автоматизация

Можно настроить GitHub Actions для автоматической компиляции и загрузки при push тегов:

```yaml
# .github/workflows/release.yml
name: Auto Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: arduino/setup-arduino-cli@v1
      - run: arduino-cli compile --fqbn esp8266:esp8266:d1_mini qctq_relay_firmware
      - run: ./upload_release.sh ${{ github.ref_name#v }}
```

Теперь у вас есть полностью автоматизированная система OTA обновлений! 🚀
