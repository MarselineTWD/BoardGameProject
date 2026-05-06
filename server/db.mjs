import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

pg.types.setTypeParser(1700, (value) => Number(value));
pg.types.setTypeParser(1082, (value) => value);

const { Pool } = pg;

export const connectionString =
  process.env.DATABASE_URL ??
  'postgres://boardgame:boardgame@localhost:5432/boardgameproject';

export const pool = new Pool({
  connectionString,
});

export async function closePool() {
  await pool.end();
}
