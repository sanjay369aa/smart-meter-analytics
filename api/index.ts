import { createApiApp } from '../src/server/app';

/**
 * Vercel Serverless Function entry point.
 * Handles all `/api/*` requests routed via vercel.json without importing Vite dev tooling.
 */
const app = createApiApp({ mountRootFallback: true });

export default app;
