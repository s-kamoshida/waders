import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CategoryAlreadyDefinedError, CategoryNameDuplicateError, CategoryNotFoundError } from '../../../server/domain/category.ts';
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

/** 項目の指定がないカテゴリーで有効な、選べる項目（既定。issue #27）。 */
const DEFAULT_ENABLED_FIELDS = ['shippingFee', 'maker', 'orderDeadline', 'cancelable'];

/** カテゴリーの ID と名前に、既定の項目の設定を付ける（読み込んだカテゴリーの期待値。issue #27）。 */
function withDefaultFieldSettings(category: { id: string; name: string }) {
  return { ...category, fields: DEFAULT_ENABLED_FIELDS, otherExpenseLabel: 'その他費用' };
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
      withDefaultFieldSettings({ id: 'scale', name: 'スケールフィギュア' }),
      withDefaultFieldSettings({ id: 'action', name: '可動フィギュア' }),
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
    expect(categories).toEqual(expected.map(withDefaultFieldSettings));
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

    expect(definition.readCategories()).toEqual([withDefaultFieldSettings({ id: 'scale', name: 'スケール' })]);
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

describe('定義の変更（カテゴリーの管理。issue #10）', () => {
  it('カテゴリーを追加した場合、ID を付けて定義の末尾に加え、追加したカテゴリーを返す（0600 のまま、一時ファイルを残さない）', () => {
    writeDefinition({ version: 1, categories: [{ id: 'scale', name: 'スケールフィギュア' }] });

    const added = createDefinition().addCategory('プラモデル');

    expect(added).toEqual(withDefaultFieldSettings({ id: 'generated-1', name: 'プラモデル' }));
    expect(readDefinitionJson()).toEqual({
      version: 1,
      categories: [
        { id: 'scale', name: 'スケールフィギュア' },
        { id: 'generated-1', name: 'プラモデル' },
      ],
    });
    expect(statSync(definitionFilePath).mode & 0o777).toBe(0o600);
    expect(readdirSync(temporaryDirectory)).toEqual(['categories.json']);
  });

  it('ID を指定して追加した場合（定義にないカテゴリーを定義に戻す場合）、その ID で末尾に加える', () => {
    writeDefinition({ version: 1, categories: [{ id: 'scale', name: 'スケールフィギュア' }] });

    const added = createDefinition().addCategory('プライズ', 'legacy:プライズ');

    expect(added).toEqual(withDefaultFieldSettings({ id: 'legacy:プライズ', name: 'プライズ' }));
    expect(createDefinition().readCategories()).toEqual([
      withDefaultFieldSettings({ id: 'scale', name: 'スケールフィギュア' }),
      withDefaultFieldSettings({ id: 'legacy:プライズ', name: 'プライズ' }),
    ]);
  });

  it('変更は、変更する時点の最新の定義のファイルに対して行い、手で編集した内容（ID のないカテゴリー・ほかの項目）を残す', () => {
    writeDefinition({ version: 1, categories: [{ id: 'scale', name: 'スケールフィギュア' }] });
    const definition = createDefinition();
    definition.readCategories();
    writeDefinition({
      version: 1,
      categories: [{ id: 'scale', name: 'スケール', memo: '手で書いたメモ' }, { name: '手で追加した' }],
    });

    definition.addCategory('プラモデル');

    expect(readDefinitionJson()).toEqual({
      version: 1,
      categories: [
        { id: 'scale', name: 'スケール', memo: '手で書いたメモ' },
        { id: 'generated-1', name: '手で追加した' },
        { id: 'generated-2', name: 'プラモデル' },
      ],
    });
  });

  it('追加する名前が定義のカテゴリーと重なる場合、CategoryNameDuplicateError にし、ファイルを書き換えない', () => {
    writeDefinition({ version: 1, categories: [{ id: 'scale', name: 'スケールフィギュア' }] });
    const before = readFileSync(definitionFilePath, 'utf8');

    expect(() => createDefinition().addCategory('スケールフィギュア')).toThrow(CategoryNameDuplicateError);
    expect(readFileSync(definitionFilePath, 'utf8')).toBe(before);
  });

  it('指定した ID がすでに定義にある場合、CategoryAlreadyDefinedError にし、ファイルを書き換えない', () => {
    writeDefinition({ version: 1, categories: [{ id: 'scale', name: 'スケールフィギュア' }] });
    const before = readFileSync(definitionFilePath, 'utf8');

    expect(() => createDefinition().addCategory('別の名前', 'scale')).toThrow(CategoryAlreadyDefinedError);
    expect(readFileSync(definitionFilePath, 'utf8')).toBe(before);
  });

  it('改名した場合、そのカテゴリーの名前だけを変え、ID・並び順・ほかの項目は変えない', () => {
    writeDefinition({
      version: 1,
      categories: [
        { id: 'scale', name: 'スケールフィギュア', memo: 'メモ' },
        { id: 'action', name: '可動フィギュア' },
      ],
    });

    const renamed = createDefinition().renameCategory('scale', 'スケール');

    expect(renamed).toEqual(withDefaultFieldSettings({ id: 'scale', name: 'スケール' }));
    expect(readDefinitionJson()).toEqual({
      version: 1,
      categories: [
        { id: 'scale', name: 'スケール', memo: 'メモ' },
        { id: 'action', name: '可動フィギュア' },
      ],
    });
  });

  it('今と同じ名前に改名した場合は、エラーにしない', () => {
    writeDefinition({ version: 1, categories: [{ id: 'scale', name: 'スケールフィギュア' }] });

    expect(createDefinition().renameCategory('scale', 'スケールフィギュア')).toEqual(
      withDefaultFieldSettings({ id: 'scale', name: 'スケールフィギュア' }),
    );
  });

  it('ほかのカテゴリーと同じ名前に改名しようとした場合、CategoryNameDuplicateError にし、ファイルを書き換えない', () => {
    writeDefinition({
      version: 1,
      categories: [
        { id: 'scale', name: 'スケールフィギュア' },
        { id: 'action', name: '可動フィギュア' },
      ],
    });
    const before = readFileSync(definitionFilePath, 'utf8');

    expect(() => createDefinition().renameCategory('scale', '可動フィギュア')).toThrow(CategoryNameDuplicateError);
    expect(readFileSync(definitionFilePath, 'utf8')).toBe(before);
  });

  it('削除した場合、そのカテゴリーだけを定義から取り除き、ほかの並び順は変えない', () => {
    writeDefinition({
      version: 1,
      categories: [
        { id: 'scale', name: 'スケールフィギュア' },
        { id: 'action', name: '可動フィギュア' },
        { id: 'plastic', name: 'プラモデル' },
      ],
    });

    createDefinition().deleteCategory('action');

    expect(readDefinitionJson()).toEqual({
      version: 1,
      categories: [
        { id: 'scale', name: 'スケールフィギュア' },
        { id: 'plastic', name: 'プラモデル' },
      ],
    });
  });

  it.each([
    ['改名', (definition: ReturnType<typeof createDefinition>) => definition.renameCategory('missing', '新しい名前')],
    ['削除', (definition: ReturnType<typeof createDefinition>) => definition.deleteCategory('missing')],
  ])('%sするカテゴリーが最新の定義にない場合（手で消された場合など）、CategoryNotFoundError にし、ファイルを書き換えない', (_label, operate) => {
    writeDefinition({ version: 1, categories: [{ id: 'scale', name: 'スケールフィギュア' }] });
    const before = readFileSync(definitionFilePath, 'utf8');

    expect(() => operate(createDefinition())).toThrow(CategoryNotFoundError);
    expect(readFileSync(definitionFilePath, 'utf8')).toBe(before);
  });

  it.each([
    ['追加', (definition: ReturnType<typeof createDefinition>) => definition.addCategory('プラモデル')],
    ['改名', (definition: ReturnType<typeof createDefinition>) => definition.renameCategory('scale', 'スケール')],
    ['削除', (definition: ReturnType<typeof createDefinition>) => definition.deleteCategory('scale')],
  ])('定義のファイルに誤りがある場合、%sは CategoryDefinitionError にし、壊れたファイルを書き換えない', (_label, operate) => {
    writeDefinition('{"version":1,"categories":[{"id":"scale","name":"スケールフィギュア"},]}');
    const before = readFileSync(definitionFilePath, 'utf8');

    expect(() => operate(createDefinition())).toThrow(CategoryDefinitionError);
    expect(readFileSync(definitionFilePath, 'utf8')).toBe(before);
  });
});

describe('カテゴリーごとの入力項目（issue #27）', () => {
  it('ひな形の初期のカテゴリーは、送料・メーカー・受注期限・キャンセル可否を有効、場所・手数料・交通費・その他費用を無効とし、項目の指定を書いておく', () => {
    const template = JSON.parse(readFileSync(CATEGORY_TEMPLATE_FILE_PATH, 'utf8')) as { version: number; categories: { fields?: unknown }[] };
    const definition = createDefinition();
    definition.createFromTemplateIfMissing();

    expect(template.version).toBe(1);
    expect(template.categories.map((category) => category.fields)).toEqual([DEFAULT_ENABLED_FIELDS, DEFAULT_ENABLED_FIELDS]);
    expect(definition.readCategories().map(({ fields, otherExpenseLabel }) => ({ fields, otherExpenseLabel }))).toEqual([
      { fields: DEFAULT_ENABLED_FIELDS, otherExpenseLabel: 'その他費用' },
      { fields: DEFAULT_ENABLED_FIELDS, otherExpenseLabel: 'その他費用' },
    ]);
  });

  it('項目の指定がない今までの定義のファイル（version 1）は、そのまま読め、既存の項目を有効・追加の項目を無効とし、ファイルを書き換えない', () => {
    const content = '{"version":1,"categories":[{"id":"scale","name":"スケールフィギュア"}]}';
    writeDefinition(content);

    expect(createDefinition().readCategories()).toEqual([withDefaultFieldSettings({ id: 'scale', name: 'スケールフィギュア' })]);
    expect(readFileSync(definitionFilePath, 'utf8')).toBe(content);
  });

  it('項目の指定と「その他費用」の名前がある場合、その設定で読む（項目は決まった順に並べ、名前の前後の空白は取り除く）', () => {
    writeDefinition({
      version: 1,
      categories: [
        { id: 'ticket', name: '電子チケット', fields: ['otherExpense', 'location', 'travelExpense', 'handlingFee'], otherExpenseLabel: ' ドリンク代 ' },
      ],
    });

    expect(createDefinition().readCategories()).toEqual([
      {
        id: 'ticket',
        name: '電子チケット',
        fields: ['location', 'handlingFee', 'travelExpense', 'otherExpense'],
        otherExpenseLabel: 'ドリンク代',
      },
    ]);
  });

  it('開催日時と終了日時は 1 組の項目（eventPeriod）として指定でき、場所の次の順に並べる（PR #30 のレビュー）', () => {
    writeDefinition({ version: 1, categories: [{ id: 'ticket', name: '電子チケット', fields: ['otherExpense', 'eventPeriod', 'location'] }] });

    expect(createDefinition().readCategories()[0]?.fields).toEqual(['location', 'eventPeriod', 'otherExpense']);
  });

  it('開催日時と終了日時を個別の項目の名前で指定した場合は、定義の誤りとする', () => {
    writeDefinition({ version: 1, categories: [{ id: 'ticket', name: '電子チケット', fields: ['eventStartsAt'] }] });

    expect(() => createDefinition().readCategories()).toThrow(CategoryDefinitionError);
  });

  it('項目の指定が空の場合、選べる項目をすべて無効とする', () => {
    writeDefinition({ version: 1, categories: [{ id: 'simple', name: '簡易', fields: [] }] });

    expect(createDefinition().readCategories()[0]?.fields).toEqual([]);
  });

  it('ID のないカテゴリーに ID を付けて書き戻す場合も、項目の指定と「その他費用」の名前は変えない', () => {
    writeDefinition({ version: 1, categories: [{ name: '電子チケット', fields: ['location'], otherExpenseLabel: 'ドリンク代' }] });

    createDefinition().readCategories();

    expect(readDefinitionJson()).toEqual({
      version: 1,
      categories: [{ id: 'generated-1', name: '電子チケット', fields: ['location'], otherExpenseLabel: 'ドリンク代' }],
    });
  });

  it.each([
    ['項目の指定に知らない項目の名前がある', { version: 1, categories: [{ id: 'ticket', name: '電子チケット', fields: ['seat'] }] }],
    ['常に入力する項目（金額）を項目の指定に書いた', { version: 1, categories: [{ id: 'ticket', name: '電子チケット', fields: ['price'] }] }],
    ['項目の指定が配列でない', { version: 1, categories: [{ id: 'ticket', name: '電子チケット', fields: 'location' }] }],
    ['「その他費用」の名前が空白だけ', { version: 1, categories: [{ id: 'ticket', name: '電子チケット', otherExpenseLabel: '  ' }] }],
    ['「その他費用」の名前が 20 文字を超える', { version: 1, categories: [{ id: 'ticket', name: '電子チケット', otherExpenseLabel: 'あ'.repeat(21) }] }],
    ['「その他費用」の名前が文字列でない', { version: 1, categories: [{ id: 'ticket', name: '電子チケット', otherExpenseLabel: 1 }] }],
  ])('%s場合、ファイル名と理由を含む CategoryDefinitionError にし、ファイルを書き換えない', (_label, content) => {
    writeDefinition(content);
    const before = readFileSync(definitionFilePath, 'utf8');

    expect(() => createDefinition().readCategories()).toThrow(CategoryDefinitionError);
    expect(() => createDefinition().readCategories()).toThrow(/categories\.json/);
    expect(readFileSync(definitionFilePath, 'utf8')).toBe(before);
  });

  it('「その他費用」の名前は 20 文字までは受け付ける', () => {
    writeDefinition({ version: 1, categories: [{ id: 'ticket', name: '電子チケット', otherExpenseLabel: 'あ'.repeat(20) }] });

    expect(createDefinition().readCategories()[0]?.otherExpenseLabel).toBe('あ'.repeat(20));
  });

  it('画面で追加したカテゴリーは、既定の項目の設定とし、項目の指定はファイルに書かない', () => {
    writeDefinition({ version: 1, categories: [] });

    const added = createDefinition().addCategory('プラモデル');

    expect(added).toEqual(withDefaultFieldSettings({ id: 'generated-1', name: 'プラモデル' }));
    expect(readDefinitionJson()).toEqual({ version: 1, categories: [{ id: 'generated-1', name: 'プラモデル' }] });
  });

  it('改名した場合、項目の指定と「その他費用」の名前は変えない', () => {
    writeDefinition({ version: 1, categories: [{ id: 'ticket', name: '電子チケット', fields: ['location'], otherExpenseLabel: 'ドリンク代' }] });

    const renamed = createDefinition().renameCategory('ticket', 'ライブ');

    expect(renamed).toEqual({ id: 'ticket', name: 'ライブ', fields: ['location'], otherExpenseLabel: 'ドリンク代' });
    expect(readDefinitionJson()).toEqual({
      version: 1,
      categories: [{ id: 'ticket', name: 'ライブ', fields: ['location'], otherExpenseLabel: 'ドリンク代' }],
    });
  });

  describe('項目の設定の変更', () => {
    it('項目を有効・無効にした場合、変えた項目だけを反映した項目の指定を決まった順で書き、変更したカテゴリーを返す（0600 のまま、一時ファイルを残さない）', () => {
      writeDefinition({ version: 1, categories: [{ id: 'scale', name: 'スケールフィギュア' }, { id: 'action', name: '可動フィギュア' }] });

      const updated = createDefinition().updateCategoryFieldSettings('action', { fields: { location: true, shippingFee: false } });

      const expectedFields = ['maker', 'orderDeadline', 'cancelable', 'location'];
      expect(updated).toEqual({ id: 'action', name: '可動フィギュア', fields: expectedFields, otherExpenseLabel: 'その他費用' });
      expect(readDefinitionJson()).toEqual({
        version: 1,
        categories: [
          { id: 'scale', name: 'スケールフィギュア' },
          { id: 'action', name: '可動フィギュア', fields: expectedFields },
        ],
      });
      expect(statSync(definitionFilePath).mode & 0o777).toBe(0o600);
      expect(readdirSync(temporaryDirectory)).toEqual(['categories.json']);
    });

    it('「その他費用」の名前を変えた場合、前後の空白を除いて書き、項目の指定は変えない', () => {
      writeDefinition({ version: 1, categories: [{ id: 'ticket', name: '電子チケット', fields: ['otherExpense'] }] });

      const updated = createDefinition().updateCategoryFieldSettings('ticket', { otherExpenseLabel: ' ドリンク代 ' });

      expect(updated).toEqual({ id: 'ticket', name: '電子チケット', fields: ['otherExpense'], otherExpenseLabel: 'ドリンク代' });
      expect(readDefinitionJson()).toEqual({
        version: 1,
        categories: [{ id: 'ticket', name: '電子チケット', fields: ['otherExpense'], otherExpenseLabel: 'ドリンク代' }],
      });
    });

    it('「その他費用」の名前に null を指定した場合、名前をファイルから取り除き、「その他費用」に戻す', () => {
      writeDefinition({ version: 1, categories: [{ id: 'ticket', name: '電子チケット', fields: ['otherExpense'], otherExpenseLabel: 'ドリンク代' }] });

      const updated = createDefinition().updateCategoryFieldSettings('ticket', { otherExpenseLabel: null });

      expect(updated.otherExpenseLabel).toBe('その他費用');
      expect(readDefinitionJson()).toEqual({ version: 1, categories: [{ id: 'ticket', name: '電子チケット', fields: ['otherExpense'] }] });
    });

    it('変更は、変更する時点の最新の定義のファイルに対して行い、手で編集した内容（ID のないカテゴリー・ほかの項目）を残す', () => {
      writeDefinition({ version: 1, categories: [{ id: 'ticket', name: '電子チケット', fields: ['location'] }] });
      const definition = createDefinition();
      definition.readCategories();
      writeDefinition({
        version: 1,
        categories: [{ id: 'ticket', name: 'ライブ', fields: ['location', 'handlingFee'], memo: '手で書いたメモ' }, { name: '手で追加した' }],
      });

      definition.updateCategoryFieldSettings('ticket', { fields: { travelExpense: true } });

      expect(readDefinitionJson()).toEqual({
        version: 1,
        categories: [
          { id: 'ticket', name: 'ライブ', fields: ['location', 'handlingFee', 'travelExpense'], memo: '手で書いたメモ' },
          { id: 'generated-1', name: '手で追加した' },
        ],
      });
    });

    it('カテゴリーが最新の定義にない場合、CategoryNotFoundError にし、ファイルを書き換えない', () => {
      writeDefinition({ version: 1, categories: [{ id: 'scale', name: 'スケールフィギュア' }] });
      const before = readFileSync(definitionFilePath, 'utf8');

      expect(() => createDefinition().updateCategoryFieldSettings('missing', { fields: { location: true } })).toThrow(CategoryNotFoundError);
      expect(readFileSync(definitionFilePath, 'utf8')).toBe(before);
    });

    it('定義のファイルに誤りがある場合、CategoryDefinitionError にし、壊れたファイルを書き換えない', () => {
      writeDefinition('{"version":1,"categories":[{"id":"scale","name":"スケールフィギュア"},]}');
      const before = readFileSync(definitionFilePath, 'utf8');

      expect(() => createDefinition().updateCategoryFieldSettings('scale', { fields: { location: true } })).toThrow(CategoryDefinitionError);
      expect(readFileSync(definitionFilePath, 'utf8')).toBe(before);
    });
  });
});
