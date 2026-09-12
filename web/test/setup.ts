import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// globals: false 라서 RTL 의 자동 cleanup 이 걸리지 않는다. 직접 건다.
afterEach(() => {
  cleanup();
});
