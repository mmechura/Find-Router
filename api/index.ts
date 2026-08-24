import app from '../src/app.js';

// Vercel serverless entrypoint: an Express app is itself a valid
// (req, res) request handler, so exporting it directly is enough - Vercel
// invokes this per-request instead of us calling app.listen() anywhere.
export default app;
