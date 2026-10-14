import { createServer, type Server } from 'node:http';
import { record, string } from './assertions.js';

export const wallet = `0x${'1'.repeat(40)}`;
export const recipient = `0x${'2'.repeat(40)}`;
export const token = `0x${'a'.repeat(40)}`;
export const contract = `0x${'c'.repeat(40)}`;
export const hash = `0x${'3'.repeat(64)}`;
export const blockHash = `0x${'4'.repeat(64)}`;
export const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const decimalAmount = '900719925474099300000000000';
export const date = '2026-01-01T00:00:00.000Z';
const blockByTransaction = new Map<string, number>();

export function fixtureBlock(number = 101) {
  const hexadecimal = `0x${number.toString(16)}`;
  const transactionHash = number === 101 ? hash : `0x${number.toString(16).padStart(64, '0')}`;
  const currentBlockHash = number === 101 ? blockHash : `0x${(number + 1000).toString(16).padStart(64, '0')}`;
  blockByTransaction.set(transactionHash, number);
  return {
    number: hexadecimal, hash: currentBlockHash,
    parentHash: `0x${'0'.repeat(64)}`, miner: wallet, timestamp: '0x6955b900', gasLimit: '0x1c9c380', gasUsed: '0x5208',
    transactions: [{ hash: transactionHash, blockNumber: hexadecimal, blockHash: currentBlockHash, transactionIndex: '0x0', from: wallet,
      to: contract, nonce: '0x0', value: '0x1', gas: '0x30d40', gasPrice: '0x1', input: '0xa9059cbb', type: '0x2' }],
  };
}

export function fixtureReceipt(transactionHash = hash) {
  const encodedNumber = BigInt(transactionHash);
  const number = blockByTransaction.get(transactionHash) ?? (transactionHash !== hash && encodedNumber <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(encodedNumber) : 101);
  const block = fixtureBlock(number);
  return { transactionHash, transactionIndex: '0x0', blockHash: block.hash, blockNumber: block.number, from: wallet, to: contract,
    cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x1', contractAddress: null,
    logs: [{ address: token, topics: [transferTopic, `0x${wallet.slice(2).padStart(64, '0')}`, `0x${recipient.slice(2).padStart(64, '0')}`],
      data: `0x${BigInt(decimalAmount).toString(16).padStart(64, '0')}`, blockNumber: block.number, transactionHash,
      transactionIndex: '0x0', blockHash: block.hash, logIndex: '0x0', removed: false }],
    logsBloom: `0x${'0'.repeat(512)}`, status: '0x1' };
}

export interface ProviderFixture { server: Server; url: string; requests: Map<string, number>; stop: () => Promise<void>; }

export async function startProviderFixture(): Promise<ProviderFixture> {
  const requests = new Map<string, number>();
  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET') {
        const pathname = new URL(request.url ?? '/', 'http://fixture').pathname;
        response.setHeader('Content-Type', 'application/json');
        if (pathname.includes('getsourcecode') || pathname.includes('/v2/api')) {
          response.end(JSON.stringify({ status: '1', message: 'OK', result: [{ SourceCode: 'contract Fixture {}', ABI: '[]', ContractName: 'Fixture', CompilerVersion: 'v0.8.24', OptimizationUsed: '0', Runs: '0', ConstructorArguments: '' }] }));
        } else response.end(JSON.stringify({ ethereum: { usd: 2000, usd_24h_change: 1, usd_market_cap: 1000000 }, [token]: { usd: 1, usd_24h_change: 0, usd_market_cap: 1000000 } }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const handle = (value: unknown) => {
        const rpc = record(value); const method = string(rpc.method); const parameters = Array.isArray(rpc.params) ? rpc.params : [];
        requests.set(method, (requests.get(method) ?? 0) + 1);
        let result: unknown = null;
        if (method === 'eth_chainId') result = '0xaa36a7';
        if (method === 'eth_blockNumber') result = '0x65';
        if (method === 'eth_getBlockByNumber') result = { ...fixtureBlock(typeof parameters[0] === 'string' && /^0x[\da-f]+$/i.test(parameters[0]) ? Number(BigInt(parameters[0])) : 101), transactions: [] };
        if (method === 'eth_getTransactionReceipt') result = fixtureReceipt(typeof parameters[0] === 'string' ? parameters[0] : hash);
        if (method === 'eth_getBalance') result = '0x0';
        if (method === 'eth_getCode') result = parameters[0] === contract || parameters[0] === token ? '0x6000' : '0x';
        if (method === 'eth_call') {
          const call = record(parameters[0]);
          result = call.data === '0x313ce567' ? '0x' + (18).toString(16).padStart(64, '0') : '0x' + '0'.repeat(64);
        }
        if (method === 'debug_traceTransaction') result = { type: 'CALL', from: wallet, to: contract, value: '0x1', gas: '0x30d40', gasUsed: '0x5208', input: '0xa9059cbb', output: '0x', calls: [{ type: 'CALL', from: contract, to: recipient, value: '0x2', gas: '0x100', gasUsed: '0x10', input: '0x', output: '0x' }] };
        return { jsonrpc: '2.0', id: rpc.id, result };
      };
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(Array.isArray(body) ? body.map(handle) : handle(body)));
    } catch { response.writeHead(400).end('{}'); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('HTTP fixture has no TCP address');
  return { server, url: `http://127.0.0.1:${address.port}`, requests, stop: async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  } };
}
