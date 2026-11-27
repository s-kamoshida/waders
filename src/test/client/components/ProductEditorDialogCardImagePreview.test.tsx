// @vitest-environment jsdom
/**
 * 商品の追加・編集のモーダルの、カード画像のプレビュー（issue #51）。
 * URL を貼り付けたとき・入力して欄を離れたときに POST /api/products/card-image-preview に { url } を送り、
 * 返ってきた画像（{ cardImage: { data, format } }。取れなければ { cardImage: null }）を画像の欄の canvas に描く。
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductEditorDialog } from '../../../client/components/ProductEditorDialog.tsx';
import type { ProductResponse } from '../../../shared/productContract.ts';
import { STUB_CATEGORIES, type RecordedRequest } from '../testFetchStub.ts';

// 画像の縮小・読み込み（canvas）は jsdom では動かないため、結果を決まった値にする（issue #41・#51）
const preparationMocks = vi.hoisted(() => ({
  prepareProductImage: vi.fn(async (file: File) => ({ data: `PREPARED-${file.name}`, width: 800, height: 600 })),
  /** 取ったカード画像（base64 と形式）を読み込み、プレビューに描ける形にする（issue #51）。 */
  prepareCardImagePreview: vi.fn(async (cardImage: { readonly data: string; readonly format: string }) => {
    if (cardImage.data === 'BROKEN') throw new Error('画像として読めない');
    return { data: cardImage.data, width: 1200, height: 630 };
  }),
  drawProductImagePreview: vi.fn(),
}));
vi.mock('../../../client/productImagePreparation.ts', () => preparationMocks);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const PREVIEW_PATH = '/api/products/card-image-preview';
const SHOP_URL = 'https://shop.example.jp/item/1';
const OTHER_SHOP_URL = 'https://other.example.jp/item/2';
const CARD_IMAGE_LABEL = '購入先のページの画像';
const ANNOTATION = '購入先の URL を入れると、ページの画像を取得して使います。自分で選んだ画像があれば、そちらを使います。';
const FETCHING_MESSAGE = 'ページの画像を取得しています…';
const FETCH_FAILED_MESSAGE = 'ページの画像を取得できませんでした。';

