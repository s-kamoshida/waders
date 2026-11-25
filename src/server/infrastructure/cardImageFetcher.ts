/**
 * 購入先のページのカード画像の取得（issue #42）。
 *
 * 所属: インフラストラクチャ層
 * 責務: 購入先のページの og:image（なければ twitter:image）の画像を取りに行く。サーバーから家庭の中の機器へ接続させないよう（SSRF 対策）:
 *  - http・https の URL だけを扱う
 *  - 接続する前に、名前を引いた先のアドレスを確かめ、LAN の中・ループバックなどへは接続しない。
 *    確かめたアドレスにそのまま接続する（名前を引き直さないため、確かめた後に向き先を変えられない）
 *  - リダイレクトは自分でたどり、行き先も同じように確かめる（3 回まで）
 *  - 全体で 10 秒、ページは先頭の 1MB まで読む、画像は 2MB まで
 *  - Cookie は送らない。画像の形式は Content-Type ではなく中身で判定する
 * 取れない場合（失敗・上限超え・形式の誤りを含む）は null を返し、例外にしない。
 */
import { lookup, type LookupAddress } from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { MAXIMUM_PRODUCT_IMAGE_BYTES, detectProductImageFormat, type ProductImageFormat } from '../domain/productImage.ts';

/** カード画像の取得の上限。 */
export const CARD_IMAGE_FETCH_LIMITS = {
  /** 全体（ページと画像、リダイレクトを含む）の時間。 */
  timeoutMilliseconds: 10_000,
  /** ページを読む大きさ（先頭から。og:image は head にあるため、超えた分は読まない）。 */
  maximumPageBytes: 1024 * 1024,
  /** 画像の大きさ（アップロードした画像と同じ。超えたら使わない）。 */
  maximumImageBytes: MAXIMUM_PRODUCT_IMAGE_BYTES,
  maximumRedirects: 3,
};

/** 取ったカード画像。 */
export type CardImage = { readonly bytes: Uint8Array; readonly format: ProductImageFormat };

/** カード画像の取得。 */
export type CardImageFetcher = {
  /** ページの URL からカード画像を取る。取れなければ null。 */
  fetchCardImage(pageUrl: string): Promise<CardImage | null>;
};

/** 接続しないアドレスの範囲（ループバック・LAN・リンクローカル・CGNAT・マルチキャスト・予約・文書用など）。 */
const NON_PUBLIC_ADDRESSES = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  NON_PUBLIC_ADDRESSES.addSubnet(network, prefix, 'ipv4');
}
// 未指定・ループバック
NON_PUBLIC_ADDRESSES.addAddress('::', 'ipv6');
NON_PUBLIC_ADDRESSES.addAddress('::1', 'ipv6');
for (const [network, prefix] of [
  // IPv4 への変換（NAT64）
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  NON_PUBLIC_ADDRESSES.addSubnet(network, prefix, 'ipv6');
}

/**
 * IPv4 を IPv6 の形で表したアドレス（::ffff:0:0/96）と IPv4 互換のアドレス（::/96）。中の IPv4 を確かめずに、まとめて接続しない。
 * BlockList は IPv6 の規則を IPv4 のアドレスにも当てはめるため、別に持ち、IPv6 のアドレスにだけ使う。
 */
const IPV4_EMBEDDED_IPV6_ADDRESSES = new BlockList();
IPV4_EMBEDDED_IPV6_ADDRESSES.addSubnet('::ffff:0:0', 96, 'ipv6');
IPV4_EMBEDDED_IPV6_ADDRESSES.addSubnet('::', 96, 'ipv6');

/** インターネットのアドレス（接続してよいアドレス）か。アドレスでない文字列は false。 */
export function isPublicNetworkAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  if (family === 6 && IPV4_EMBEDDED_IPV6_ADDRESSES.check(address, 'ipv6')) return false;
  return !NON_PUBLIC_ADDRESSES.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** og:image・twitter:image の指定の名前（先にあるものを優先する）。 */
const CARD_IMAGE_PROPERTY_NAMES = ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'];

const META_TAG_PATTERN = /<meta\b[^>]*>/gi;
const ATTRIBUTE_PATTERN = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

/** 文字参照（&amp; など）を文字に戻す。 */
function decodeHtmlEntities(text: string): string {
  const namedEntities: Readonly<Record<string, string>> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return namedEntities[body.toLowerCase()] ?? entity;
  });
}

