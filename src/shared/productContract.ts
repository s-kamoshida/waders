/**
 * 商品の入力の検証ルール（クライアントとサーバーで共用）。
 *
 * 所属: 共有（src/shared）
 * 責務: 商品の各項目の形式・範囲・既定値を Zod のスキーマとして一か所に定義する（要件「商品データ」「値の形式」）。
 */
import { z } from 'zod';

/** 商品名の上限の文字数。 */
export const MAXIMUM_PRODUCT_NAME_LENGTH = 200;

/** 金額・送料・費用・値引きの上限（円）。桁の打ち間違いを防ぐため 1,000 万円未満とする。 */
export const MAXIMUM_PRICE_YEN = 9_999_999;

/** URL の上限の文字数。 */
export const MAXIMUM_URL_LENGTH = 2048;

/** カテゴリー名の上限の文字数。 */
export const MAXIMUM_CATEGORY_NAME_LENGTH = 50;

/** カテゴリーの ID の上限の文字数（issue #10）。 */
export const MAXIMUM_CATEGORY_ID_LENGTH = 100;

/** メーカーの上限の文字数（issue #18）。 */
export const MAXIMUM_MAKER_LENGTH = 100;

/** 備考の上限の文字数（issue #18）。 */
export const MAXIMUM_NOTE_LENGTH = 1000;

/** 場所の上限の文字数（issue #26）。 */
export const MAXIMUM_LOCATION_LENGTH = 100;

/**
 * 商品のステータス。画面では日本語で表示する。
 * - considering: 検討中（初期値）
 * - reserved: 予約済
 * - purchased: 購入済
 * - unpurchased: 未購入
 * - canceled: キャンセル（予約した後に取り消した商品。手でだけ選べ、発売月に関係なくアーカイブに表示する。issue #57、BR-38）
 *
 * DB の最初の移行（版数 1）の CHECK は、この一覧ではなく当時の 4 つに固定している（古い移行の SQL を変えないため）。
 * 値を加えるときは、表を作り直す移行を末尾に足す（sqliteProductRepository.ts。キャンセルは版数 10）。
 */
export const PRODUCT_STATUSES = ['considering', 'reserved', 'purchased', 'unpurchased', 'canceled'] as const;

/** 商品のステータスのスキーマ。 */
export const productStatusSchema = z.enum(PRODUCT_STATUSES);

/** 商品のステータス。 */
export type ProductStatus = z.infer<typeof productStatusSchema>;

/** 存在する暦の日付（例: 2026-02-30 は不可）かを確かめる。 */
function isExistingCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** http・https の URL かを確かめる（`javascript:` などのリンクを画面に置かないため）。 */
function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** 発売月（年と月。例: 2026-11）。 */
export const releaseMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, '発売月は「2026-11」の形式で入力してください。');

/**
 * 発売月か、未定（null。issue #62、BR-40）。登録・編集・ドラッグ・リストに戻すで使う。
 * 省くことはできない（未定は null で明示する）。延期の確認で入れる新しい発売月は月だけ（releaseMonthSchema）。
 */
export const releaseMonthOrUndeterminedSchema = releaseMonthSchema.nullable();

/** 受注期限（日本時間の日付。例: 2026-11-20。その日の終わりまで期限内）。 */
export const orderDeadlineSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '受注期限は「2026-11-20」の形式で入力してください。')
  .refine(isExistingCalendarDate, '受注期限に存在しない日付が指定されています。');

/** 金額・送料（円。0 以上 9,999,999 以下の整数）。 */
export const yenAmountSchema = z
  .number()
  .int('金額は整数で入力してください。')
  .min(0, '金額は 0 円以上で入力してください。')
  .max(MAXIMUM_PRICE_YEN, `金額は ${MAXIMUM_PRICE_YEN.toLocaleString('ja-JP')} 円以下で入力してください。`);

/** 購入先の URL（http・https のみ）。 */
export const productUrlSchema = z
  .string()
  .max(MAXIMUM_URL_LENGTH, `URL は ${MAXIMUM_URL_LENGTH} 文字以内で入力してください。`)
  .refine(isHttpUrl, 'URL は http:// または https:// で始まるものを入力してください。');

/** 存在する UTC の日時か（例: 2026-02-30T00:00:00.000Z は不可）を確かめる。 */
function isExistingDateTime(value: string): boolean {
  const time = Date.parse(value);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value.slice(0, 10);
}