/** テスト用の保存済みの商品を作る。 */
function createProduct(overrides: Partial<ProductResponse> = {}): ProductResponse {
  return {
    id: 'product-1',
    name: 'アクションフィギュア',
    releaseMonth: '2026-12',
    status: 'reserved',
    cancelable: false,
    price: null,
    shippingFee: null,
    orderDeadline: null,
    url: SHOP_URL,
    categoryId: null,
    categoryName: null,
    maker: null,
    note: null,
    location: null,
    handlingFee: null,
    travelExpense: null,
    otherExpense: null,
    eventStartsAt: null,
    eventEndsAt: null,
    imageUrl: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

/** スタブが返す応答。 */
type StubReply = { readonly status?: number; readonly body?: unknown };

/** 取れたカード画像の応答。 */
function cardImageReply(data: string): StubReply {
  return { body: { cardImage: { data, format: 'jpeg' } } };
}

/** 取れなかった応答。 */
const NO_CARD_IMAGE_REPLY: StubReply = { body: { cardImage: null } };

/** 終わらせるまで待たせる応答。 */
function createDeferredReply() {
  let finish: (reply: StubReply) => void = () => {};
  const promise = new Promise<StubReply>((resolve) => {
    finish = resolve;
  });
  return { promise, finish: (reply: StubReply) => finish(reply) };
}

/**
 * fetch を置き換える。プレビューの API は replyForPreview（送った URL を受け取る。待たせてもよい）が返し、
 * 商品の登録・更新・画像の送信は成功を返す。
 */
function stubFetch(replyForPreview: (url: string) => StubReply | Promise<StubReply> = () => cardImageReply('CARD-DATA')) {
  const requests: RecordedRequest[] = [];
  const replyFor = (method: string, path: string, body: unknown): StubReply | Promise<StubReply> => {
    const route = `${method} ${path}`;
    if (route === `POST ${PREVIEW_PATH}`) return replyForPreview(String((body as { url?: unknown } | null)?.url));
    if (route === 'POST /api/products') return { status: 201, body: createProduct() };
    if (route === 'PUT /api/products/product-1') return { body: createProduct() };
    if (route === 'PUT /api/products/product-1/image') return { body: createProduct({ imageUrl: '/api/products/product-1/image?v=new' }) };
    if (route === 'DELETE /api/products/product-1/image') return { status: 204 };
    if (route === 'GET /api/categories') return { body: { categories: STUB_CATEGORIES } };
    return { status: 404, body: { error: { code: 'ROUTE_NOT_FOUND', message: 'not found' } } };
  };
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = String(input);
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    requests.push({ method, path, body, contentType: new Headers(init?.headers).get('Content-Type') });
    const reply = await replyFor(method, path, body);
    const status = reply.status ?? 200;
    if (reply.body === undefined) return new Response(null, { status });
    return new Response(JSON.stringify(reply.body), { status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    requests,
    /** プレビューの API に送った URL（送った順）。 */
    previewUrls: () => requests.filter((recorded) => recorded.path === PREVIEW_PATH).map((recorded) => (recorded.body as { url: string }).url),
  };
}

/** 追加のモーダルを開く。 */
function renderCreateDialog(callbacks: { onSaved?: () => void; onSavedAndContinued?: () => void } = {}) {
  render(
    <ProductEditorDialog
      mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }}
      onClose={vi.fn()}
      onSaved={callbacks.onSaved ?? vi.fn()}
      onSavedAndContinued={callbacks.onSavedAndContinued}
    />,
  );
}

/** 編集のモーダルを開く。 */
function renderEditDialog(product: ProductResponse, onSaved = vi.fn()) {
  render(<ProductEditorDialog mode={{ kind: 'edit', product }} onClose={vi.fn()} onSaved={onSaved} />);
}

/** 購入先の URL の欄。 */
function urlInput(): HTMLElement {
  return screen.getByLabelText('購入先の URL');
}

/** 画像の欄（ラベル「画像」を含む欄）。 */
function imageField(): HTMLElement {
  const field = screen.getByLabelText('画像').closest('.field');
  if (!(field instanceof HTMLElement)) throw new Error('画像の欄が見つからない');
  return field;
}

/** 文字の貼り付けの中身（ブラウザの DataTransfer の、貼り付けで使う部分）を作る。 */
function createTextClipboardData(text: string) {
  return {
    files: [],
    items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }],
    types: ['text/plain'],
    getData: (format: string) => (format === 'text/plain' || format === 'text' ? text : ''),
  };
}

/** URL の欄に URL を貼り付ける（ブラウザと同じく、paste の後に入力欄の値が変わる）。欄からは離れない。 */
function pasteUrl(url: string): void {
  const input = urlInput();
  input.focus();
  fireEvent.paste(input, { clipboardData: createTextClipboardData(url) });
  fireEvent.change(input, { target: { value: url } });
}

/** URL の欄に手で入力して、欄から離れる。 */
async function typeUrlAndLeave(url: string): Promise<void> {
  await userEvent.clear(urlInput());
  if (url !== '') await userEvent.type(urlInput(), url);
  await userEvent.tab();
}

describe('URL の欄と画像の欄の配置・注釈（issue #51）', () => {
  it('購入先の URL の欄は、画像の欄のすぐ上にある', () => {
    stubFetch();
    renderCreateDialog();

    expect(urlInput().closest('.field')?.nextElementSibling).toBe(imageField());
  });

  it('画像の欄に、URL からページの画像を取得すること、自分で選んだ画像があればそちらを使うことを注釈で示す（MSG-I-016）', () => {
    stubFetch();
    renderCreateDialog();

    expect(within(imageField()).getByText(ANNOTATION)).toBeInTheDocument();
  });

  it('編集の場合も、画像の欄に注釈を示す', () => {
    stubFetch();
    renderEditDialog(createProduct());

    expect(within(imageField()).getByText(ANNOTATION)).toBeInTheDocument();
  });
});

