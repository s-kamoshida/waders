// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProduct, fetchProducts } from '../../client/productApiClient.ts';
import { stubFetchRoutes } from './testFetchStub.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('画面を開いたパスの下の API を呼ぶ（issue #39）', () => {
  it('画面を /waders/ で開いた場合、/waders/api の下の API を呼ぶ', async () => {
    window.history.replaceState(null, '', '/waders/');
    const { requests } = stubFetchRoutes({ 'GET /waders/api/products': () => ({ body: { products: [] } }) });

    await fetchProducts();

    expect(requests.map((recordedRequest) => recordedRequest.path)).toEqual(['/waders/api/products']);
  });

  it('画面を /waders/archive で開いた場合も、/waders/api の下の API を呼ぶ', async () => {
    window.history.replaceState(null, '', '/waders/archive');
    const { requests } = stubFetchRoutes({ 'GET /waders/api/products': () => ({ body: { products: [] } }) });

    await fetchProducts();

    expect(requests.map((recordedRequest) => recordedRequest.path)).toEqual(['/waders/api/products']);
  });

  it('画面を /apps/waders/ で開いた場合、状態を変えるリクエストも /apps/waders/api の下に送る', async () => {
    window.history.replaceState(null, '', '/apps/waders/');
    const { requests } = stubFetchRoutes({});

    await createProduct({ name: 'フィギュア', releaseMonth: '2026-12' } as Parameters<typeof createProduct>[0]).catch(() => undefined);

    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.path).toBe('/apps/waders/api/products');
  });

  it('画面を / で開いた場合、今までどおり /api の下の API を呼ぶ', async () => {
    window.history.replaceState(null, '', '/');
    const { requests } = stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [] } }) });

    await fetchProducts();

    expect(requests.map((recordedRequest) => recordedRequest.path)).toEqual(['/api/products']);
  });
});
