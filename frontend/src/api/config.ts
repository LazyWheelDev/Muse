const defaultApiBasePath = '/api/v1';

export function resolveApiBasePath(configuredPath: string | undefined): string {
  const candidate = configuredPath?.trim() || defaultApiBasePath;

  if (
    candidate === '/' ||
    !candidate.startsWith('/') ||
    candidate.startsWith('//') ||
    candidate.includes('://') ||
    candidate.includes('?') ||
    candidate.includes('#') ||
    candidate.includes('\\') ||
    [...candidate].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 32 || codePoint === 127;
    })
  ) {
    throw new Error('VITE_API_BASE_PATH must be a root-relative URL path.');
  }

  const segments = candidate.split('/');

  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('VITE_API_BASE_PATH cannot contain relative path segments.');
  }

  return candidate.replace(/\/+$/, '');
}

export const apiBasePath = resolveApiBasePath(import.meta.env.VITE_API_BASE_PATH);

export function createApiUrl(endpointPath: `/${string}`): string {
  return `${apiBasePath}${endpointPath}`;
}