describe('カード画像を取りに行くとき（issue #51）', () => {
  it('URL を貼り付けた場合、欄を離れなくても、すぐに POST /api/products/card-image-preview に { url } を JSON で送る', async () => {
    const { requests, previewUrls } = stubFetch();
    renderCreateDialog();

    pasteUrl(SHOP_URL);

    await waitFor(() => expect(previewUrls()).toEqual([SHOP_URL]));
    expect(urlInput()).toHaveFocus();
    const previewRequest = requests.find((recorded) => recorded.path === PREVIEW_PATH);
    expect(previewRequest).toEqual({ method: 'POST', path: PREVIEW_PATH, contentType: 'application/json', body: { url: SHOP_URL } });
  });

  it('URL を手で入力している間は取りに行かず、入力欄から離れたときに取りに行く', async () => {
    const { previewUrls } = stubFetch();
    renderCreateDialog();

    await userEvent.type(urlInput(), SHOP_URL);
    expect(previewUrls()).toEqual([]);
    await userEvent.tab();

    await waitFor(() => expect(previewUrls()).toEqual([SHOP_URL]));
  });

  it('同じ URL のまま入力欄に戻って離れ直した場合、取り直さない', async () => {
    const { previewUrls } = stubFetch();
    renderCreateDialog();

    pasteUrl(SHOP_URL);
    expect(await within(imageField()).findByRole('img', { name: CARD_IMAGE_LABEL })).toBeInTheDocument();
    await userEvent.click(urlInput());
    await userEvent.tab();
    await userEvent.click(urlInput());
    await userEvent.tab();

    expect(previewUrls()).toEqual([SHOP_URL]);
  });

  it('同じ URL をもう一度貼り付けた場合も、取り直さない', async () => {
    const { previewUrls } = stubFetch();
    renderCreateDialog();

    pasteUrl(SHOP_URL);
    await within(imageField()).findByRole('img', { name: CARD_IMAGE_LABEL });
    fireEvent.change(urlInput(), { target: { value: '' } });
    pasteUrl(SHOP_URL);
    await userEvent.tab();

    expect(previewUrls()).toEqual([SHOP_URL]);
  });

  it('URL の形が正しくない（http・https の URL でない）場合、取りに行かない', async () => {
    const { previewUrls } = stubFetch();
    renderCreateDialog();

    await typeUrlAndLeave('shop.example.jp/item/1');
    pasteUrl('ftp://shop.example.jp/item/1');
    await userEvent.tab();

    expect(previewUrls()).toEqual([]);
  });

  it('URL が空のまま入力欄から離れた場合、取りに行かない', async () => {
    const { previewUrls } = stubFetch();
    renderCreateDialog();

    await userEvent.click(urlInput());
    await userEvent.tab();

    expect(previewUrls()).toEqual([]);
  });

  it('編集で開いただけ・URL を変えずに入力欄から離れた場合は、取りに行かない', async () => {
    const { previewUrls } = stubFetch();
    renderEditDialog(createProduct({ url: SHOP_URL }));

    await userEvent.click(urlInput());
    await userEvent.tab();

    expect(previewUrls()).toEqual([]);
  });

  it('編集で URL を変えて入力欄から離れた場合、新しい URL で取りに行き、そのプレビューを表示する', async () => {
    const { previewUrls } = stubFetch((url) => (url === OTHER_SHOP_URL ? cardImageReply('OTHER-CARD-DATA') : NO_CARD_IMAGE_REPLY));
    renderEditDialog(createProduct({ url: SHOP_URL, imageUrl: null }));

    await typeUrlAndLeave(OTHER_SHOP_URL);

    expect(await within(imageField()).findByRole('img', { name: CARD_IMAGE_LABEL })).toBeInTheDocument();
    expect(previewUrls()).toEqual([OTHER_SHOP_URL]);
    expect(preparationMocks.prepareCardImagePreview).toHaveBeenCalledWith({ data: 'OTHER-CARD-DATA', format: 'jpeg' });
  });

  it('編集で URL を貼り付けて変えた場合も、新しい URL で取りに行く', async () => {
    const { previewUrls } = stubFetch();
    renderEditDialog(createProduct({ url: SHOP_URL, imageUrl: null }));

    fireEvent.change(urlInput(), { target: { value: '' } });
    pasteUrl(OTHER_SHOP_URL);

    await waitFor(() => expect(previewUrls()).toEqual([OTHER_SHOP_URL]));
  });
});

