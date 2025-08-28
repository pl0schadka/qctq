# Project settings
PORT := /dev/tty.usbserial-110
BAUD := 460800
MONITOR_BAUD := 115200
FQBN := esp8266:esp8266:d1_mini
SKETCH := /Users/shorc/qctq
BUILD_DIR := /Users/shorc/qctq/build
BIN := $(BUILD_DIR)/qctq.ino.bin

# Default target
all: compile flash

compile:
	arduino-cli compile --fqbn $(FQBN) $(SKETCH) --output-dir $(BUILD_DIR) --export-binaries

flash: compile
	esptool --port $(PORT) --baud $(BAUD) --before default_reset --after hard_reset write-flash --erase-all --flash-mode dio --flash-freq 40m --flash-size detect 0x00000 $(BIN)

monitor:
	python3 - << 'PY'
import sys, time, serial
port = '$(PORT)'
baud = $(MONITOR_BAUD)
try:
    ser = serial.Serial(port, baud, timeout=0.2)
    print(f'--- Serial monitor {port} @ {baud} ---', flush=True)
    while True:
        try:
            data = ser.read(1024)
            if data:
                try:
                    sys.stdout.write(data.decode('utf-8', errors='replace'))
                    sys.stdout.flush()
                except Exception:
                    sys.stdout.buffer.write(data)
                    sys.stdout.flush()
        except KeyboardInterrupt:
            break
except Exception as e:
    print('Error:', e)
PY

.PHONY: all compile flash monitor
