import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { startTestEnvironment } from '../../tests/dist/helpers/test-environment.js';
import { saveReport } from './report.mjs';
const { Pool } = createRequire(new URL('../../tests/package.json', import.meta.url))('pg');

export async function auditDatabase(environment) {
  const explorer = new Pool({ connectionString: environment.databaseUrls.explorer });
  const portfolio = new Pool({ connectionString: environment.databaseUrls.portfolio });
  const plans = [];
  const explain = async (pool, label, sql, parameters = []) => {
    const { rows } = await pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, parameters);
    const result = rows[0]['QUERY PLAN'][0];
    plans.push({ label, sql, executionMs: result['Execution Time'], planningMs: result['Planning Time'], plan: result.Plan });
    console.log(`${label}: ${result['Execution Time']} ms (${result.Plan['Node Type']})`);
  };
  try {
    await explorer.query('BEGIN'); await portfolio.query('BEGIN');
    await explorer.query(`INSERT INTO blocks(number,hash,parent_hash,timestamp,gas_limit,gas_used,transaction_count)
      SELECT n,'0x'||lpad(to_hex(n),64,'0'),'0x'||lpad(to_hex(n-1),64,'0'),now()-n*interval '12 seconds',30000000,1000000,50 FROM generate_series(10000,10199) n`);
    await explorer.query(`INSERT INTO tokens(address,name,symbol,decimals) SELECT '0x'||lpad(to_hex(n),40,'0'),'Synthetic '||n,'SYN'||n,18 FROM generate_series(1000,1019) n`);
    await explorer.query(`INSERT INTO transactions(hash,block_number,block_hash,transaction_index,from_address,to_address,nonce,value,gas)
      SELECT '0x'||lpad(to_hex(n),64,'0'),10000+(n-1)/50,'0x'||lpad(to_hex(10000+(n-1)/50),64,'0'),(n-1)%50,
      '0x'||lpad(to_hex(2000+n%100),40,'0'),'0x'||lpad(to_hex(3000+n%100),40,'0'),n,1000,21000 FROM generate_series(1,10000) n`);
    await explorer.query(`INSERT INTO token_transfers(transaction_hash,block_number,token_address,from_address,to_address,amount,transaction_index,log_index)
      SELECT hash,block_number,'0x'||lpad(to_hex(1000+nonce::integer%20),40,'0'),from_address,to_address,1000,transaction_index,0 FROM transactions WHERE block_number BETWEEN 10000 AND 10199`);
    await explorer.query(`INSERT INTO outbox_events(event_type,payload,status,available_at,created_at)
      SELECT 'benchmark','{}',CASE WHEN n<=100 THEN 'pending' ELSE 'published' END,now()-n*interval '1 second',now()-n*interval '2 seconds' FROM generate_series(1,10100) n`);
    await portfolio.query(`INSERT INTO portfolios(id,user_id,wallet_address,chain_id,name) VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','0x0000000000000000000000000000000000000001',11155111,'Benchmark')`);
    await portfolio.query(`INSERT INTO portfolio_snapshots(portfolio_id,total_value_usd,recorded_at) SELECT '00000000-0000-4000-8000-000000000001',100+n,now()-n*interval '1 minute' FROM generate_series(1,2000) n`);
    await portfolio.query(`INSERT INTO alerts(user_id,type,enabled,wallet_address) SELECT '00000000-0000-4000-8000-000000000002','wallet_activity',true,'0x'||lpad(to_hex(n),40,'0') FROM generate_series(1,200) n`);
    await explorer.query('ANALYZE blocks,transactions,tokens,token_transfers,outbox_events'); await portfolio.query('ANALYZE portfolios,portfolio_snapshots,alerts');
    const token = '0x' + (1001).toString(16).padStart(40, '0');
    const tokenSql = 'SELECT * FROM token_transfers WHERE token_address=$1 ORDER BY block_number DESC LIMIT 20 OFFSET 200';
    // Reconstruct the committed pre-phase indexes only in this disposable transaction.
    await explorer.query('DROP INDEX IF EXISTS token_transfers_token_block_idx');
    await explorer.query('CREATE INDEX IF NOT EXISTS token_transfers_token_idx ON token_transfers(token_address)');
    await explorer.query('DROP INDEX IF EXISTS outbox_status_available_idx');
    await explorer.query('CREATE INDEX IF NOT EXISTS outbox_status_idx ON outbox_events(status)');
    await explorer.query('CREATE INDEX IF NOT EXISTS outbox_available_at_idx ON outbox_events(available_at)');
    await explain(explorer, 'token-history-before', tokenSql, [token]);
    await explain(explorer, 'outbox-before', "SELECT * FROM outbox_events WHERE status='pending' AND available_at<=now() ORDER BY created_at ASC LIMIT 100");
    await explain(explorer, 'outbox-stale-recovery', "SELECT id FROM outbox_events WHERE status='processing' AND available_at<=now()");
    await explorer.query('DROP INDEX token_transfers_token_idx');
    await explorer.query('CREATE INDEX token_transfers_token_block_idx ON token_transfers(token_address,block_number DESC)');
    await explorer.query('DROP INDEX outbox_status_idx'); await explorer.query('DROP INDEX outbox_available_at_idx');
    await explorer.query('CREATE INDEX outbox_status_available_idx ON outbox_events(status,available_at)');
    await explain(explorer, 'token-history-after', tokenSql, [token]);
    await explain(explorer, 'outbox-after', "SELECT * FROM outbox_events WHERE status='pending' AND available_at<=now() ORDER BY created_at ASC LIMIT 100");
    await explain(explorer, 'block-page', 'SELECT * FROM blocks ORDER BY number DESC LIMIT 20');
    await explain(explorer, 'transaction-address-page', 'SELECT * FROM transactions WHERE from_address=$1 OR to_address=$1 ORDER BY block_number DESC LIMIT 20', ['0x'+(2001).toString(16).padStart(40,'0')]);
    await explain(portfolio, 'portfolio-snapshot-range', "SELECT * FROM portfolio_snapshots WHERE portfolio_id=$1 AND recorded_at>=now()-interval '24 hours' ORDER BY recorded_at DESC LIMIT 200", ['00000000-0000-4000-8000-000000000001']);
    await explain(portfolio, 'owned-alert-list', 'SELECT * FROM alerts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', ['00000000-0000-4000-8000-000000000002']);
    return { dataset: { blocks: 200, transactions: 10000, transfers: 10000, outbox: 10100, snapshots: 2000, alerts: 200 }, plans, isolation: 'Disposable Testcontainers only; transaction rollback removes every synthetic row and candidate index.' };
  } finally {
    await Promise.allSettled([explorer.query('ROLLBACK'), portfolio.query('ROLLBACK')]);
    await Promise.all([explorer.end(), portfolio.end()]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const test = await startTestEnvironment();
  try { await saveReport('database', await auditDatabase(test.environment)); }
  finally { await test.stop(); }
}
