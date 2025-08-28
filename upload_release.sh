#!/bin/bash

# Скрипт для автоматической загрузки релизов на GitHub
# Использование: ./upload_release.sh <version> <description>

set -e

VERSION=$1
DESCRIPTION=$2

if [ -z "$VERSION" ]; then
    echo "Использование: $0 <version> <description>"
    echo "Пример: $0 2.1.0 'Улучшенная OTA система'"
    exit 1
fi

if [ -z "$DESCRIPTION" ]; then
    DESCRIPTION="Release $VERSION"
fi

echo "🚀 Создание релиза v$VERSION..."

# Проверяем, что папка с версией существует
if [ ! -d "releases/v$VERSION" ]; then
    echo "❌ Папка releases/v$VERSION не найдена!"
    exit 1
fi

# Проверяем наличие .bin файла
BIN_FILE="releases/v$VERSION/qctq_relay_firmware_v$VERSION.bin"
if [ ! -f "$BIN_FILE" ]; then
    echo "❌ Файл $BIN_FILE не найден!"
    exit 1
fi

# Проверяем наличие release_info.json
INFO_FILE="releases/v$VERSION/release_info.json"
if [ ! -f "$INFO_FILE" ]; then
    echo "❌ Файл $INFO_FILE не найден!"
    exit 1
fi

echo "✅ Файлы найдены:"
echo "   - $BIN_FILE"
echo "   - $INFO_FILE"

# Проверяем авторизацию GitHub CLI
if ! gh auth status >/dev/null 2>&1; then
    echo "🔐 Требуется авторизация GitHub CLI..."
    echo "Выполните: gh auth login"
    exit 1
fi

# Создаем релиз
echo "📦 Создание релиза на GitHub..."

# Читаем описание из release_info.json
RELEASE_DESCRIPTION=$(cat "$INFO_FILE" | jq -r '.description // empty')
CHANGES=$(cat "$INFO_FILE" | jq -r '.changes[]? // empty' | sed 's/^/- /')

# Формируем полное описание
FULL_DESCRIPTION="## $DESCRIPTION

$RELEASE_DESCRIPTION

### Изменения:
$CHANGES

### Файлы:
- \`qctq_relay_firmware_v$VERSION.bin\` - прошивка для Wemos D1 Mini
- \`release_info.json\` - информация о релизе

### Размер: $(stat -f%z "$BIN_FILE") bytes"

# Создаем релиз
gh release create "v$VERSION" \
    --title "QCTQ Relay Firmware v$VERSION" \
    --notes "$FULL_DESCRIPTION" \
    "$BIN_FILE" \
    "$INFO_FILE"

echo "✅ Релиз v$VERSION создан успешно!"

# Регистрируем в relay сервере
echo "🔗 Регистрация в relay сервере..."

# Читаем данные из release_info.json
SIZE=$(cat "$INFO_FILE" | jq -r '.firmware.size')
CHECKSUM=$(cat "$INFO_FILE" | jq -r '.firmware.checksum')
URL="https://github.com/pl0schadka/qctq/releases/download/v$VERSION/qctq_relay_firmware_v$VERSION.bin"

# Отправляем запрос на регистрацию
RESPONSE=$(curl -s -X POST "http://84.201.179.109/firmware/register" \
    -H "Content-Type: application/json" \
    -d "{
        \"version\": \"$VERSION\",
        \"url\": \"$URL\",
        \"size\": $SIZE,
        \"checksum\": \"$CHECKSUM\",
        \"description\": \"$RELEASE_DESCRIPTION\"
    }")

if echo "$RESPONSE" | jq -e '.ok' >/dev/null; then
    echo "✅ Прошивка зарегистрирована в relay сервере!"
else
    echo "❌ Ошибка регистрации: $RESPONSE"
fi

echo ""
echo "🎉 Релиз v$VERSION полностью готов!"
echo "📱 Устройства автоматически обновятся до новой версии"
echo "🌐 Проверить статус: http://84.201.179.109/admin"