/** meta タグの属性を、小文字の名前と値の組にする。 */
function parseAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of tag.matchAll(ATTRIBUTE_PATTERN)) {
    attributes.set((match[1] ?? '').toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

/** URL を http・https の URL として解釈する。それ以外・読めない値は null。 */
function parseHttpUrl(value: string, baseUrl?: string): URL | null {
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * ページの HTML からカード画像の URL を取り出す。og:image を優先し、なければ twitter:image を使う。
 * 相対パスはページの URL を基準にする。http・https でないものは使わない。
 * @returns 画像の URL。使えるものがなければ null
 */
export function extractCardImageUrl(html: string, pageUrl: string): string | null {
  const candidates = new Map<string, string>();
  for (const tag of html.match(META_TAG_PATTERN) ?? []) {
    const attributes = parseAttributes(tag);
    const propertyName = (attributes.get('property') ?? attributes.get('name') ?? '').toLowerCase();
    const content = decodeHtmlEntities(attributes.get('content') ?? '').trim();
    if (CARD_IMAGE_PROPERTY_NAMES.includes(propertyName) && content !== '' && !candidates.has(propertyName)) candidates.set(propertyName, content);
  }
  for (const propertyName of CARD_IMAGE_PROPERTY_NAMES) {
    const imageUrl = parseHttpUrl(candidates.get(propertyName) ?? '', pageUrl);
    if (imageUrl !== null && candidates.has(propertyName)) return imageUrl.href;
  }
  return null;
}

/** 1 回のリクエストの結果。 */
type FetchedResponse = {
  readonly status: number;
  readonly headers: IncomingMessage['headers'];
  readonly body: Buffer;
  /** 本文が上限を超えていたか（超えた分は読んでいない）。 */
  readonly exceededLimit: boolean;
};

/** リクエストの条件。 */
type RequestContext = {
  readonly signal: AbortSignal;
  readonly isAllowedAddress: (address: string) => boolean;
};

/** 名前を引き、すべてのアドレスが接続してよいときだけ返す（接続にはこの結果を使う）。 */
function createCheckedLookup(isAllowedAddress: (address: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    lookup(hostname, { all: true, family: options.family }, (error, addresses: LookupAddress[]) => {
      if (error !== null) {
        callback(error, '', 0);
        return;
      }
      if (addresses.length === 0 || !addresses.every((candidate) => isAllowedAddress(candidate.address))) {
        callback(new Error(`接続しないアドレスです: ${hostname}`), '', 0);
        return;
      }
      if (options.all === true) callback(null, addresses);
      else callback(null, addresses[0]?.address ?? '', addresses[0]?.family ?? 4);
    });
  };
}

/** 応答の本文を上限まで読む。上限を超えたら、そこで読むのをやめる。 */
function readBody(response: IncomingMessage, maximumBytes: number): Promise<{ body: Buffer; exceededLimit: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    response.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      length += chunk.length;
      if (length <= maximumBytes) return;
      response.destroy();
      resolve({ body: Buffer.concat(chunks).subarray(0, maximumBytes), exceededLimit: true });
    });
    response.on('end', () => resolve({ body: Buffer.concat(chunks), exceededLimit: false }));
    response.on('error', reject);
  });
}

