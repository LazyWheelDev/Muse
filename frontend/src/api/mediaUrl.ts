const localMediaPrefix = '/api/v1/media/';
const maximumDecodePasses = 5;
const maximumMediaUrlLength = 2_048;

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

export function decodeSafeLocalMediaUrl(value: unknown, label = 'media URL'): string {
  if (
    typeof value !== 'string' ||
    value.length > maximumMediaUrlLength ||
    !value.startsWith(localMediaPrefix)
  ) {
    throw new Error(`${label} must be a local Muse media URL.`);
  }

  if (
    value.startsWith('//') ||
    value.includes('\\') ||
    value.includes('?') ||
    value.includes('#') ||
    containsControlCharacter(value)
  ) {
    throw new Error(`${label} must not contain an unsafe path.`);
  }

  let decoded = value;
  let stabilized = false;

  for (let pass = 0; pass < maximumDecodePasses; pass += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new Error(`${label} contains invalid encoding.`);
    }

    if (next === decoded) {
      stabilized = true;
      break;
    }
    decoded = next;
  }

  if (!stabilized) {
    throw new Error(`${label} contains excessive encoding.`);
  }

  const pathSegments = decoded.split('/');
  if (
    !decoded.startsWith(localMediaPrefix) ||
    decoded.length === localMediaPrefix.length ||
    decoded.includes('\\') ||
    decoded.includes('?') ||
    decoded.includes('#') ||
    containsControlCharacter(decoded) ||
    pathSegments.some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error(`${label} contains an unsafe path.`);
  }

  return value;
}
