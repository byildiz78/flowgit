import { Pool } from 'pg';

const createPool = () => {
  try {
    const pool = new Pool({
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      host: process.env.POSTGRES_HOST,
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB,
      ssl: process.env.POSTGRES_SSL === 'true',
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      max: 20
    });

    pool.on('error', (err) => {
      console.error('[DB ERROR] Unexpected error on idle client:', err);
    });

    return pool;
  } catch (error) {
    console.error('[DB ERROR] Failed to initialize database pool:', error);
    return null;
  }
};

const pool = createPool();

export default pool;