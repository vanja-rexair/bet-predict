import { openDb } from './db.ts';
import { ingestAll, ingestPbp, backfillOdds } from './pipeline/ingest.ts';

const db = openDb();
switch (process.argv[2]) {
  case 'ingest':
    await ingestAll(db);
    break;
  case 'pbp':
    await ingestPbp(db);
    break;
  case 'odds':
    await backfillOdds(db);
    break;
  case 'train': {
    const { train } = await import('./pipeline/train.ts');
    train(db);
    break;
  }
  case 'update': {
    const { update } = await import('./pipeline/update.ts');
    await update(db);
    break;
  }
  default:
    console.error('Komande: ingest | pbp | odds | train | update');
    process.exitCode = 1;
}
