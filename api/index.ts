import { createApiApp } from '../src/server/app.js';

/**
 * Vercel Serverless Function entry point.
 * Uses explicit `.js` relative import specifiers required by Node.js native ESM ("type": "module").
 */
const app = createApiApp({ mountRootFallback: true });

export default app;