describe('カード画像のプレビューの表示（issue #51）', () => {
  it('取りに行っている間は、画像の欄に「ページの画像を取得しています」を表示する（MSG-I-017）', async () => {
    const deferred = createDeferredReply();
    stubFetch(() => deferred.promise);
    renderCreateDialog();

    pasteUrl(SHOP_URL);

    expect(await within(imageField()).findByText(FETCHING_MESSAGE)).toBeInTheDocument();
    expect(within(imageField()).queryByRole('img', { name: CARD_IMAGE_LABEL })).not.toBeInTheDocument();
  });

  it('取れた場合、取得中の表示を消し、画像の欄に「購入先のページの画像」のプレビューを canvas に描く（data:・blob: の img は使わない）', async () => {
    const deferred = createDeferredReply();
    stubFetch(() => deferred.promise);
    renderCreateDialog();

    pasteUrl(SHOP_URL);
    await within(imageField()).findByText(FETCHING_MESSAGE);
    deferred.finish(cardImageReply('CARD-DATA'));

    const preview = await within(imageField()).findByRole('img', { name: CARD_IMAGE_LABEL });
    expect(preview.tagName).toBe('CANVAS');
    expect(within(imageField()).queryByText(FETCHING_MESSAGE)).not.toBeInTheDocument();
    expect(preparationMocks.prepareCardImagePreview).toHaveBeenCalledWith({ data: 'CARD-DATA', format: 'jpeg' });
    expect(preparationMocks.drawProductImagePreview).toHaveBeenCalledWith(preview, expect.objectContaining({ data: 'CARD-DATA' }));
    expect(document.querySelector('img[src^="data:"], img[src^="blob:"]')).toBeNull();
  });

  it('取れなかった場合（cardImage が null）、画像の欄に「ページの画像を取得できませんでした」を表示し、プレビューは表示しない（MSG-I-018）', async () => {
    stubFetch(() => NO_CARD_IMAGE_REPLY);
    renderCreateDialog();

    pasteUrl(SHOP_URL);

    expect(await within(imageField()).findByText(FETCH_FAILED_MESSAGE)).toBeInTheDocument();
    expect(within(imageField()).queryByText(FETCHING_MESSAGE)).not.toBeInTheDocument();
    expect(within(imageField()).queryByRole('img', { name: CARD_IMAGE_LABEL })).not.toBeInTheDocument();
  });

  it('プレビューの API が失敗した場合も、取得できなかったことを表示する', async () => {
    stubFetch(() => ({ status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'サーバーでエラーが発生しました。' } } }));
    renderCreateDialog();

    pasteUrl(SHOP_URL);

    expect(await within(imageField()).findByText(FETCH_FAILED_MESSAGE)).toBeInTheDocument();
  });

  it('取った画像を画面で読み込めなかった場合も、取得できなかったことを表示する', async () => {
    stubFetch(() => cardImageReply('BROKEN'));
    renderCreateDialog();

    pasteUrl(SHOP_URL);

    expect(await within(imageField()).findByText(FETCH_FAILED_MESSAGE)).toBeInTheDocument();
    expect(within(imageField()).queryByRole('img', { name: CARD_IMAGE_LABEL })).not.toBeInTheDocument();
  });

  it('URL を別のものに変えて取れなかった場合、前の URL のプレビューを消し、取得できなかったことを表示する', async () => {
    stubFetch((url) => (url === SHOP_URL ? cardImageReply('CARD-DATA') : NO_CARD_IMAGE_REPLY));
    renderCreateDialog();
    pasteUrl(SHOP_URL);
    await within(imageField()).findByRole('img', { name: CARD_IMAGE_LABEL });

    await typeUrlAndLeave(OTHER_SHOP_URL);

    expect(await within(imageField()).findByText(FETCH_FAILED_MESSAGE)).toBeInTheDocument();
    expect(within(imageField()).queryByRole('img', { name: CARD_IMAGE_LABEL })).not.toBeInTheDocument();
  });

  it('取りに行っている間に URL を変えた場合、前の URL の結果が後から返ってきても表示しない', async () => {
    const first = createDeferredReply();
    const second = createDeferredReply();
    stubFetch((url) => (url === SHOP_URL ? first.promise : second.promise));
    renderCreateDialog();

    pasteUrl(SHOP_URL);
    await within(imageField()).findByText(FETCHING_MESSAGE);
    fireEvent.change(urlInput(), { target: { value: '' } });
    pasteUrl(OTHER_SHOP_URL);
    second.finish(NO_CARD_IMAGE_REPLY);
    await within(imageField()).findByText(FETCH_FAILED_MESSAGE);
    first.finish(cardImageReply('OLD-CARD-DATA'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(within(imageField()).queryByRole('img', { name: CARD_IMAGE_LABEL })).not.toBeInTheDocument();
    expect(within(imageField()).getByText(FETCH_FAILED_MESSAGE)).toBeInTheDocument();
  });

  it('URL を消して入力欄から離れた場合、プレビューを消す', async () => {
    stubFetch();
    renderCreateDialog();
    pasteUrl(SHOP_URL);
    await within(imageField()).findByRole('img', { name: CARD_IMAGE_LABEL });

    await typeUrlAndLeave('');

    await waitFor(() => expect(within(imageField()).queryByRole('img', { name: CARD_IMAGE_LABEL })).not.toBeInTheDocument());
    expect(within(imageField()).queryByText(FETCH_FAILED_MESSAGE)).not.toBeInTheDocument();
  });

  it('カード画像のプレビューだけを表示しているときは、「画像を消す」ボタンを表示しない', async () => {
    stubFetch();
    renderCreateDialog();

    pasteUrl(SHOP_URL);
    await within(imageField()).findByRole('img', { name: CARD_IMAGE_LABEL });

    expect(within(imageField()).queryByRole('button', { name: '画像を消す' })).not.toBeInTheDocument();
  });
});

