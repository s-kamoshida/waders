import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_DATA_DIRECTORY_NAME,
  SETTINGS_FILE_NAME,
  ServerSettingsError,
  loadServerSettings,
} from '../../server/serverSettings.ts';

/** リポジトリに含める設定ファイルのひな形。 */
const TEMPLATE_FILE_PATH = resolve(import.meta.dirname, '../../../config/settings.example.json');

let workingDirectory: string;
let dataDirectory: string;

beforeEach(() => {
  workingDirectory = mkdtempSync(join(tmpdir(), 'waders-settings-'));
  dataDirectory = join(workingDirectory, 'custom-data');
});

afterEach(() => {
  rmSync(workingDirectory, { recursive: true, force: true });
});

/** データのフォルダに設定ファイルを置く。 */
function writeSettingsFile(content: string): void {
  mkdirSync(dataDirectory, { recursive: true });
  writeFileSync(join(dataDirectory, SETTINGS_FILE_NAME), content);
}

/** テスト用のデータのフォルダを指定して設定を読み込む。 */
function loadWithEnvironment(environment: Record<string, string | undefined> = {}) {
  return loadServerSettings({
    environment: { WADERS_DATA_DIRECTORY: dataDirectory, ...environment },
    templateFilePath: TEMPLATE_FILE_PATH,
    workingDirectory,
  });
}

describe('設定ファイルがない場合', () => {
  it('データのフォルダがなければ作成し、ひな形から設定ファイルを作成する', () => {
    loadWithEnvironment();

    const settingsFilePath = join(dataDirectory, SETTINGS_FILE_NAME);
    expect(existsSync(settingsFilePath)).toBe(true);
    expect(readFileSync(settingsFilePath, 'utf8')).toBe(readFileSync(TEMPLATE_FILE_PATH, 'utf8'));
  });

  it('ひな形の既定のポート 8080 を使う', () => {
    expect(loadWithEnvironment().port).toBe(8080);
  });

  it('作成した設定ファイルは所有者だけが読み書きできる（0600）', () => {
    loadWithEnvironment();

    const permission = statSync(join(dataDirectory, SETTINGS_FILE_NAME)).mode & 0o777;
    expect(permission).toBe(0o600);
  });
});

describe('設定ファイルがある場合', () => {
  it('設定ファイルのポートを使う', () => {
    writeSettingsFile(JSON.stringify({ version: 1, port: 9090 }));

    expect(loadWithEnvironment().port).toBe(9090);
  });

  it('既存の設定ファイルをひな形で上書きしない', () => {
    const existingContent = JSON.stringify({ version: 1, port: 9090 });
    writeSettingsFile(existingContent);

    loadWithEnvironment();

    expect(readFileSync(join(dataDirectory, SETTINGS_FILE_NAME), 'utf8')).toBe(existingContent);
  });

  it('JSON として読めない場合、設定ファイルの場所を示すエラーにする', () => {
    writeSettingsFile('{ "port": 9090,');

    expect(() => loadWithEnvironment()).toThrow(ServerSettingsError);
    expect(() => loadWithEnvironment()).toThrow(SETTINGS_FILE_NAME);
  });

  it.each([
    ['0', 0],
    ['65536', 65536],
    ['小数', 8080.5],
    ['文字列', 'abc'],
  ])('ポートが不正（%s）の場合、エラーにする', (_label, port) => {
    writeSettingsFile(JSON.stringify({ version: 1, port }));

    expect(() => loadWithEnvironment()).toThrow(ServerSettingsError);
  });
});

describe('環境変数がある場合', () => {
  it('環境変数 WADERS_PORT のポートを、設定ファイルより優先する', () => {
    writeSettingsFile(JSON.stringify({ version: 1, port: 9090 }));

    expect(loadWithEnvironment({ WADERS_PORT: '7070' }).port).toBe(7070);
  });

  it.each(['0', '65536', 'abc', '80.5', ''])('環境変数 WADERS_PORT が不正（"%s"）の場合、エラーにする', (port) => {
    expect(() => loadWithEnvironment({ WADERS_PORT: port })).toThrow(ServerSettingsError);
  });

  it('環境変数 WADERS_DATA_DIRECTORY のフォルダを、データのフォルダとして使う', () => {
    expect(loadWithEnvironment().dataDirectory).toBe(dataDirectory);
  });
});

describe('環境変数 WADERS_DATA_DIRECTORY がない場合', () => {
  it('作業フォルダの既定のデータのフォルダを使い、そこに設定ファイルを作成する', () => {
    const settings = loadServerSettings({ environment: {}, templateFilePath: TEMPLATE_FILE_PATH, workingDirectory });

    const expectedDataDirectory = join(workingDirectory, DEFAULT_DATA_DIRECTORY_NAME);
    expect(settings.dataDirectory).toBe(expectedDataDirectory);
    expect(existsSync(join(expectedDataDirectory, SETTINGS_FILE_NAME))).toBe(true);
  });
});
