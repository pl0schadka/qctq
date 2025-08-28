const fs = require('fs').promises;
const path = require('path');

class DataStorage {
  constructor() {
    this.dataDir = './data';
    this.files = {
      answers: 'answers.json',
      questions: 'questions.json',
      deviceVersions: 'device-versions.json',
      firmwareConfig: 'firmware-config.json'
    };
  }

  async init() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
    } catch (error) {
      console.log('Data directory already exists');
    }
  }

  async loadData(filename) {
    try {
      const filePath = path.join(this.dataDir, filename);
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.log(`No existing data file for ${filename}, using defaults`);
      return this.getDefaultData(filename);
    }
  }

  async saveData(filename, data) {
    try {
      const filePath = path.join(this.dataDir, filename);
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`Error saving ${filename}:`, error);
    }
  }

  getDefaultData(filename) {
    switch (filename) {
      case 'answers.json':
        return [];
      case 'questions.json':
        return [];
      case 'device-versions.json':
        return {};
      case 'firmware-config.json':
        return {
          "qctq_relay": {
            "1.0.0": {
              "url": "https://github.com/user/qctq/releases/download/v1.0.0/qctq_relay_v1.0.0.bin",
              "size": 1024000,
              "checksum": "sha256:abc123...",
              "description": "Первая версия с relay поддержкой",
              "release_date": "2025-08-26"
            }
          }
        };
      default:
        return {};
    }
  }

  // Методы для работы с ответами
  async loadAnswers() {
    return await this.loadData(this.files.answers);
  }

  async saveAnswers(answers) {
    await this.saveData(this.files.answers, answers);
  }

  async addAnswer(answer) {
    const answers = await this.loadAnswers();
    answers.unshift(answer);
    
    // Ограничиваем историю 100 записями
    if (answers.length > 100) {
      answers.splice(100);
    }
    
    await this.saveAnswers(answers);
    return answers;
  }

  // Методы для работы с вопросами
  async loadQuestions() {
    return await this.loadData(this.files.questions);
  }

  async saveQuestions(questions) {
    await this.saveData(this.files.questions, questions);
  }

  async addQuestion(question) {
    const questions = await this.loadQuestions();
    questions.unshift(question);
    
    // Ограничиваем историю 50 записями
    if (questions.length > 50) {
      questions.splice(50);
    }
    
    await this.saveQuestions(questions);
    return questions;
  }

  // Методы для работы с версиями устройств
  async loadDeviceVersions() {
    return await this.loadData(this.files.deviceVersions);
  }

  async saveDeviceVersions(versions) {
    await this.saveData(this.files.deviceVersions, versions);
  }

  async updateDeviceVersion(deviceId, version) {
    const versions = await this.loadDeviceVersions();
    versions[deviceId] = version;
    await this.saveDeviceVersions(versions);
    return versions;
  }

  async updateDeviceActivity(deviceId) {
    const versions = await this.loadDeviceVersions();
    if (!versions[deviceId]) {
      versions[deviceId] = "1.0.0"; // Версия по умолчанию
    }
    
    // Добавляем информацию о последней активности
    if (!versions[`${deviceId}_last_seen`]) {
      versions[`${deviceId}_last_seen`] = new Date().toISOString();
    } else {
      versions[`${deviceId}_last_seen`] = new Date().toISOString();
    }
    
    await this.saveDeviceVersions(versions);
    return versions;
  }

  // Методы для работы с конфигурацией прошивок
  async loadFirmwareConfig() {
    return await this.loadData(this.files.firmwareConfig);
  }

  async saveFirmwareConfig(config) {
    await this.saveData(this.files.firmwareConfig, config);
  }

  async addFirmwareVersion(version, firmwareData) {
    const config = await this.loadFirmwareConfig();
    if (!config.qctq_relay) {
      config.qctq_relay = {};
    }
    config.qctq_relay[version] = firmwareData;
    await this.saveFirmwareConfig(config);
    return config;
  }

  async deleteFirmwareVersion(version) {
    const config = await this.loadFirmwareConfig();
    if (config.qctq_relay && config.qctq_relay[version]) {
      delete config.qctq_relay[version];
      await this.saveFirmwareConfig(config);
    }
    return config;
  }
}

module.exports = DataStorage;
