import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CATEGORY_TEMPLATE_FILE_PATH,
  CategoryDefinitionError,
  createCategoryDefinitionFile,
} from '../../../server/infrastructure/categoryDefinitionFile.ts';

let temporaryDirectory: string;
let definitionFilePath: string;
let generatedCount: number;

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'waders-categories-'));
  definitionFilePath = join(temporaryDirectory, 'categories.json');
  generatedCount = 0;
});

afterEach(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

/** ID を generated-1, generated-2, … の順に振る定義のファイルの操作を作る。 */
function createDefinition(generateCategoryId = vi.fn(() => `generated-${(generatedCount += 1)}`)) {
  return createCategoryDefinitionFile({ filePath: definitionFilePath, templateFilePath: CATEGORY_TEMPLATE_FILE_PATH, generateCategoryId });
}

/** 定義のファイルを書く。 */
function writeDefinition(content: unknown): void {
  writeFileSync(definitionFilePath, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`, { mode: 0o600 });
}

/** 定義のファイルの中身を JSON として読む。 */
function readDefinitionJson(): unknown {
  return JSON.parse(readFileSync(definitionFilePath, 'utf8'));
}

describe('定義のファイルの作成', () => {
  it('定義のファイルがない場合、ひな形から所有者だけが読み書きできる（0600）ファイルとして作成する', () => {
    createDefinition().createFromTemplateIfMissing();

    expect(statSync(definitionFilePath).mode & 0o777).toBe(0o600);
    expect(readDefinitionJson()).toEqual(JSON.parse(readFileSync(CATEGORY_TEMPLATE_FILE_PATH, 'utf8')));
  });

  it('ひな形から作った定義は、ひな形の並び順で「スケールフィギュア」「可動フィギュア」を読める', () => {
    const definition = createDefinition();
    definition.createFromTemplateIfMissing();

    expect(definition.readCategories().map((category) => category.name)).toEqual(['スケールフィギュア', '可動フィギュア']);
  });

  it('定義のファイルがある場合、上書きしない', () => {
    writeDefinition({ version: 1, categories: [{ id: 'plastic', name: 'プラモデル' }] });

    createDefinition().createFromTemplateIfMissing();

    expect(readDefinitionJson()).toEqual({ version: 1, categories: [{ id: 'plastic', name: 'プラモデル' }] });
  });
});

describe('定義の読み込み', () => {
  it('ファイルの並び順でカテゴリーを返し、名前の前後の空白は取り除く', () => {
    writeDefinition({
      version: 1,
      categories: [
        { id: 'scale', name: ' スケールフィギュア ' },
        { id: 'action', name: '可動フィギュア' },
      ],
    });

    expect(createDefinition().readCategories()).toEqual([
      { id: 'scale', name: 'スケールフィギュア' },
      { id: 'action', name: '可動フィギュア' },
    ]);
  });

  it('ID のないカテゴリーに ID を付けてファイルに書き戻し、ほかのカテゴリーの ID・名前・並び順は変えない', () => {
    writeDefinition({
      version: 1,
      categories: [{ id: 'scale', name: 'スケールフィギュア' }, { name: 'プラモデル' }, { id: 'action', name: '可動フィギュア' }],
    });

    const categories = createDefinition().readCategories();

    const expected = [
      { id: 'scale', name: 'スケールフィギュア' },
      { id: 'generated-1', name: 'プラモデル' },
      { id: 'action', name: '可動フィギュア' },
    ];
    expect(categories).toEqual(expected);
    expect(readDefinitionJson()).toEqual({ version: 1, categories: expected });
    expect(statSync(definitionFilePath).mode & 0o777).toBe(0o600);
    expect(readdirSync(temporaryDirectory)).toEqual(['categories.json']);
  });

  it('付けた ID は次に読んだときも変わらない', () => {
    writeDefinition({ version: 1, categories: [{ name: 'プラモデル' }] });
    const generateCategoryId = vi.fn(() => `generated-${(generatedCount += 1)}`);
    const definition = createDefinition(generateCategoryId);

    const first = definition.readCategories();
    const second = definition.readCategories();

    expect(second).toEqual(first);
    expect(generateCategoryId).toHaveBeenCalledTimes(1);
  });

  it('すべてのカテゴリーに ID がある場合、ファイルを書き換えない', () => {
    const content = '{"version":1,"categories":[{"id":"scale","name":"スケールフィギュア"}]}';
    writeDefinition(content);

    createDefinition().readCategories();

    expect(readFileSync(definitionFilePath, 'utf8')).toBe(content);
  });

  it('手で書き換えた内容を、読み込むたびに反映する', () => {
    writeDefinition({ version: 1, categories: [{ id: 'scale', name: 'スケールフィギュア' }] });
    const definition = createDefinition();
    definition.readCategories();

    writeDefinition({ version: 1, categories: [{ id: 'scale', name: 'スケール' }] });

    expect(definition.readCategories()).toEqual([{ id: 'scale', name: 'スケール' }]);
  });
});

describe('誤りのある定義のファイル', () => {
  it.each([
    ['JSON として読めない', '{"version":1,"categories":[{"name":"スケールフィギュア"},]}'],
    ['形式の版が違う', { version: 2, categories: [] }],
    ['categories がない', { version: 1 }],
    ['名前がない', { version: 1, categories: [{ id: 'scale' }] }],
    ['名前が空白だけ', { version: 1, categories: [{ id: 'scale', name: '  ' }] }],
    ['名前が 50 文字を超える', { version: 1, categories: [{ id: 'scale', name: 'あ'.repeat(51) }] }],
    ['ID が空', { version: 1, categories: [{ id: '', name: 'スケールフィギュア' }] }],
    ['ID が 100 文字を超える', { version: 1, categories: [{ id: 'a'.repeat(101), name: 'スケールフィギュア' }] }],
    [
      '名前が重複している（ID のないカテゴリーを含む）',
      { version: 1, categories: [{ id: 'scale', name: 'スケールフィギュア' }, { name: 'スケールフィギュア ' }] },
    ],
    [
      'ID が重複している',
      { version: 1, categories: [{ id: 'scale', name: 'スケールフィギュア' }, { id: 'scale', name: '可動フィギュア' }] },
    ],
  ])('%s場合、ファイル名と理由を含む CategoryDefinitionError にし、ファイルを書き換えない', (_label, content) => {
    writeDefinition(content);
    const before = readFileSync(definitionFilePath, 'utf8');

    expect(() => createDefinition().readCategories()).toThrow(CategoryDefinitionError);
    expect(() => createDefinition().readCategories()).toThrow(/categories\.json/);
    expect(readFileSync(definitionFilePath, 'utf8')).toBe(before);
  });

  it('定義のファイルがない場合（起動後に削除された場合など）、CategoryDefinitionError にし、ファイルを作らない', () => {
    expect(() => createDefinition().readCategories()).toThrow(CategoryDefinitionError);
    expect(readdirSync(temporaryDirectory)).toEqual([]);
  });
});
