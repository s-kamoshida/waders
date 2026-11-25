/**
 * サーバーの設定（ポート・データのフォルダ・認証の有効・無効・接続を受け付ける名前・画面と API を置くパス）の読み込みと検証。
 *
 * 所属: コンポジションルートの補助（main.ts と vite.config.ts から利用）
 * 責務:
 *  - データのフォルダに設定ファイルがなければ、リポジトリのひな形から作成する
 *  - 設定ファイルと環境変数を読み、検証して型付きの設定値にする（環境変数を優先する）
 * 設定ファイルはデプロイする人が手で編集するため、読み込むたびに Zod で検証する。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

/** 環境変数 WADERS_DATA_DIRECTORY がない場合に使う、作業フォルダからのデータのフォルダの名前。 */
export const DEFAULT_DATA_DIRECTORY_NAME = 'data';

/** データのフォルダの中にある設定ファイルの名前。 */
export const SETTINGS_FILE_NAME = 'settings.json';

/** データのフォルダの中にある DB ファイル（商品・認証）の名前。 */
export const DATABASE_FILE_NAME = 'waders.sqlite';

/** リポジトリに含める設定ファイルのひな形の場所。 */
export const SETTINGS_TEMPLATE_FILE_PATH = resolve(import.meta.dirname, '../../config/settings.example.json');

const portSchema = z.number().int().min(1).max(65535);

/** ホスト名（英数字とハイフンのラベルをドットでつないだもの。ポート・URL・空白は不可）。大文字・小文字は区別しないため小文字にする（issue #35）。 */
const hostNameSchema = z
  .string()
  .regex(/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i, 'ホスト名を書いてください（ポートや http:// は付けない）')
  .transform((value) => value.toLowerCase());

/** 画面と API を置くパスの既定（issue #39）。 */
export const DEFAULT_BASE_PATH = '/waders';

/**
 * 画面と API を置くパス。`""`（`/` の下）か、`/` で始まる区切りの並び（英数字と `-`・`_`・`.`・`~`。`.`・`..` だけの区切りは不可）。
 * 末尾の `/` や `/` だけの値は受け付けない（`/` の下は `""` だけで表す。issue #39）。
 */
const basePathSchema = z
  .string()
  .regex(/^(?:\/(?!\.{1,2}(?:\/|$))[A-Za-z0-9._~-]+)*$/, '"" か、/ で始まるパス（例: "/waders"）を書いてください（末尾に / は付けない）');

/**
 * 設定ファイルの形式（version 1）。
 * authenticationEnabled は issue #11 で追加した。この項目がない既存の設定ファイルは、認証を有効として扱う（安全側に倒す）。
 * allowedHosts・hostValidationEnabled は issue #35 で追加した。項目がなければ、追加で許す名前はなく、Host・Origin の確認は有効とする（安全側に倒す）。
 * basePath は issue #39 で追加した。項目がなければ /waders とする（更新するだけで新しい URL になる）。
 */
const settingsFileSchema = z.object({
  version: z.literal(1),
  port: portSchema,
  authenticationEnabled: z.boolean().default(true),
  allowedHosts: z.array(hostNameSchema).default([]),
  hostValidationEnabled: z.boolean().default(true),
  basePath: basePathSchema.default(DEFAULT_BASE_PATH),
});

/** 環境変数の認証の有効・無効。"true" か "false" だけを受け付ける（誤記で無効にならないようにする）。 */
const environmentBooleanSchema = z.enum(['true', 'false']).transform((value) => value === 'true');

/** 環境変数のポート。数字だけからなる文字列を受け付ける（"80.5" や空文字は不可）。 */
const environmentPortSchema = z
  .string()
  .regex(/^\d+$/)
  .transform((value) => Number(value))
  .pipe(portSchema);

/** 検証済みのサーバーの設定。 */
export type ServerSettings = {
  /** 待ち受けるポート番号（1〜65535）。 */
  readonly port: number;
  /** データのフォルダの絶対パス。 */
  readonly dataDirectory: string;
  /** 認証を有効にするか（issue #11）。 */
  readonly authenticationEnabled: boolean;
  /** Host ヘッダーで、既定（IP アドレス・localhost・*.local）のほかに許す名前（小文字。issue #35）。 */
  readonly allowedHosts: readonly string[];
  /** Host・Origin を確かめるか（DNS リバインディング対策。issue #35）。環境変数では切り替えない。 */
  readonly hostValidationEnabled: boolean;
  /** 画面と API を置くパス（`""` は `/` の下。末尾に `/` は付かない。issue #39）。環境変数では切り替えない。 */
  readonly basePath: string;
};