describe('自分で選んだ画像との関係（issue #51）', () => {
  const photo = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });

  it('画像を選んだ後に URL を貼り付けた場合、選んだ画像を表示したままにし、カード画像のプレビューに置き換えない', async () => {
    stubFetch();
    renderCreateDialog();
    await userEvent.upload(screen.getByLabelText('画像'), photo);
    await within(imageField()).findByRole('img', { name: '選んだ画像' });

    pasteUrl(SHOP_URL);
    await userEvent.tab();

    await waitFor(() => expect(within(imageField()).getByRole('img', { name: '選んだ画像' })).toBeInTheDocument());
    expect(within(imageField()).queryByRole('img', { name: CARD_IMAGE_LABEL })).not.toBeInTheDocument();
  });

  it('画像を選んだ後に URL を入れ、「画像を消す」を押した場合、カード画像のプレビューを表示する', async () => {
    const { previewUrls } = stubFetch();
    renderCreateDialog();
    await userEvent.upload(screen.getByLabelText('画像'), photo);
    await within(imageField()).findByRole('img', { name: '選んだ画像' });
    pasteUrl(SHOP_URL);
    await userEvent.tab();

    await userEvent.click(within(imageField()).getByRole('button', { name: '画像を消す' }));

    expect(await within(imageField()).findByRole('img', { name: CARD_IMAGE_LABEL })).toBeInTheDocument();
    expect(within(imageField()).queryByRole('img', { name: '選んだ画像' })).not.toBeInTheDocument();
    expect(new Set(previewUrls())).toEqual(new Set([SHOP_URL]));
  });

  it('画像を選んだ後に URL を入れて保存した場合、選んだ画像を送る', async () => {
    const { requests } = stubFetch();
    const onSaved = vi.fn();
    renderCreateDialog({ onSaved });
    await userEvent.type(screen.getByLabelText('商品名'), 'アクションフィギュア');
    await userEvent.upload(screen.getByLabelText('画像'), photo);
    await within(imageField()).findByRole('img', { name: '選んだ画像' });
    pasteUrl(SHOP_URL);
    await userEvent.tab();

    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    const imageUpload = requests.find((recorded) => recorded.method === 'PUT' && recorded.path === '/api/products/product-1/image');
    expect(imageUpload?.body).toEqual({ data: 'PREPARED-photo.jpg' });
  });

  it('カード画像のプレビューを表示した後に画像を選んだ場合、選んだ画像に置き換える', async () => {
    stubFetch();
    renderCreateDialog();
    pasteUrl(SHOP_URL);
    await within(imageField()).findByRole('img', { name: CARD_IMAGE_LABEL });

    await userEvent.upload(screen.getByLabelText('画像'), photo);

    expect(await within(imageField()).findByRole('img', { name: '選んだ画像' })).toBeInTheDocument();
    expect(within(imageField()).queryByRole('img', { name: CARD_IMAGE_LABEL })).not.toBeInTheDocument();
  });
});

