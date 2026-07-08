import { env } from "./env";
import { createApp } from "./app";

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`[api] listening on http://localhost:${env.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[api] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
  });
}
