import { applyCrmMigrations } from "./migrate";

applyCrmMigrations()
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  })
  .catch((err) => {
    process.stderr.write(String(err instanceof Error ? err.stack ?? err.message : err));
    process.exit(1);
  });
