# 🚀 Настройка GitHub для OTA обновлений

## 📋 Пошаговая инструкция

### 1. Подготовка репозитория

1. **Перейдите в ваш репозиторий:** https://github.com/pl0schadka/qctq
2. **Убедитесь, что репозиторий публичный** (для бесплатных releases)
3. **Скопируйте все файлы** из локальной папки в репозиторий

### 2. Создание Release v2.0.0

1. **Перейдите в раздел "Releases"** в вашем репозитории
2. **Нажмите "Create a new release"**
3. **Заполните информацию:**
   - **Tag version:** `v2.0.0`
   - **Release title:** `QCTQ Relay Firmware v2.0.0`
   - **Description:**
   ```
   ## Базовая версия с relay сервером и OTA поддержкой
   
   ### Изменения:
   - ✅ Добавлена поддержка tg-relay сервера
   - ✅ Реализована система OTA обновлений
   - ✅ Добавлена поддержка множественных устройств
   - ✅ Улучшена стабильность WiFi подключения
   - ✅ Добавлена поддержка викторин через Telegram
   - ✅ Реализован режим квеста с перемычкой
   - ✅ Добавлен WiFi Manager с AP режимом
   
   ### Файлы:
   - `qctq_relay_firmware_v2.0.0.bin` - прошивка для Wemos D1 Mini
   - `release_info.json` - информация о релизе
   
   ### Размер: 456KB
   ### SHA256: 54eda4f244aec00bc64865b08fb9f140509b2cd29a5e789b0c00845b7b2794f2
   ```

4. **Загрузите файлы:**
   - `releases/v2.0.0/qctq_relay_firmware_v2.0.0.bin`
   - `releases/v2.0.0/release_info.json`

5. **Нажмите "Publish release"**

### 3. Проверка OTA системы

После создания release протестируйте OTA:

```bash
# Проверка обновлений
curl -X GET "http://84.201.179.109/firmware/check/QCTQ_TEST_DEVICE?current_version=1.0.0"

# Ожидаемый ответ:
{
  "ok": true,
  "update_available": true,
  "current_version": "1.0.0",
  "latest_version": "2.0.0",
  "firmware_url": "https://github.com/pl0schadka/qctq/releases/download/v2.0.0/qctq_relay_firmware_v2.0.0.bin",
  "firmware_size": 456352,
  "firmware_checksum": "sha256:54eda4f244aec00bc64865b08fb9f140509b2cd29a5e789b0c00845b7b2794f2",
  "description": "Базовая версия с relay сервером и OTA поддержкой"
}
```

### 4. Создание новых версий

Для создания новой версии:

1. **Обновите версию в прошивке:**
   ```cpp
   #define FIRMWARE_VERSION "2.1.0"
   ```

2. **Скомпилируйте прошивку:**
   ```bash
   cd qctq_relay_firmware
   arduino-cli compile --fqbn esp8266:esp8266:d1_mini . --output-dir ./build
   ```

3. **Создайте папку для новой версии:**
   ```bash
   mkdir -p releases/v2.1.0
   cp build/qctq_relay_firmware.ino.bin releases/v2.1.0/qctq_relay_firmware_v2.1.0.bin
   ```

4. **Вычислите хеш:**
   ```bash
   shasum -a 256 releases/v2.1.0/qctq_relay_firmware_v2.1.0.bin
   ```

5. **Создайте release_info.json:**
   ```json
   {
     "version": "2.1.0",
     "release_date": "2025-08-28",
     "description": "Улучшенная OTA система",
     "changes": [
       "Исправлена логика проверки обновлений",
       "Добавлено отображение процесса обновления",
       "Улучшена обработка ошибок"
     ],
     "firmware": {
       "filename": "qctq_relay_firmware_v2.1.0.bin",
       "size": 456352,
       "checksum": "sha256:NEW_HASH_HERE",
       "url": "https://github.com/pl0schadka/qctq/releases/download/v2.1.0/qctq_relay_firmware_v2.1.0.bin"
     }
   }
   ```

6. **Создайте GitHub Release v2.1.0**

7. **Зарегистрируйте в relay сервере:**
   ```bash
   curl -X POST "http://84.201.179.109/firmware/register" \
     -H "Content-Type: application/json" \
     -d '{
       "version": "2.1.0",
       "url": "https://github.com/pl0schadka/qctq/releases/download/v2.1.0/qctq_relay_firmware_v2.1.0.bin",
       "size": 456352,
       "checksum": "sha256:NEW_HASH_HERE",
       "description": "Улучшенная OTA система"
     }'
   ```

## 🔧 Автоматизация

### GitHub Actions (опционально)

Можно настроить автоматическую компиляцию при push:

```yaml
# .github/workflows/build.yml
name: Build Firmware

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: arduino/setup-arduino-cli@v1
      - run: arduino-cli compile --fqbn esp8266:esp8266:d1_mini qctq_relay_firmware --output-dir ./build
      - run: |
          mkdir -p releases/${{ github.ref_name }}
          cp build/qctq_relay_firmware.ino.bin releases/${{ github.ref_name }}/qctq_relay_firmware_${{ github.ref_name }}.bin
      - uses: actions/upload-artifact@v2
        with:
          name: firmware-${{ github.ref_name }}
          path: releases/${{ github.ref_name }}/
```

## 📊 Мониторинг

### Проверка статуса OTA:

```bash
# Список всех версий
curl -X GET "http://84.201.179.109/firmware/versions"

# Статус устройств
curl -X GET "http://84.201.179.109/admin" | grep -A 10 "Версии устройств"
```

### Логи OTA:

В админ-панели http://84.201.179.109/admin доступна секция "Управление прошивками" с:
- Списком всех версий
- Статусом устройств
- Возможностью проверки обновлений
- Удалением устаревших версий

## 🎯 Результат

После настройки у вас будет:

✅ **Автоматические OTA обновления** для всех 12 устройств  
✅ **Централизованное управление** прошивками через relay сервер  
✅ **Безопасные обновления** с проверкой хеша  
✅ **Веб-интерфейс** для мониторинга и управления  
✅ **GitHub Releases** для хранения прошивок  

Теперь все устройства будут автоматически обновляться до последней версии! 🚀
