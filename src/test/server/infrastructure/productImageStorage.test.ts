import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProductImageStorage } from '../../../server/infrastructure/productImageStorage.ts';

let temporaryDirectory: string;
let imageDirectory: string;

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'waders-image-storage-'));
  imageDirectory = join(temporaryDirectory, 'images');
});

afterEach(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 5, 6]);

/** 保存するファイルの名前の形（乱数の UUID と、形式から決めた拡張子）。 */
const IMAGE_FILE_NAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

describe('商品の画像の保存（issue #41）', () => {
  it('保存した場合、乱数の名前と形式の拡張子でファイルを作り、その名前を返す', () => {
    const storage = createProductImageStorage({ directory: imageDirectory });

    const fileName = storage.saveImage(JPEG_BYTES, 'jpeg');

    expect(fileName).toMatch(IMAGE_FILE_NAME_PATTERN);
    expect(fileName.endsWith('.jpg')).toBe(true);
    expect(readdirSync(imageDirectory)).toEqual([fileName]);
  });

  it.each([
    ['png', '.png'],
    ['webp', '.webp'],
  ] as const)('形式が %s の場合、拡張子を %s にする', (format, extension) => {
    const storage = createProductImageStorage({ directory: imageDirectory });

    expect(storage.saveImage(PNG_BYTES, format).endsWith(extension)).toBe(true);
  });

  it('同じ中身を2回保存しても、別の名前にする', () => {
    const storage = createProductImageStorage({ directory: imageDirectory });

    expect(storage.saveImage(JPEG_BYTES, 'jpeg')).not.toBe(storage.saveImage(JPEG_BYTES, 'jpeg'));
  });

  it('保存するフォルダがなければ所有者だけが使えるフォルダ（0700）を作り、ファイルは所有者だけが読み書きできる（0600）', () => {
    const storage = createProductImageStorage({ directory: imageDirectory });

    const fileName = storage.saveImage(JPEG_BYTES, 'jpeg');

    expect(statSync(imageDirectory).mode & 0o777).toBe(0o700);
    expect(statSync(join(imageDirectory, fileName)).mode & 0o777).toBe(0o600);
  });

  it('保存した名前で読むと、同じ中身と形式を返す', () => {
    const storage = createProductImageStorage({ directory: imageDirectory });
    const fileName = storage.saveImage(PNG_BYTES, 'png');

    const image = storage.readImage(fileName);

    expect(image?.format).toBe('png');
    expect(Uint8Array.from(image?.bytes ?? [])).toEqual(PNG_BYTES);
  });

  it('ない名前を読んだ場合、undefined を返す', () => {
    const storage = createProductImageStorage({ directory: imageDirectory });

    expect(storage.readImage('00000000-0000-4000-8000-000000000000.jpg')).toBeUndefined();
  });

  it.each(['../settings.json', '/etc/passwd', 'images/../../settings.json', 'not-a-uuid.jpg'])(
    '保存した形でない名前（%s）を読んだ場合、フォルダの外を読まずに undefined を返す',
    (fileName) => {
      const storage = createProductImageStorage({ directory: imageDirectory });

      expect(storage.readImage(fileName)).toBeUndefined();
    },
  );

  it('消した場合、ファイルがなくなる。ない名前を消しても例外にしない', () => {
    const storage = createProductImageStorage({ directory: imageDirectory });
    const fileName = storage.saveImage(JPEG_BYTES, 'jpeg');

    storage.deleteImage(fileName);

    expect(existsSync(join(imageDirectory, fileName))).toBe(false);
    expect(() => storage.deleteImage(fileName)).not.toThrow();
  });

  it('保存した形でない名前を消そうとした場合、フォルダの外のファイルを消さない', () => {
    const storage = createProductImageStorage({ directory: imageDirectory });
    storage.saveImage(JPEG_BYTES, 'jpeg');

    storage.deleteImage('../images');

    expect(existsSync(imageDirectory)).toBe(true);
  });
});