/** 1 回の GET を行う（リダイレクトはたどらない）。接続してはいけないアドレスなら例外にする。 */
function requestOnce(url: URL, maximumBytes: number, context: RequestContext): Promise<FetchedResponse> {
  const literalAddress = url.hostname.replace(/^\[(.*)\]$/, '$1');
  if (isIP(literalAddress) !== 0 && !context.isAllowedAddress(literalAddress)) {
    return Promise.reject(new Error(`接続しないアドレスです: ${literalAddress}`));
  }
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.get(
      url,
      {
        signal: context.signal,
        agent: false,
        lookup: createCheckedLookup(context.isAllowedAddress),
        // Cookie は付けない。圧縮されると大きさの上限で止めにくいため、圧縮しない形で受け取る
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Waders)', Accept: 'text/html,image/*;q=0.9,*/*;q=0.5', 'Accept-Encoding': 'identity' },
      },
      (response) => {
        readBody(response, maximumBytes)
          .then(({ body, exceededLimit }) => resolve({ status: response.statusCode ?? 0, headers: response.headers, body, exceededLimit }))
          .catch(reject);
      },
    );
    request.on('error', reject);
  });
}

/** リダイレクトの状態か。 */
function isRedirectStatus(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

/**
 * GET を行い、リダイレクトを上限までたどる。行き先も同じように確かめる。
 * @returns 最後の応答と、その URL。たどれない場合は null
 */
async function requestFollowingRedirects(
  startUrl: URL,
  maximumBytes: number,
  context: RequestContext,
): Promise<{ response: FetchedResponse; url: URL } | null> {
  let url = startUrl;
  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await requestOnce(url, maximumBytes, context);
    if (!isRedirectStatus(response.status)) return { response, url };
    const nextUrl = parseHttpUrl(response.headers.location ?? '', url.href);
    if (redirectCount >= CARD_IMAGE_FETCH_LIMITS.maximumRedirects || nextUrl === null) return null;
    url = nextUrl;
  }
}

/** ページを読み、カード画像の URL を返す。HTML でない・200 でない場合は null。 */
async function findCardImageUrlOfPage(pageUrl: URL, context: RequestContext): Promise<URL | null> {
  const page = await requestFollowingRedirects(pageUrl, CARD_IMAGE_FETCH_LIMITS.maximumPageBytes, context);
  if (page === null || page.response.status !== 200) return null;
  const mediaType = (page.response.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  if (mediaType !== 'text/html' && mediaType !== 'application/xhtml+xml') return null;
  const imageUrl = extractCardImageUrl(page.response.body.toString('utf8'), page.url.href);
  return imageUrl === null ? null : parseHttpUrl(imageUrl);
}

/** 画像を取り、形式を中身で判定する。上限を超えた・受け付けない形式なら null。 */
async function fetchImage(imageUrl: URL, context: RequestContext): Promise<CardImage | null> {
  const image = await requestFollowingRedirects(imageUrl, CARD_IMAGE_FETCH_LIMITS.maximumImageBytes, context);
  if (image === null || image.response.status !== 200 || image.response.exceededLimit) return null;
  const format = detectProductImageFormat(image.response.body);
  return format === null ? null : { bytes: new Uint8Array(image.response.body), format };
}

/**
 * カード画像の取得を作る。
 * @param options.isAllowedAddress 接続してよいアドレスか（テストでは差し替える）。省略するとインターネットのアドレスだけ
 * @param options.timeoutMilliseconds 全体の時間の上限（テストでは短くする）
 */
export function createCardImageFetcher(
  options: { readonly isAllowedAddress?: (address: string) => boolean; readonly timeoutMilliseconds?: number } = {},
): CardImageFetcher {
  const isAllowedAddress = options.isAllowedAddress ?? isPublicNetworkAddress;
  const timeoutMilliseconds = options.timeoutMilliseconds ?? CARD_IMAGE_FETCH_LIMITS.timeoutMilliseconds;
  return {
    async fetchCardImage(pageUrl) {
      const url = parseHttpUrl(pageUrl);
      if (url === null) return null;
      const context: RequestContext = { signal: AbortSignal.timeout(timeoutMilliseconds), isAllowedAddress };
      try {
        const imageUrl = await findCardImageUrlOfPage(url, context);
        return imageUrl === null ? null : await fetchImage(imageUrl, context);
      } catch {
        return null;
      }
    },
  };
}