/**
 * 開催日時・終了日時（UTC の ISO 8601。例: 2026-11-20T09:00:00.000Z。PR #30 のレビュー）。
 * 画面では日本時間で分まで入力し、UTC にして送る。保存する形を揃えるため、ミリ秒まである形（toISOString）にする。
 * @param label 誤りの文言に使う項目の名前（開催日時・終了日時）
 */
function createEventDateTimeSchema(label: string) {
  const message = `${label}は「2026-11-20T09:00:00.000Z」の形式（UTC）で送ってください。`;
  return z
    .iso.datetime({ message })
    .refine(isExistingDateTime, message)
    .transform((value) => new Date(value).toISOString());
}

/** 終了日時が開催日時より前の場合の文言（同じ時刻はよい）。 */
export const EVENT_END_BEFORE_START_MESSAGE = '終了日時は開催日時以降にしてください。';

/** 値引きが、金額と送料・手数料・交通費（見込）・その他費用の合計を超える場合の文言（MSG-V-031。issue #50）。 */
export const DISCOUNT_EXCEEDS_TOTAL_MESSAGE = '値引きは、金額と送料などの合計以下で入力してください。';

/** 金額が空のまま値引きを入れた場合の文言（MSG-V-032。issue #50）。 */
export const DISCOUNT_WITHOUT_PRICE_MESSAGE = '値引きを入力する場合は、金額も入力してください。';

/** 値引きと比べる、商品の費用の項目。 */
type ProductCosts = {
  readonly price: number | null;
  readonly shippingFee: number | null;
  readonly handlingFee: number | null;
  readonly travelExpense: number | null;
  readonly otherExpense: number | null;
};

/**
 * 金額と送料・手数料・交通費（見込）・その他費用の合計（値引き前）を求める（issue #26・#50）。
 * @returns 金額が未入力なら null（金額が空の商品は合計金額に含めないため）
 */
export function sumProductCostsYen(costs: ProductCosts): number | null {
  if (costs.price === null) return null;
  const additionalCosts = [costs.shippingFee, costs.handlingFee, costs.travelExpense, costs.otherExpense];
  return additionalCosts.reduce<number>((total, cost) => total + (cost ?? 0), costs.price);
}

/**
 * 値引きの決まり（BR-35。issue #50）を確かめ、誤りを値引きの項目に加える。
 * 金額が空のまま値引きがある場合は MSG-V-032、値引きが金額と送料などの合計を超える場合は MSG-V-031（同じ額はよい）。
 */
function checkDiscount(input: ProductCosts & { readonly discount: number | null }, context: z.RefinementCtx): void {
  if (input.discount === null) return;
  const totalYen = sumProductCostsYen(input);
  if (totalYen === null) {
    context.addIssue({ code: 'custom', message: DISCOUNT_WITHOUT_PRICE_MESSAGE, path: ['discount'] });
    return;
  }
  if (input.discount > totalYen) context.addIssue({ code: 'custom', message: DISCOUNT_EXCEEDS_TOTAL_MESSAGE, path: ['discount'] });
}

/**
 * 商品の入力（登録・編集）のスキーマ。
 * 必須は商品名と発売月（発売月は未定の null も可。issue #62）。ステータスの既定は検討中、キャンセル可否の既定は不可、任意の項目の既定は未入力（null）。
 */
