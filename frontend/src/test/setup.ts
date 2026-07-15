import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

import { installCanvasMock } from './canvasMock';

installCanvasMock();

afterEach(() => {
  cleanup();
});
