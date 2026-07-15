import { describe, expect, it } from 'vitest';

import { resolveApiBasePath } from './config';

describe('resolveApiBasePath', () => {
  it('uses the versioned same-origin default', () => {
    expect(resolveApiBasePath(undefined)).toBe('/api/v1');
    expect(resolveApiBasePath('   ')).toBe('/api/v1');
  });

  it('normalizes trailing slashes', () => {
    expect(resolveApiBasePath('/local/api/v1///')).toBe('/local/api/v1');
  });

  it.each([
    '/',
    'api/v1',
    '//remote.example/api',
    'https://remote.example/api',
    '/api/v1?debug=true',
    '/api/v1#fragment',
    '/api/../v1',
    '/api\\v1',
    '/\t/remote',
    '/\n/remote',
    '/api /v1',
  ])('rejects unsafe or non-relative configuration: %s', (configuredPath) => {
    expect(() => resolveApiBasePath(configuredPath)).toThrow(
      /root-relative URL path|relative path segments/,
    );
  });
});