export const productInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, '商品名を入力してください。')
    .max(MAXIMUM_PRODUCT_NAME_LENGTH, `商品名は ${MAXIMUM_PRODUCT_NAME_LENGTH} 文字以内で入力してください。`),
  releaseMonth: releaseMonthOrUndeterminedSchema,
  status: productStatusSchema.default('considering'),
  cancelable: z.boolean().default(false),
  price: yenAmountSchema.nullable().default(null),
  shippingFee: yenAmountSchema.nullable().default(null),
  orderDeadline: orderDeadlineSchema.nullable().default(null),
  url: productUrlSchema.nullable().default(null),
  /** カテゴリーの ID（定義にあるもの。サーバーが確かめる）。未設定は null（issue #10）。 */
  categoryId: z.string().min(1).max(MAXIMUM_CATEGORY_ID_LENGTH).nullable().default(null),
  /** メーカー（前後の空白を除いて 1〜100 文字。未入力は null）。 */
  maker: z
    .string()
    .trim()
    .min(1, 'メーカーを入力しない場合は空にしてください。')
    .max(MAXIMUM_MAKER_LENGTH, `メーカーは ${MAXIMUM_MAKER_LENGTH} 文字以内で入力してください。`)
    .nullable()
    .default(null),
  /** 備考（複数行。前後の空白を除いて 1〜1,000 文字。途中の改行は残す。未入力は null）。 */
  note: z
    .string()
    .trim()
    .min(1, '備考を入力しない場合は空にしてください。')
    .max(MAXIMUM_NOTE_LENGTH, `備考は ${MAXIMUM_NOTE_LENGTH.toLocaleString('ja-JP')} 文字以内で入力してください。`)
    .nullable()
    .default(null),
  /** 場所（イベントの会場など。前後の空白を除いて 1〜100 文字。未入力は null。issue #26）。 */
  location: z
    .string()
    .trim()
    .min(1, '場所を入力しない場合は空にしてください。')
    .max(MAXIMUM_LOCATION_LENGTH, `場所は ${MAXIMUM_LOCATION_LENGTH} 文字以内で入力してください。`)
    .nullable()
    .default(null),
  /** 手数料（円。issue #26）。 */
  handlingFee: yenAmountSchema.nullable().default(null),
  /** 交通費（見込）（円。issue #26）。 */
  travelExpense: yenAmountSchema.nullable().default(null),
  /** その他費用（円。名前はカテゴリーごとに変えられる。issue #26・#27）。 */
  otherExpense: yenAmountSchema.nullable().default(null),
  /** 開催日時（UTC）。未入力は null。 */
  eventStartsAt: createEventDateTimeSchema('開催日時').nullable().default(null),
  /** 終了日時（UTC）。未入力は null。開催日時より前は不可（同じ時刻はよい）。 */
  eventEndsAt: createEventDateTimeSchema('終了日時').nullable().default(null),
  /**
   * 値引き（ポイント・クーポンなどの総額。円。issue #50）。未入力は null（値引きなし）。
   * 金額があり、金額と送料などの合計以下に限る（BR-35）。
   */
  discount: yenAmountSchema.nullable().default(null),
})
  .refine(
    (input) => input.eventStartsAt === null || input.eventEndsAt === null || input.eventEndsAt >= input.eventStartsAt,
    { message: EVENT_END_BEFORE_START_MESSAGE, path: ['eventEndsAt'] },
  )
  .superRefine(checkDiscount);

/** 検証済みの商品の入力。 */
export type ProductInput = z.infer<typeof productInputSchema>;

/** API が返す商品のスキーマ（保存済みの商品。日時は UTC の ISO 8601 文字列）。 */
export const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** 発売月。未定は null（issue #62）。 */
  releaseMonth: z.string().nullable(),
  status: productStatusSchema,
  cancelable: z.boolean(),
  price: z.number().int().nullable(),
  shippingFee: z.number().int().nullable(),
  orderDeadline: z.string().nullable(),
  url: z.string().nullable(),
  /** カテゴリーの ID。未設定は null。 */
  categoryId: z.string().nullable(),
  /** カテゴリー名。定義にあれば今の名前、定義から消えていれば最後に保存した名前。未設定は null。 */
  categoryName: z.string().nullable(),
  maker: z.string().nullable(),
  note: z.string().nullable(),
  location: z.string().nullable(),
  handlingFee: z.number().int().nullable(),
  travelExpense: z.number().int().nullable(),
  otherExpense: z.number().int().nullable(),
  eventStartsAt: z.string().nullable(),
  eventEndsAt: z.string().nullable(),
  /** 値引き（円）。値引きなしは null（issue #50）。 */
  discount: z.number().int().nullable(),
  /**
   * 商品の画像の URL（API のパス。画像を付け直すたびに変わる版を含む）。画像がなければ null（issue #41）。
   * 画面と API を置くパス（basePath）は含まないため、画面では resolveApiPath で解決して使う。
   */
  imageUrl: z.string().nullable(),
  /**
   * 表示する画像の種類。uploaded はアップロードした画像、card は購入先のページのカード画像、画像がなければ null（issue #51）。
   * 両方あるときは、表示するアップロードした画像（uploaded）。編集の画面が、URL を変えたときにカード画像のプレビューに置き換えるかを決めるのに使う。
   */
  imageKind: z.enum(['uploaded', 'card']).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** 表示する画像の種類（issue #51）。 */
export type ProductImageKind = NonNullable<z.infer<typeof productSchema>['imageKind']>;

/** API が返す商品。 */
export type ProductResponse = z.infer<typeof productSchema>;

