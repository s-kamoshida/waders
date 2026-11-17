import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWebApplication } from '../../../server/presentation/webApplication.ts';

let temporaryDirectory: string;
let clientBuildDirectory: string;

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'waders-web-'));
  clientBuildDirectory = join(temporaryDirectory, 'client');
});

afterEach(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

/** ビルド済みの画面を模したファイルを置く。 */
function writeClientBuild(): void {
  mkdirSync(clientBuildDirectory, { recursive: true });
  writeFileSync(join(clientBuildDirectory, 'index.html'), '<!doctype html><title>Waders</title>');
}

/** CSP が自サイト以外を禁止していることを確かめる。 */
function expectSelfOnlyContentSecurityPolicy(headerValue: string | undefined): void {
  expect(headerValue).toBeDefined();
  expect(headerValue).toContain("default-src 'none'");
  expect(headerValue).toContain("script-src 'self'");
  expect(headerValue).toContain("style-src 'self'");
  expect(headerValue).toContain("frame-ancestors 'none'");
  expect(headerValue).not.toContain('unsafe-inline');
  expect(headerValue).not.toContain('unsafe-eval');
}

describe('GET /api/health', () => {
  it('動作確認の要求の場合、200 と { status: "ok" } を返す', async () => {
    const response = await request(createWebApplication({ clientBuildDirectory })).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('API の応答に、自サイト以外を禁止する CSP を付ける', async () => {
    const response = await request(createWebApplication({ clientBuildDirectory })).get('/api/health');

    expectSelfOnlyContentSecurityPolicy(response.headers['content-security-policy']);
  });
});

describe('存在しない API', () => {
  it('存在しない API の場合、404 を JSON で返す', async () => {
    writeClientBuild();

    const response = await request(createWebApplication({ clientBuildDirectory })).get('/api/unknown');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
  });
});

describe('画面の配信', () => {
  it('ビルド済みの画面がある場合、/ に index.html を返し、CSP を付ける', async () => {
    writeClientBuild();

    const response = await request(createWebApplication({ clientBuildDirectory })).get('/');

    expect(response.status).toBe(200);
    expect(response.text).toContain('<title>Waders</title>');
    expectSelfOnlyContentSecurityPolicy(response.headers['content-security-policy']);
  });

  it('画面の URL（/archive など）の場合も index.html を返す', async () => {
    writeClientBuild();

    const response = await request(createWebApplication({ clientBuildDirectory })).get('/archive');

    expect(response.status).toBe(200);
    expect(response.text).toContain('<title>Waders</title>');
  });

  it('ビルド済みの画面がない場合も、API は使える', async () => {
    const response = await request(createWebApplication({ clientBuildDirectory })).get('/api/health');

    expect(response.status).toBe(200);
  });
});
