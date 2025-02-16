import { Pool } from 'pg';
import { promises as fs } from 'fs';
import path from 'path';

async function initializeDatabase() {
  const pool = new Pool({
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    host: process.env.POSTGRES_HOST,
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB,
    ssl: process.env.POSTGRES_SSL === 'true',
  });

  try {
    const client = await pool.connect();
    try {
      const sqlPath = path.join(process.cwd(), 'supabase/migrations/20250215092710_rapid_prism.sql');
      const sqlContent = await fs.readFile(sqlPath, 'utf-8');
      
      await client.query(sqlContent);
      console.log('Database schema initialized successfully');
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

initializeDatabase().catch(console.error);