describe('プレビューと保存（issue #51）', () => {
  it('カード画像を取りに行っている間も保存でき、入力した URL を送って onSaved を呼ぶ', async () => {
    const deferred = createDeferredReply();
    const { requests } = stubFetch(() => deferred.promise);
    const onSaved = vi.fn();
    renderCreateDialog({ onSaved });
    await userEvent.type(screen.getByLabelText('商品名'), 'アクションフィギュア');
    pasteUrl(SHOP_URL);
    await within(imageField()).findByText(FETCHING_MESSAGE);

    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const created = requests.find((recorded) => recorded.method === 'POST' && recorded.path === '/api/products');
    expect(created?.body).toEqual(expect.objectContaining({ name: 'アクションフィギュア', url: SHOP_URL }));
  });

  it('カード画像を取得できなかった場合も保存でき、onSaved を呼ぶ', async () => {
    stubFetch(() => NO_CARD_IMAGE_REPLY);
    const onSaved = vi.fn();
    renderCreateDialog({ onSaved });
    await userEvent.type(screen.getByLabelText('商品名'), 'アクションフィギュア');
    pasteUrl(SHOP_URL);
    await within(imageField()).findByText(FETCH_FAILED_MESSAGE);

    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('編集で URL を変えてプレビューを表示した後に保存した場合、新しい URL で商品を更新する', async () => {
    const { requests } = stubFetch();
    const onSaved = vi.fn();
    renderEditDialog(createProduct({ url: SHOP_URL, imageUrl: null }), onSaved);
    await typeUrlAndLeave(OTHER_SHOP_URL);
    await within(imageField()).findByRole('img', { name: CARD_IMAGE_LABEL });

    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const updated = requests.find((recorded) => recorded.method === 'PUT' && recorded.path === '/api/products/product-1');
    expect(updated?.body).toEqual(expect.objectContaining({ url: OTHER_SHOP_URL }));
  });

  it('「保存して続けて追加」で保存した場合、カード画像のプレビューと表示を消す', async () => {
    stubFetch();
    const onSavedAndContinued = vi.fn();
    renderCreateDialog({ onSavedAndContinued });
    await userEvent.type(screen.getByLabelText('商品名'), '1つ目の商品');
    pasteUrl(SHOP_URL);
    await within(imageField()).findByRole('img', { name: CARD_IMAGE_LABEL });
    await userEvent.click(screen.getByRole('button', { name: '保存方法を選ぶ' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: '保存して続けて追加' }));

    await userEvent.click(screen.getByRole('button', { name: '保存して続けて追加' }));

    await waitFor(() => expect(onSavedAndContinued).toHaveBeenCalled());
    expect(urlInput()).toHaveValue('');
    expect(within(imageField()).queryByRole('img', { name: CARD_IMAGE_LABEL })).not.toBeInTheDocument();
    expect(within(imageField()).queryByText(FETCH_FAILED_MESSAGE)).not.toBeInTheDocument();
  });
});
