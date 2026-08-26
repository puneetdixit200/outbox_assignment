import { query, pool } from './client.js';
const user = await query<{id:string}>('INSERT INTO users (email,name) VALUES ($1,$2) ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name RETURNING id', ['demo@outbox.local','Demo User']);
await query('INSERT INTO sender_accounts (owner_user_id,display_name,from_email) SELECT $1,$2,$3 WHERE NOT EXISTS (SELECT 1 FROM sender_accounts WHERE owner_user_id=$1)', [user.rows[0].id,'Demo Sender','demo@outbox.local']);
await query('INSERT INTO sender_accounts (owner_user_id,display_name,from_email) SELECT $1,$2,$3 WHERE NOT EXISTS (SELECT 1 FROM sender_accounts WHERE owner_user_id=$1 AND from_email=$3)', [user.rows[0].id,'Demo Sender 2','demo2@outbox.local']);
await pool.end(); console.log('demo data ready');