/**
 * 一覧（GET /api/products）の商品のスキーマ。
 * deliveryConfirmationPending は、予約済から自動で購入済になり、延期の確認（届いたかどうか）を待っているか（issue #9）。
 * cardImagePending は、購入先のページのカード画像を取りに行っている途中か（画面は取り終わるまで読み直す。issue #42）。
 */
export const productListItemSchema = productSchema.extend({
  deliveryConfirmationPending: z.boolean().default(false),
  cardImagePending: z.boolean().default(false),
});

/** 一覧の商品。 */
export type ProductListItem = z.infer<typeof productListItemSchema>;

/** 商品の一覧（GET /api/products）の応答のスキーマ。 */
export const productListResponseSchema = z.object({ products: z.array(productListItemSchema) });

/** 画像を付ける（PUT /api/products/:productId/image）の本文のスキーマ。data は画像の中身を base64 にしたもの（issue #41）。 */
export const productImageUploadRequestSchema = z.object({
  data: z.base64({ message: '画像の中身を読めません。' }).min(1, { message: '画像を選んでください。' }),
});

/** 画像を付けるの本文。 */
export type ProductImageUploadRequest = z.infer<typeof productImageUploadRequestSchema>;

/** リストに戻す（POST /api/products/:productId/restore）の本文のスキーマ。
 * 新しい発売月は、未定（null）も選べる（issue #62）。当月以降かはサーバーが現在時刻で確かめる。 */
export const restoreRequestSchema = z.object({ releaseMonth: releaseMonthOrUndeterminedSchema });

/** 発売月だけを変える（PATCH /api/products/:productId/release-month。ドラッグアンドドロップ。issue #13）の本文のスキーマ。
 * null は未定のまとまりへの移動（issue #62）。 */
export const releaseMonthChangeRequestSchema = z.object({ releaseMonth: releaseMonthOrUndeterminedSchema });

/**
 * ステータスだけを変える（PATCH /api/products/:productId/status。詳細画面のプルダウン。issue #52）の本文のスキーマ。
 * cancelable は「予約済」「予約済（キャンセル可）」を選んだときだけ送り、省いた場合は今のキャンセル可否を変えない。
 */
export const statusChangeRequestSchema = z.object({ status: productStatusSchema, cancelable: z.boolean().optional() });

/** ステータスだけを変えるの本文。 */
export type StatusChangeRequest = z.infer<typeof statusChangeRequestSchema>;

/** リストに戻すの本文。 */
export type RestoreRequest = z.infer<typeof restoreRequestSchema>;

/**
 * 延期の確認への回答（POST /api/products/:productId/delivery-confirmation）の本文のスキーマ。
 *  - arrived: 届いた（購入済のまま）
 *  - postponed: 延期された（新しい発売月で予約済に戻す。当月以降かはサーバーが確かめる）
 *  - notPurchased: 買わなかった（未購入にする）
 */
export const deliveryConfirmationRequestSchema = z.discriminatedUnion('answer', [
  z.object({ answer: z.literal('arrived') }),
  z.object({ answer: z.literal('postponed'), releaseMonth: releaseMonthSchema }),
  z.object({ answer: z.literal('notPurchased') }),
]);

/** 延期の確認への回答。 */
export type DeliveryConfirmationRequest = z.infer<typeof deliveryConfirmationRequestSchema>;

/** API のエラーの応答のスキーマ。fieldErrors は入力の誤りがあった項目ごとの文言。 */
export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fieldErrors: z.record(z.string(), z.string()).optional(),
  }),
});

/** API のエラーの応答。 */
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

/**
 * 検証のエラーを、項目ごとの最初の文言にまとめる（画面の入力欄の下に表示するため）。
 * @returns 項目名をキー、文言を値とするオブジェクト
 */
export function collectFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const fieldName = String(issue.path[0] ?? 'form');
    fieldErrors[fieldName] ??= issue.message;
  }
  return fieldErrors;
}

/** カード画像のプレビューの要求の本文（POST /api/products/card-image-preview。issue #51）。URL の検証は購入先の URL と同じ。 */
export const cardImagePreviewRequestSchema = z.object({
  url: productUrlSchema,
});

/**
 * カード画像のプレビューの応答（issue #51）。cardImage は取れた画像の中身（base64）と、中身から判定した形式。取れなければ null。
 */
export const cardImagePreviewResponseSchema = z.object({
  cardImage: z
    .object({
      data: z.string(),
      format: z.enum(['jpeg', 'png', 'webp']),
    })
    .nullable(),
});

/** カード画像のプレビューの応答。 */
export type CardImagePreviewResponse = z.infer<typeof cardImagePreviewResponseSchema>;