/** 設定ファイルや環境変数の内容に誤りがある場合のエラー。メッセージに誤りのある場所を含める。 */
export class ServerSettingsError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ServerSettingsError';
  }
}

/** loadServerSettings の引数。 */
export type LoadServerSettingsOptions = {
  /** 環境変数（通常は process.env）。WADERS_PORT・WADERS_DATA_DIRECTORY・WADERS_AUTHENTICATION_ENABLED を読む。 */
  readonly environment: Record<string, string | undefined>;
  /** 設定ファイルがない場合に複製するひな形の場所。 */
  readonly templateFilePath: string;
  /** 相対パスのデータのフォルダを解決する基準（通常は process.cwd()）。 */
  readonly workingDirectory: string;
};

/**
 * 設定を読み込む。設定ファイルがなければ、データのフォルダとともにひな形から作成する（所有者のみ読み書き可）。
 * 既存の設定ファイルは上書きしない。環境変数 WADERS_PORT・WADERS_AUTHENTICATION_ENABLED があれば、設定ファイルより優先する。
 * @returns 検証済みの設定
 * @throws {ServerSettingsError} 設定ファイルが JSON として読めない・形式に誤りがある、または環境変数の値が不正な場合
 */
export function loadServerSettings(options: LoadServerSettingsOptions): ServerSettings {
  const dataDirectory = resolve(
    options.workingDirectory,
    options.environment.WADERS_DATA_DIRECTORY ?? DEFAULT_DATA_DIRECTORY_NAME,
  );
  const settingsFilePath = join(dataDirectory, SETTINGS_FILE_NAME);
  createSettingsFileFromTemplateIfMissing(dataDirectory, settingsFilePath, options.templateFilePath);

  const settingsFile = readSettingsFile(settingsFilePath);
  const environmentPort = options.environment.WADERS_PORT;
  const port = environmentPort === undefined ? settingsFile.port : parseEnvironmentPort(environmentPort);
  const environmentAuthenticationEnabled = options.environment.WADERS_AUTHENTICATION_ENABLED;
  const authenticationEnabled =
    environmentAuthenticationEnabled === undefined
      ? settingsFile.authenticationEnabled
      : parseEnvironmentAuthenticationEnabled(environmentAuthenticationEnabled);
  return {
    port,
    dataDirectory,
    authenticationEnabled,
    allowedHosts: settingsFile.allowedHosts,
    hostValidationEnabled: settingsFile.hostValidationEnabled,
    basePath: settingsFile.basePath,
  };
}

/** 設定ファイルがなければ、データのフォルダを作り、ひな形を複製する。 */
function createSettingsFileFromTemplateIfMissing(
  dataDirectory: string,
  settingsFilePath: string,
  templateFilePath: string,
): void {
  if (existsSync(settingsFilePath)) return;
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  // flag 'wx': 同時に起動した別のプロセスが作成済みなら上書きせず失敗させる
  writeFileSync(settingsFilePath, readFileSync(templateFilePath, 'utf8'), { mode: 0o600, flag: 'wx' });
}

/** 設定ファイルを読み、JSON として解釈して形式を検証する。 */
function readSettingsFile(settingsFilePath: string): z.infer<typeof settingsFileSchema> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(readFileSync(settingsFilePath, 'utf8'));
  } catch (error) {
    throw new ServerSettingsError(`設定ファイルを JSON として読めません: ${settingsFilePath}`, { cause: error });
  }
  const result = settingsFileSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new ServerSettingsError(`設定ファイルの内容に誤りがあります: ${settingsFilePath}\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** 環境変数 WADERS_PORT を検証してポート番号にする。 */
function parseEnvironmentPort(value: string): number {
  const result = environmentPortSchema.safeParse(value);
  if (!result.success) {
    throw new ServerSettingsError(`環境変数 WADERS_PORT の値が不正です（1〜65535 の整数を指定してください）: "${value}"`);
  }
  return result.data;
}

/** 環境変数 WADERS_AUTHENTICATION_ENABLED を検証して真偽値にする。 */
function parseEnvironmentAuthenticationEnabled(value: string): boolean {
  const result = environmentBooleanSchema.safeParse(value);
  if (!result.success) {
    throw new ServerSettingsError(`環境変数 WADERS_AUTHENTICATION_ENABLED の値が不正です（true か false を指定してください）: "${value}"`);
  }
  return result.data;
}
