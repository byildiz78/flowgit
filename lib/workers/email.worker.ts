import { parentPort } from 'worker_threads';
import { EmailProcessor } from '../processors/imap.processor';
import pool from '../db';
import { FlowService } from '../services/flow.service';

let isProcessing = false;
let processor: EmailProcessor | null = null;

async function processEmails() {
  if (isProcessing) {
    console.log('[WORKER] Already processing emails, skipping...');
    return;
  }

  try {
    isProcessing = true;
    
    // Initialize processor if not exists
    if (!processor) {
      processor = new EmailProcessor();
    }

    // Get database connection
    const client = await pool.connect();
    
    try {
      // Process new emails
      await processor.processEmails();
      
      // Get unprocessed emails that need to be sent to Flow
      const result = await client.query(`
        SELECT e.* 
        FROM emails e 
        LEFT JOIN email_flow_locks l ON e.id = l.email_id 
        WHERE e.senttoflow = false 
        AND (l.locked_until IS NULL OR l.locked_until < NOW())
        LIMIT 10
      `);

      for (const email of result.rows) {
        // Try to acquire lock
        const lockResult = await client.query(`
          INSERT INTO email_flow_locks (email_id, locked_until)
          VALUES ($1, NOW() + INTERVAL '5 minutes')
          ON CONFLICT (email_id) 
          DO UPDATE SET locked_until = NOW() + INTERVAL '5 minutes'
          WHERE email_flow_locks.locked_until < NOW()
          RETURNING *
        `, [email.id]);

        // If we got the lock, process the email
        if (lockResult.rows.length > 0) {
          try {
            await FlowService.sendToFlow(client, email.id, email);
            // Release lock after successful processing
            await client.query('DELETE FROM email_flow_locks WHERE email_id = $1', [email.id]);
          } catch (error) {
            console.error(`[WORKER] Error sending email ${email.id} to Flow:`, error);
            // Release lock on error
            await client.query('DELETE FROM email_flow_locks WHERE email_id = $1', [email.id]);
          }
        }
      }

    } finally {
      client.release();
    }

  } catch (error) {
    console.error('[WORKER] Error processing emails:', error);
  } finally {
    isProcessing = false;
  }
}

// Listen for messages from the main thread
parentPort?.on('message', async (message) => {
  if (message === 'start') {
    await processEmails();
    parentPort?.postMessage('done');
  }
});

// Handle cleanup
process.on('SIGTERM', async () => {
  if (processor) {
    await processor.disconnect();
  }
  process.exit(0);
});
