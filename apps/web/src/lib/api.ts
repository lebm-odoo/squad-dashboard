import type { AppType } from '@sd/server';
import { DetailedError, hc } from 'hono/client';

export const api = hc<AppType>('/').api;

export const messageOf = (error: unknown) =>
  error instanceof DetailedError && typeof error.detail?.data?.error === 'string'
    ? error.detail.data.error
    : error instanceof Error
      ? error.message
      : String(error);
