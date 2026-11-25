/**
 * 商品の画像のファイルの保存（issue #41）。
 *
 * 所属: インフラストラクチャ層
 * 責務: 画像をデータのフォルダの中の画像のフォルダに保存し、読み、消す。
 *  - ファイルの名前は乱数の UUID と、形式から決めた拡張子にする（利用者の入力から作らない）
 *  - フォルダは所有者だけが使える（0700）、ファイルは所有者だけが読み書きできる（0600）ようにする
 *  - 読む・消すときは、保存した形の名前だけを受け付ける（フォルダの外を読み書きしないため）
 */
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProductImageFormat } from '../domain/productImage.ts';

/** 保存したファイルの名前の形（乱数の UUID と拡張子）。 */
export const PRODUCT_IMAGE_FILE_NAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

/** 形式ごとの拡張子。 */
const FILE_EXTENSIONS: Readonly<Record<ProductImageFormat, string>> = { jpeg: 'jpg', png: 'png', webp: 'webp' };

/** 拡張子ごとの形式（保存したファイルの名前から形式を求める）。 */
const FORMATS_BY_EXTENSION: Readonly<Record<string, ProductImageFormat>> = { jpg: 'jpeg', png: 'png', webp: 'webp' };

/** 画像のファイルの保存の操作。 */
export type ProductImageStorage = {
  /**
   * 画像を新しいファイルに保存する。フォルダがなければ作る。
   * @returns 保存したファイルの名前（UUID と拡張子）
   */
  saveImage(bytes: Uint8Array, format: ProductImageFormat): string;
  /** 保存した画像を読む。ない名前・保存した形でない名前は undefined。 */
  readImage(fileName: string): { readonly bytes: Buffer; readonly format: ProductImageFormat } | undefined;
  /** 保存した画像を消す。ない名前・保存した形でない名前は何もしない。 */
  deleteImage(fileName: string): void;
};

/** 保存した形の名前なら、その形式を返す。違えば undefined。 */
function findFormatOfFileName(fileName: string): ProductImageFormat | undefined {
  const extension = PRODUCT_IMAGE_FILE_NAME_PATTERN.exec(fileName)?.[1];
  return extension === undefined ? undefined : FORMATS_BY_EXTENSION[extension];
}

/** ファイルがないことを表すエラーか。 */
function isFileNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/**
 * 画像のファイルの保存の操作を作る。
 * @param options.directory 画像を保存するフォルダ（なければ最初の保存のときに作る）
 */
export function createProductImageStorage(options: { readonly directory: string }): ProductImageStorage {
  const { directory } = options;

  const ensureDirectory = (): void => {
    if (existsSync(directory)) return;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
  };

  return {
    saveImage(bytes, format) {
      ensureDirectory();
      const fileName = `${randomUUID()}.${FILE_EXTENSIONS[format]}`;
      writeFileSync(join(directory, fileName), bytes, { mode: 0o600, flag: 'wx' });
      return fileName;
    },

    readImage(fileName) {
      const format = findFormatOfFileName(fileName);
      if (format === undefined) return undefined;
      try {
        return { bytes: readFileSync(join(directory, fileName)), format };
      } catch (error) {
        if (isFileNotFoundError(error)) return undefined;
        throw error;
      }
    },

    deleteImage(fileName) {
      if (findFormatOfFileName(fileName) === undefined) return;
      rmSync(join(directory, fileName), { force: true });
    },
  };
}
