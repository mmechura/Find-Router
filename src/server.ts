import app from './app.js';
import { config } from './config.js';

// Local dev / Docker entrypoint. On Vercel, api/index.ts imports app.ts
// directly and Vercel itself invokes it per-request - nothing calls
// app.listen() there.
app.listen(config.port, () => {
  console.log(`Find-Router běží na ${config.baseUrl}`);
});
