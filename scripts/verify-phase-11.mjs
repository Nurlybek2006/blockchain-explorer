import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { createServer as createTcpServer } from "node:net";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

// Real OTLP ingestion into the local monitoring stack, isolated application databases,
// Redis/BullMQ and RabbitMQ topology, plus deterministic blockchain/price fixtures.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiRequire = createRequire(
  resolve(root, "apps/api-gateway/package.json"),
);
const messagingRequire = createRequire(
  resolve(root, "packages/messaging/package.json"),
);
const indexerRequire = createRequire(
  resolve(root, "apps/indexer-service/package.json"),
);
const { WebSocket } = apiRequire("ws");
const { parse } = apiRequire("dotenv");
const { Pool } = apiRequire("pg");
const { drizzle } = apiRequire("drizzle-orm/node-postgres");
const { migrate } = apiRequire("drizzle-orm/node-postgres/migrator");
const { createClient } = messagingRequire("redis");
const amqp = messagingRequire("amqplib");
const sourceEnv = {
  ...parse(await readFile(resolve(root, ".env"))),
  ...process.env,
};
const runId = randomBytes(12).toString("hex");
const telemetryEnvironment = "phase11-verification-" + runId;
const marker = `phase11-verification:${runId}`;
const cachePrefix = `phase11:${runId}`;
const requestId = "phase11-" + runId;
const traceId = randomBytes(16).toString("hex");
const parentSpanId = randomBytes(8).toString("hex");
const traceparent = "00-" + traceId + "-" + parentSpanId + "-01";
const startedAt = Date.now();
const queueName = `phase11-${runId}-jobs`;
const exchangeName = `phase11.${runId}.events`;
const consumerQueue = `phase11.${runId}.portfolio`;
const explorerQueuePrefix = `phase11-${runId}-explorer`;
const apiUrl = "http://127.0.0.1:3700";
const webUrl = "http://127.0.0.1:3703";
const env = {
  ...sourceEnv,
  NODE_ENV: "test",
  API_RATE_LIMIT_ENABLED: "false",
  OTEL_ENABLED: "true",
  OTEL_SERVICE_NAME: undefined,
  OTEL_SAMPLE_RATIO: "1",
  OTEL_METRIC_EXPORT_INTERVAL_MS: "1000",
  DEPLOYMENT_ENVIRONMENT: telemetryEnvironment,
  LOG_FORMAT: "json",
  LOG_LEVEL: "info",
  API_GATEWAY_PORT: "3700",
  INDEXER_PORT: "3701",
  PORTFOLIO_PORT: "3702",
  INDEXER_ENABLED: "false",
  PRICE_SCHEDULER_ENABLED: "false",
  EXPLORER_ENRICHMENT_ENABLED: "true",
  CONTRACT_VERIFICATION_ENABLED: "true",
  TRACE_ENABLED: "true",
  ETHERSCAN_API_KEY: "phase11-fixture-key",
  ETHERSCAN_MAX_RETRIES: "0",
  ETHERSCAN_CHAIN_ID: "11155111",
  TRACE_ONLY_CONTRACT_INTERACTIONS: "true",
  REALTIME_ENABLED: "true",
  ETHERSCAN_REQUESTS_PER_SECOND: "10",
  CONTRACT_VERIFICATION_COOLDOWN_MS: "86400000",
  TRACE_MAX_RETRIES: "1",
  TRACE_TIMEOUT_MS: "5000",
  EXPLORER_JOBS_QUEUE_PREFIX: explorerQueuePrefix,
  REALTIME_EVENTS_QUEUE: `phase11.${runId}.realtime`,
  NETWORK_STATUS_INTERVAL_MS: "1000",
  INDEXER_INTERNAL_URL: "http://127.0.0.1:3701",
  PORTFOLIO_INTERNAL_URL: "http://127.0.0.1:3702",
  WEB_ORIGIN: webUrl,
  ETHEREUM_CHAIN_ID: "11155111",
  INTERNAL_SERVICE_TOKEN: randomBytes(40).toString("base64url"),
  JWT_ACCESS_SECRET: randomBytes(48).toString("base64url"),
  JWT_REFRESH_SECRET: randomBytes(48).toString("base64url"),
  BCRYPT_ROUNDS: "10",
  CACHE_PREFIX: cachePrefix,
  PORTFOLIO_QUEUE_NAME: queueName,
  RABBITMQ_EXCHANGE: exchangeName,
  PORTFOLIO_EVENTS_QUEUE: consumerQueue,
  COINGECKO_API_KEY: "",
  COINGECKO_MAX_RETRIES: "0",
  COINGECKO_TIMEOUT_MS: "2000",
  COINGECKO_REQUESTS_PER_SECOND: "20",
  COINGECKO_MAX_CONCURRENT_REQUESTS: "2",
  PRICE_CACHE_TTL_SECONDS: "1",
  PRICE_UNAVAILABLE_CACHE_TTL_SECONDS: "1",
  PRICE_STALE_AFTER_SECONDS: "3700",
  PRICE_REFRESH_INTERVAL_MS: "86400000",
  PORTFOLIO_SNAPSHOT_INTERVAL_MS: "86400000",
  RPC_MAX_RETRIES: "0",
  RPC_TIMEOUT_MS: "2000",
  RPC_REQUESTS_PER_SECOND: "20",
};
const tokenAddress = `0x${"a".repeat(40)}`;
const wallet = `0x${randomBytes(20).toString("hex")}`;
const recipient = `0x${randomBytes(20).toString("hex")}`;
const transactionHash = `0x${randomBytes(32).toString("hex")}`;
const blockHash = `0x${randomBytes(32).toString("hex")}`;
const secrets = new Set(
  Object.entries({ ...sourceEnv, ...env })
    .filter(([key]) => /SECRET|PASSWORD|TOKEN|URL|API_KEY/.test(key))
    .map(([, value]) => value)
    .filter((value) => typeof value === "string" && value.length > 3),
);
const frontendPrivateValues = Object.entries({ ...sourceEnv, ...env })
  .filter(([key]) =>
    /SECRET|PASSWORD|TOKEN|DATABASE_URL|REDIS_URL|RABBITMQ_URL|ETHEREUM_RPC_URL|API_KEY/.test(
      key,
    ),
  )
  .map(([, value]) => value)
  .filter((value) => typeof value === "string" && value.length > 15);
const children = [];
const databases = [];
let redis;
let broker;
let explorerDb;
let fixtureServer;
const contractAddress = "0x" + "c".repeat(40);
const unverifiedAddress = "0x" + "d".repeat(40);
const discoveredAddress = "0x" + "e".repeat(40);
const creationHash = "0x" + randomBytes(32).toString("hex");
const interactionHash = "0x" + randomBytes(32).toString("hex");
const unsupportedHash = "0x" + randomBytes(32).toString("hex");
const newBlockHash = "0x" + randomBytes(32).toString("hex");
const fixtureCounts = { verification: new Map(), code: new Map(), traces: 0 };
let socket;
const socketEvents = [];
let ethPrice = "99";
let fixtureTimestamp = Math.floor(Date.now() / 1000);
let interrupted = false;
let checks = 0;
process.once("SIGINT", () => {
  interrupted = true;
});
process.once("SIGTERM", () => {
  interrupted = true;
});

function redact(input) {
  let text = String(input);
  for (const value of [...secrets].sort(
    (left, right) => right.length - left.length,
  ))
    text = text.split(value).join("[redacted]");
  return text
    .replace(
      /(?:postgres(?:ql)?|amqps?|rediss?|https?):\/\/[^\s"'<>]+/gi,
      "[redacted-url]",
    )
    .replace(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      "[redacted-jwt]",
    )
    .replace(/\$2[aby]\$\d\d\$[A-Za-z0-9./]+/g, "[redacted-password-hash]");
}

function running() {
  if (interrupted) throw new Error("Verification interrupted");
  for (const child of children)
    if (child.exited) throw new Error(`${child.name} exited unexpectedly`);
}

async function check(label, action) {
  running();
  await action();
  checks += 1;
  console.log(`PASS ${label}`);
}

function publicData(value) {
  if (value === null || typeof value !== "object") return;
  assert(
    !Object.hasOwn(value, "passwordHash") &&
      !Object.hasOwn(value, "password_hash"),
    "Password hash exposed",
  );
  for (const child of Object.values(value)) publicData(child);
}

async function request(
  base,
  method,
  path,
  expected,
  body,
  token,
  internal = false,
) {
  running();
  const response = await fetch(`${base}${path}`, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    headers: {
      accept: "application/json",
      "x-request-id": requestId,
      traceparent,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(internal
        ? { "x-internal-service-token": env.INTERNAL_SERVICE_TOKEN }
        : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let value;
  if (text) {
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error(`${method} ${path}: non-JSON response`);
    }
  }
  publicData(value);
  for (const key of ["accessToken", "refreshToken"])
    if (typeof value?.[key] === "string") secrets.add(value[key]);
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: expected ${expected}, received ${response.status}`,
  );
  return value;
}
const api = (method, path, status, body, user) =>
  request(apiUrl, method, path, status, body, user?.accessToken);
const internal = (method, path, status, body) =>
  request(
    env.PORTFOLIO_INTERNAL_URL,
    method,
    path,
    status,
    body,
    undefined,
    true,
  );

async function eventually(label, action, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    running();
    const result = await action();
    if (result) return result;
    await delay(150);
  }
  throw new Error(`${label} timed out`);
}

async function freePort(port) {
  await new Promise((accept, reject) => {
    const server = createTcpServer();
    server.once("error", () =>
      reject(
        new Error(
          `Port ${port} is occupied; no existing process will be stopped`,
        ),
      ),
    );
    server.listen(port, "0.0.0.0", () =>
      server.close((error) => (error ? reject(error) : accept())),
    );
  });
}

function databaseUrl(original, name) {
  const url = new URL(original);
  assert(
    ["postgres:", "postgresql:"].includes(url.protocol),
    "Expected PostgreSQL URL",
  );
  url.pathname = `/${name}`;
  return url.toString();
}

function databaseIdentifier(name) {
  assert(
    /^phase11_[a-f0-9]{24}_(identity|explorer|portfolio)$/.test(name),
    "Refusing unrelated database operation",
  );
  assert(
    name.startsWith(`phase11_${runId}_`),
    "Refusing database operation for another run",
  );
  return `"${name}"`;
}

async function createTestDatabase(app, role, key) {
  const name = `phase11_${runId}_${role}`;
  const identifier = databaseIdentifier(name);
  const admin = new Pool({
    connectionString: databaseUrl(sourceEnv[key], "postgres"),
    connectionTimeoutMillis: 5000,
  });
  const database = { name, admin, pool: null, created: false, marked: false };
  databases.push(database);
  await admin.query(`CREATE DATABASE ${identifier}`);
  database.created = true;
  await admin.query(`COMMENT ON DATABASE ${identifier} IS '${marker}'`);
  database.marked = true;
  env[key] = databaseUrl(sourceEnv[key], name);
  secrets.add(env[key]);
  database.pool = new Pool({
    connectionString: env[key],
    connectionTimeoutMillis: 5000,
  });
  await migrate(drizzle(database.pool), {
    migrationsFolder: resolve(root, "apps", app, "src/database/migrations"),
  });
  if (role === "explorer") explorerDb = database.pool;
}

async function seedExplorer() {
  await explorerDb.query(
    "INSERT INTO blocks (number, hash, parent_hash, miner, timestamp, gas_limit, gas_used, base_fee_per_gas, transaction_count) VALUES ($1,$2,$3,$4,now(),$5,$6,$7,1)",
    [
      "10000",
      blockHash,
      `0x${"0".repeat(64)}`,
      wallet,
      "30000000",
      "21000",
      "10000000000",
    ],
  );
  await explorerDb.query(
    "INSERT INTO transactions (hash,block_number,block_hash,transaction_index,from_address,to_address,nonce,value,gas,gas_price,type,input) VALUES ($1,10000,$2,0,$3,$4,0,$5,21000,$6,2,$7)",
    [
      transactionHash,
      blockHash,
      wallet,
      recipient,
      "1000000000000000001",
      "20000000000",
      "0x",
    ],
  );
  await explorerDb.query(
    "INSERT INTO receipts (transaction_hash,block_number,status,cumulative_gas_used,gas_used,effective_gas_price) VALUES ($1,10000,true,21000,21000,$2)",
    [transactionHash, "20000000000"],
  );
  await explorerDb.query(
    "INSERT INTO tokens (address,name,symbol,decimals,total_supply,first_seen_block,last_updated_block) VALUES ($1,$2,$3,18,$4,10000,10000)",
    [tokenAddress, "Verification Token", "FIX", "1000000000000000000000001"],
  );
  await explorerDb.query(
    "INSERT INTO token_transfers (transaction_hash,block_number,token_address,from_address,to_address,amount,transaction_index,log_index) VALUES ($1,10000,$2,$3,$4,$5,0,0)",
    [transactionHash, tokenAddress, wallet, recipient, "1000000000000000001"],
  );
  await explorerDb.query(
    "INSERT INTO addresses (address,is_contract,native_balance_wei,transaction_count,first_seen_block,last_seen_block) VALUES ($1,false,$2,1,10000,10000),($3,false,0,1,10000,10000)",
    [wallet, "2000000000000000000", recipient],
  );
}

async function startFixtures() {
  fixtureServer = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      res.setHeader("content-type", "application/json");
      if (url.pathname === "/rpc") {
        let text = "";
        for await (const chunk of req) {
          text += chunk.toString();
          if (text.length > 1_048_576)
            throw new Error("Fixture request too large");
        }
        const input = JSON.parse(text);
        let result;
        if (input.method === "eth_chainId") result = "0xaa36a7";
        else if (input.method === "eth_blockNumber") result = "0x2711";
        else if (input.method === "eth_getBlockByNumber")
          result =
            input.params[0] === "0x2710"
              ? { number: "0x2710", hash: blockHash }
              : fixtureBlock();
        else if (input.method === "eth_getTransactionReceipt")
          result = fixtureReceipt(input.params[0]);
        else if (input.method === "eth_getCode") {
          const target = input.params[0].toLowerCase();
          fixtureCounts.code.set(
            target,
            (fixtureCounts.code.get(target) ?? 0) + 1,
          );
          result = [
            contractAddress,
            unverifiedAddress,
            discoveredAddress,
            tokenAddress,
          ].includes(target)
            ? "0x60006000"
            : "0x";
        } else if (input.method === "debug_traceTransaction") {
          fixtureCounts.traces++;
          if (input.params[0] === unsupportedHash) {
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                id: input.id,
                error: {
                  code: -32601,
                  message: "debug_traceTransaction is not supported",
                },
              }),
            );
            return;
          }
          assert.equal(input.params[1].tracer, "callTracer");
          result = fixtureTrace(input.params[0]);
        } else if (input.method === "eth_getBalance")
          result = "0x1bc16d674ec80000";
        else if (
          input.method === "eth_call" &&
          input.params?.[0]?.data?.startsWith("0x313ce567")
        )
          result = `0x${"12".padStart(64, "0")}`;
        else if (
          input.method === "eth_call" &&
          input.params?.[0]?.data?.startsWith("0x70a08231")
        )
          result = `0x${"0".repeat(64)}`;
        res.end(
          JSON.stringify(
            result === undefined
              ? {
                  jsonrpc: "2.0",
                  id: input.id,
                  error: {
                    code: -32601,
                    message: "Unsupported fixture RPC method",
                  },
                }
              : { jsonrpc: "2.0", id: input.id, result },
          ),
        );
        return;
      }
      if (url.pathname === "/v2/api") {
        assert.equal(url.searchParams.get("chainid"), "11155111");
        assert.equal(url.searchParams.get("action"), "getsourcecode");
        const target = url.searchParams.get("address").toLowerCase();
        fixtureCounts.verification.set(
          target,
          (fixtureCounts.verification.get(target) ?? 0) + 1,
        );
        res.end(
          JSON.stringify({
            status: "1",
            message: "OK",
            result: [
              {
                SourceCode:
                  target === unverifiedAddress
                    ? ""
                    : "pragma solidity ^0.8.24; contract Fixture { function ping() external {} }",
                ABI:
                  target === unverifiedAddress
                    ? "Contract source code not verified"
                    : JSON.stringify([
                        {
                          type: "function",
                          name: "ping",
                          inputs: [],
                          outputs: [],
                          stateMutability: "nonpayable",
                        },
                      ]),
                ContractName: "Fixture",
                CompilerVersion: "v0.8.24+commit.e11b9ed9",
                OptimizationUsed: "1",
                Runs: "200",
                ConstructorArguments: "",
              },
            ],
          }),
        );
        return;
      }
      const eth = url.pathname === "/api/v3/simple/price";
      const token = url.pathname === "/api/v3/simple/token_price/ethereum";
      if (!eth && !token) {
        res.statusCode = 404;
        res.end("{}");
        return;
      }
      const key = eth
        ? "ethereum"
        : url.searchParams.get("contract_addresses")?.toLowerCase();
      if (!eth && key !== tokenAddress) {
        res.end("{}");
        return;
      }
      fixtureTimestamp = Math.max(
        fixtureTimestamp + 1,
        Math.floor(Date.now() / 1000),
      );
      res.end(
        `{${JSON.stringify(key)}:{"usd":${eth ? ethPrice : "1"},"usd_24h_change":1.25,"usd_market_cap":1234567890.01,"last_updated_at":${fixtureTimestamp}}}`,
      );
    } catch {
      res.statusCode = 500;
      res.end('{"error":"Fixture request failed"}');
    }
  });
  await new Promise((accept, reject) => {
    fixtureServer.once("error", reject);
    fixtureServer.listen(0, "127.0.0.1", accept);
  });
  const address = fixtureServer.address();
  assert(address && typeof address === "object");
  env.ETHEREUM_RPC_URL = `http://127.0.0.1:${address.port}/rpc`;
  env.ETHERSCAN_BASE_URL = `http://127.0.0.1:${address.port}/v2/api`;
  env.COINGECKO_BASE_URL = `http://127.0.0.1:${address.port}/api/v3`;
}

function launch(name, args, cwd, launchEnv) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: launchEnv,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const service = { name, child, exited: false, logs: "" };
  const capture = (chunk) => {
    service.logs = `${service.logs}${redact(chunk.toString())}`.slice(-24_000);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.once("error", (error) => {
    capture(error.message);
    service.exited = true;
  });
  child.once("close", () => {
    service.exited = true;
  });
  children.push(service);
  return service;
}

function startService(name) {
  const entry = pathToFileURL(resolve(root, "apps", name, "dist/main.js")).href;
  const wrapper = `process.on('message', message => {
    if (message && message.type === 'phase11-verification-stop') process.emit('SIGTERM', 'SIGTERM');
  }); await import(${JSON.stringify(entry)});`;
  launch(
    name,
    ["--input-type=module", "--eval", wrapper],
    resolve(root, "apps", name),
    env,
  );
}

async function ready(name, base) {
  await eventually(
    `${name} readiness`,
    async () => {
      try {
        const response = await fetch(`${base}/health`, {
          signal: AbortSignal.timeout(2500),
        });
        if (!response.ok) return false;
        const value = await response.json();
        assert.equal(value.service, name);
        assert.equal(value.database, "connected");
        if (name !== "indexer-service") assert.equal(value.redis, "connected");
        if (name === "portfolio-service")
          assert.equal(value.rabbitmq, "connected");
        return true;
      } catch (error) {
        if (error instanceof assert.AssertionError) throw error;
        return false;
      }
    },
    45_000,
  );
}

async function register(label) {
  const email = `phase11-${label}-${runId}@example.com`;
  const password = `${randomBytes(24).toString("base64url")}Aa1!`;
  secrets.add(password);
  const result = await api("POST", "/auth/register", 201, {
    email,
    password,
    displayName: "Frontend Verification",
  });
  assert.equal(result.user.email, email);
  assert.equal(typeof result.user.id, "string");
  return { ...result, email, password };
}

async function stopChildren() {
  const results = await Promise.allSettled(
    children.map(async (service) => {
      if (service.exited) return;
      const closed = new Promise((accept) =>
        service.child.once("close", accept),
      );
      if (service.child.connected)
        service.child.send(
          { type: "phase11-verification-stop" },
          () => undefined,
        );
      else service.child.kill("SIGTERM");
      const graceful = await Promise.race([
        closed.then(() => true),
        delay(45_000, undefined, { ref: false }).then(() => false),
      ]);
      if (!graceful) {
        service.child.kill("SIGKILL");
        await Promise.race([closed, delay(5000, undefined, { ref: false })]);
        throw new Error(`${service.name} required forced shutdown`);
      }
    }),
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
}

async function cleanupRedis() {
  if (!redis?.isOpen) return;
  for (const prefix of [
    `${cachePrefix}:`,
    `bull:${queueName}:`,
    `bull:${explorerQueuePrefix}-verification:`,
    `bull:${explorerQueuePrefix}-traces:`,
  ]) {
    assert(prefix.includes(runId), "Refusing unrelated Redis namespace");
    for await (const result of redis.scanIterator({
      MATCH: `${prefix}*`,
      COUNT: 100,
    })) {
      const keys = Array.isArray(result) ? result : [result];
      assert(
        keys.every((key) => typeof key === "string" && key.startsWith(prefix)),
        "Refusing unrelated Redis key",
      );
      if (keys.length) await redis.del(keys);
    }
  }
}

async function cleanupBroker() {
  if (!broker) return;
  for (const [kind, name] of [
    ["queue", consumerQueue],
    ["queue", `${consumerQueue}.dlq`],
    ["exchange", exchangeName],
    ["exchange", `${exchangeName}.dlx`],
  ]) {
    assert(
      name.startsWith(`phase11.${runId}.`),
      "Refusing unrelated broker topology",
    );
    const channel = await broker.createChannel();
    channel.on("error", () => undefined);
    try {
      if (kind === "queue") await channel.deleteQueue(name);
      else await channel.deleteExchange(name);
    } catch (error) {
      if (error.code !== 404) throw error;
    } finally {
      await channel.close().catch(() => undefined);
    }
  }
}

async function cleanupDatabases() {
  for (const database of databases)
    if (database.pool) await database.pool.end();
  for (const database of databases) {
    if (!database.created) continue;
    const proof = await database.admin.query(
      "SELECT shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = $1",
      [database.name],
    );
    assert(
      database.marked &&
        proof.rows.length === 1 &&
        proof.rows[0].marker === marker,
      "Refusing database drop without this run ownership marker",
    );
    await database.admin.query(
      `DROP DATABASE ${databaseIdentifier(database.name)}`,
    );
    database.created = false;
  }
}

function fixtureTransaction(hash, to, index) {
  return {
    hash,
    blockHash: newBlockHash,
    blockNumber: "0x2711",
    transactionIndex: "0x" + index.toString(16),
    from: wallet,
    to,
    nonce: "0x" + index.toString(16),
    value: "0x0",
    gas: "0x30d40",
    gasPrice: "0x4a817c800",
    input: to ? "0xa9059cbb" + "0".repeat(64) : "0x60006000",
    type: "0x2",
  };
}
function fixtureBlock() {
  return {
    number: "0x2711",
    hash: newBlockHash,
    parentHash: blockHash,
    miner: wallet,
    timestamp: "0x" + Math.floor(Date.now() / 1000).toString(16),
    gasLimit: "0x1c9c380",
    gasUsed: "0x668a0",
    transactions: [
      fixtureTransaction(creationHash, null, 0),
      fixtureTransaction(interactionHash, contractAddress, 1),
    ],
  };
}
function fixtureReceipt(hash) {
  return {
    transactionHash: hash,
    transactionIndex: hash === creationHash ? "0x0" : "0x1",
    blockHash: newBlockHash,
    blockNumber: "0x2711",
    from: wallet,
    to: hash === creationHash ? null : contractAddress,
    cumulativeGasUsed: "0x33450",
    gasUsed: "0x33450",
    effectiveGasPrice: "0x4a817c800",
    contractAddress: hash === creationHash ? contractAddress : null,
    logs: [],
    logsBloom: "0x" + "0".repeat(512),
    status: "0x1",
  };
}
function fixtureTrace(hash) {
  return {
    type: hash === creationHash ? "CREATE" : "CALL",
    from: wallet,
    to: contractAddress,
    value: "0x0",
    gas: "0x30d40",
    gasUsed: "0x33450",
    input: "0xa9059cbb",
    output: "0x",
    calls: [
      {
        type: "CALL",
        from: contractAddress,
        to: recipient,
        value: "0xde0b6b3a7640001",
        gas: "0x5208",
        gasUsed: "0x100",
        input: "0x",
        output: "0x",
      },
      {
        type: "DELEGATECALL",
        from: contractAddress,
        to: recipient,
        value: "0xde0b6b3a7640001",
        gas: "0x5208",
        gasUsed: "0x100",
        input: "0x",
        output: "0x",
      },
      {
        type: "CALL",
        from: contractAddress,
        to: recipient,
        value: "0x1",
        gas: "0x5208",
        gasUsed: "0x100",
        input: "0x",
        error: "execution reverted",
        calls: [
          {
            type: "CALL",
            from: recipient,
            to: wallet,
            value: "0x2",
            gas: "0x100",
            gasUsed: "0x1",
            input: "0x",
          },
        ],
      },
    ],
  };
}
function startControlledIndexer() {
  const moduleUrl = pathToFileURL(
    resolve(root, "apps/indexer-service/dist/app.module.js"),
  ).href;
  const processorUrl = pathToFileURL(
    resolve(
      root,
      "apps/indexer-service/dist/modules/chain-sync/block-processor.service.js",
    ),
  ).href;
  const nestUrl = pathToFileURL(indexerRequire.resolve("@nestjs/core")).href;
  const instrumentationUrl = pathToFileURL(
    resolve(root, "apps/indexer-service/dist/instrumentation.js"),
  ).href;
  const observabilityUrl = pathToFileURL(
    resolve(root, "packages/observability/dist/index.js"),
  ).href;
  const wrapper = `const { telemetry } = await import(${JSON.stringify(instrumentationUrl)});
    const { requestTelemetry, withTraceContext } = await import(${JSON.stringify(observabilityUrl)});
    await import(${JSON.stringify(pathToFileURL(indexerRequire.resolve("reflect-metadata")).href)});
    const { NestFactory } = await import(${JSON.stringify(nestUrl)});
    const { AppModule } = await import(${JSON.stringify(moduleUrl)});
    const { BlockProcessorService } = await import(${JSON.stringify(processorUrl)});
    const app = await NestFactory.create({module:AppModule,providers:[{provide:'TelemetryShutdown',useValue:{onApplicationShutdown:()=>telemetry.shutdown()}}]},{logger:telemetry.logger});
    app.enableShutdownHooks(); app.use(requestTelemetry('blockchain-explorer-indexer',telemetry.logger)); await app.listen(3701, '127.0.0.1');
    process.on('message', async message => {
      if (message?.type === 'phase11-verification-stop') process.emit('SIGTERM', 'SIGTERM');
      if (message?.type === 'phase11-process-block') {
        try { await withTraceContext(message.traceContext,()=>app.get(BlockProcessorService).process(11155111, 'ethereum-sepolia', message.block, 10001n)); process.send({ type: 'phase11-block-done', success: true }); }
        catch { process.send({ type: 'phase11-block-done', success: false }); }
      }
    });`;
  return launch(
    "indexer-service",
    ["--input-type=module", "--eval", wrapper],
    resolve(root, "apps/indexer-service"),
    env,
  );
}
async function processFixtureBlock(service) {
  await new Promise((accept, reject) => {
    const timer = setTimeout(() => {
      service.child.off("message", receive);
      reject(new Error("Fixture block processing timeout"));
    }, 20000);
    const receive = (message) => {
      if (message?.type === "phase11-block-done") {
        clearTimeout(timer);
        service.child.off("message", receive);
        message.success
          ? accept()
          : reject(new Error("Fixture block processing failed"));
      }
    };
    service.child.on("message", receive);
    service.child.send({
      type: "phase11-process-block",
      block: fixtureBlock(),
      traceContext: { traceparent, "x-request-id": requestId },
    });
  });
}
async function openSocket(origin = webUrl) {
  const client = new WebSocket("ws://127.0.0.1:3700/realtime", { origin });
  await new Promise((accept, reject) => {
    client.once("open", accept);
    client.once("error", reject);
  });
  client.on("error", () => undefined);
  return client;
}
async function publishEvent(event) {
  const channel = await broker.createConfirmChannel();
  try {
    channel.publish(
      exchangeName,
      event.type,
      Buffer.from(JSON.stringify(event)),
      {
        contentType: "application/json",
        headers: { traceparent, "x-request-id": requestId },
      },
    );
    await channel.waitForConfirms();
  } finally {
    await channel.close();
  }
}

function monitoringUrl(key, fallback) {
  const port = Number(sourceEnv[key] ?? fallback);
  assert(
    Number.isInteger(port) && port > 0 && port <= 65535,
    "Invalid monitoring port " + key,
  );
  return "http://127.0.0.1:" + port;
}
const monitoring = {
  collector: monitoringUrl("OTEL_HEALTH_PORT", 13133),
  prometheus: monitoringUrl("PROMETHEUS_PORT", 9090),
  loki: monitoringUrl("LOKI_PORT", 3100),
  tempo: monitoringUrl("TEMPO_PORT", 3200),
  grafana: monitoringUrl("GRAFANA_PORT", 3004),
};

async function monitoringJson(base, path, query) {
  const url = new URL(base + path);
  for (const [key, value] of Object.entries(query ?? {}))
    url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  assert(response.ok, "Monitoring query failed with status " + response.status);
  return response.json();
}
async function composeCommand(args) {
  await new Promise((accept, reject) => {
    const child = spawn("docker", args, {
      cwd: root,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const capture = (chunk) => {
      output = (output + redact(chunk.toString())).slice(-6000);
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.once("error", () =>
      reject(new Error("Docker executable unavailable")),
    );
    child.once("close", (code) =>
      code === 0
        ? accept()
        : reject(new Error("Docker validation failed: " + output)),
    );
  });
}
const metricSelector = (name) =>
  name + '{deployment_environment_name="' + telemetryEnvironment + '"}';
async function metricRows(name) {
  const result = await monitoringJson(monitoring.prometheus, "/api/v1/query", {
    query: metricSelector(name),
  });
  assert.equal(result.status, "success");
  return result.data.result;
}
async function requireMetric(name, predicate = (rows) => rows.length > 0) {
  return eventually(
    name + " ingestion",
    async () => {
      const rows = await metricRows(name);
      return predicate(rows) ? rows : false;
    },
    60000,
  );
}
async function requestLogs(service = "blockchain-explorer-api") {
  const result = await monitoringJson(
    monitoring.loki,
    "/loki/api/v1/query_range",
    {
      query:
        '{service_name="' +
        service +
        '"} | json | requestId="' +
        requestId +
        '"',
      start: String(BigInt(startedAt - 1000) * 1000000n),
      end: String(BigInt(Date.now() + 1000) * 1000000n),
      limit: 1000,
      direction: "backward",
    },
  );
  assert.equal(result.status, "success");
  return result.data.result.flatMap((stream) =>
    stream.values.map(([, line]) => JSON.parse(line)),
  );
}
function traceSpans(result) {
  const trace = result.trace ?? result;
  return (trace.batches ?? trace.resourceSpans ?? []).flatMap((batch) => {
    const resource = Object.fromEntries(
      (batch.resource?.attributes ?? []).map((item) => [
        item.key,
        item.value?.stringValue ?? item.value?.intValue,
      ]),
    );
    return (
      batch.scopeSpans ??
      batch.instrumentationLibrarySpans ??
      []
    ).flatMap((scope) =>
      (scope.spans ?? []).map((span) => ({
        ...span,
        service: resource["service.name"],
      })),
    );
  });
}
async function recordedTrace() {
  const response = await fetch(monitoring.tempo + "/api/traces/" + traceId, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) return [];
  assert(response.ok, "Tempo trace lookup failed");
  return traceSpans(await response.json());
}
async function requireSpans(names) {
  return eventually(
    "distributed trace spans",
    async () => {
      const spans = await recordedTrace();
      return names.every((name) => spans.some((span) => span.name === name))
        ? spans
        : false;
    },
    60000,
  );
}

async function verifyMonitoringReady() {
  await check("observability Docker Compose configuration valid", () =>
    composeCommand([
      "compose",
      "--env-file",
      ".env",
      "-f",
      "infrastructure/compose.observability.yml",
      "config",
      "--quiet",
    ]),
  );
  for (const [name, path] of [
    ["collector", "/"],
    ["prometheus", "/-/ready"],
    ["loki", "/ready"],
    ["tempo", "/ready"],
    ["grafana", "/api/health"],
  ]) {
    await check(name + " ready", () =>
      eventually(
        name + " readiness",
        async () => {
          try {
            return (
              await fetch(monitoring[name] + path, {
                signal: AbortSignal.timeout(5000),
              })
            ).ok;
          } catch {
            return false;
          }
        },
        60000,
      ),
    );
  }
  await check("Prometheus six configured targets UP", async () => {
    const targets = await eventually(
      "scrape targets",
      async () => {
        const data = await monitoringJson(
          monitoring.prometheus,
          "/api/v1/targets",
        );
        return data.data.activeTargets.length === 6 &&
          data.data.activeTargets.every((target) => target.health === "up")
          ? data.data.activeTargets
          : false;
      },
      60000,
    );
    assert.deepEqual(targets.map((target) => target.labels.job).sort(), [
      "applications",
      "loki",
      "otel-collector",
      "prometheus",
      "rabbitmq-broker",
      "tempo",
    ]);
  });
  await check(
    "Grafana three provisioned datasources healthy and correlated",
    async () => {
      const sources = await monitoringJson(
        monitoring.grafana,
        "/api/datasources",
      );
      for (const [uid, type] of [
        ["prometheus", "prometheus"],
        ["tempo", "tempo"],
        ["loki", "loki"],
      ]) {
        const source = sources.find((item) => item.uid === uid);
        assert.equal(source?.type, type);
        const health = await monitoringJson(
          monitoring.grafana,
          "/api/datasources/uid/" + uid + "/health",
        );
        assert.equal(health.status, "OK");
      }
      assert.equal(
        sources.find((item) => item.uid === "loki").jsonData.derivedFields[0]
          .datasourceUid,
        "tempo",
      );
      assert.equal(
        sources.find((item) => item.uid === "tempo").jsonData.tracesToLogsV2
          .datasourceUid,
        "loki",
      );
    },
  );
  await check(
    "Grafana four dashboards and real Prometheus alert rules loaded",
    async () => {
      const dashboards = await monitoringJson(
        monitoring.grafana,
        "/api/search",
        { type: "dash-db" },
      );
      assert.equal(dashboards.length, 4);
      for (const item of dashboards) {
        const value = await monitoringJson(
          monitoring.grafana,
          "/api/dashboards/uid/" + item.uid,
        );
        assert(value.dashboard.panels.length > 0);
      }
      const rules = await monitoringJson(
        monitoring.prometheus,
        "/api/v1/rules",
      );
      const alerts = rules.data.groups.flatMap((group) => group.rules);
      for (const name of [
        "IndexerLagHigh",
        "IndexerStopped",
        "EthereumRpcErrorRateHigh",
        "EthereumRpcRateLimited",
        "ServiceHttp5xxHigh",
        "OutboxBacklogHigh",
        "BullMqJobFailuresHigh",
        "PortfolioPriceRefreshFailures",
      ])
        assert(
          alerts.some((rule) => rule.name === name && rule.health === "ok"),
        );
    },
  );
}

async function verifyActualTelemetry(indexer) {
  await check(
    "HTTP request ID echo and safe invalid ID replacement",
    async () => {
      const response = await fetch(apiUrl + "/stats", {
        headers: { "x-request-id": requestId, traceparent },
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-request-id"), requestId);
      const invalid = await fetch(apiUrl + "/stats", {
        headers: { "x-request-id": "invalid id with spaces", traceparent },
      });
      assert.equal(invalid.status, 200);
      assert(/^[A-Za-z0-9_-]{1,64}$/.test(invalid.headers.get("x-request-id")));
      assert.notEqual(
        invalid.headers.get("x-request-id"),
        "invalid id with spaces",
      );
    },
  );
  await check(
    "real Portfolio ownership, BullMQ sync, CoinGecko valuation and snapshot",
    async () => {
      const user = await register("observability");
      // Warm the real background price job before native sync takes its initial snapshot.
      await eventually("native asset price", async () => {
        const price = await api("GET", "/prices/eth", 200);
        return price.availability === "available" ? price : false;
      });
      const portfolio = await api(
        "POST",
        "/portfolio",
        201,
        {
          name: "Observability fixture",
          walletAddress: wallet,
          chainId: 11155111,
        },
        user,
      );
      await eventually("native sync and valuation", async () => {
        const value = await api(
          "GET",
          "/portfolio/" + portfolio.id + "/valuation",
          200,
          undefined,
          user,
        );
        return value.summary.complete ? value : false;
      });
      await requireMetric("portfolio_valuations_total", (rows) =>
        rows.some((row) => Number(row.value[1]) > 0),
      );
      await requireMetric("portfolio_snapshots_total", (rows) =>
        rows.some((row) => Number(row.value[1]) > 0),
      );
    },
  );
  await check(
    "Prometheus custom HTTP metrics use parameterized routes",
    async () => {
      const rows = await requireMetric("http_server_requests_total", (rows) =>
        rows.some(
          (row) => row.metric.route === "/stats" && Number(row.value[1]) > 0,
        ),
      );
      assert(
        rows.every(
          (row) =>
            !row.metric.route.includes(wallet) &&
            !row.metric.route.includes(transactionHash),
        ),
      );
      await requireMetric("http_server_duration_seconds_bucket");
    },
  );
  await check(
    "Indexer, RPC, verification and trace metrics arrive through OTLP",
    async () => {
      for (const name of [
        "indexer_blocks_processed_total",
        "indexer_transactions_processed_total",
        "indexer_latest_indexed_block",
        "indexer_rpc_latest_block",
        "indexer_lag_blocks",
        "indexer_outbox_backlog",
        "indexer_contract_verification_total",
        "indexer_traces_total",
        "ethereum_rpc_requests_total",
        "ethereum_rpc_duration_seconds_bucket",
      ])
        await requireMetric(name);
      assert(
        (await metricRows("indexer_blocks_processed_total")).some(
          (row) => Number(row.value[1]) >= 1,
        ),
      );
    },
  );
  await check(
    "Portfolio, cache, RabbitMQ, BullMQ, pool and WebSocket metrics exist",
    async () => {
      for (const name of [
        "portfolio_price_refresh_total",
        "portfolio_unpriced_assets",
        "coingecko_requests_total",
        "cache_hits_total",
        "cache_misses_total",
        "rabbitmq_published_total",
        "rabbitmq_consumed_total",
        "bullmq_jobs_completed_total",
        "bullmq_jobs_active",
        "bullmq_jobs_waiting",
        "db_pool_total",
        "db_pool_idle",
        "db_pool_waiting",
        "websocket_connections_active",
        "websocket_connections_total",
        "websocket_events_broadcast_total",
      ])
        await requireMetric(name);
    },
  );
  await check(
    "Loki contains correlated structured request logs without secrets",
    async () => {
      const logs = await eventually(
        "OTLP logs ingestion",
        async () => {
          const records = await requestLogs();
          return records.some(
            (record) =>
              record.message === "HTTP request completed" &&
              record.traceId === traceId,
          )
            ? records
            : false;
        },
        60000,
      );
      for (const record of logs) {
        assert.equal(record.service, "blockchain-explorer-api");
        assert.equal(record.requestId, requestId);
        assert.equal(typeof record.timestamp, "string");
        assert.equal(typeof record.level, "string");
        for (const secret of secrets)
          assert(
            !JSON.stringify(record).includes(secret),
            "Configured secret appeared in logs",
          );
      }
    },
  );
  await check(
    "Tempo correlates request IDs across HTTP, outbox, RabbitMQ and BullMQ",
    async () => {
      const spans = await requireSpans([
        "indexer.process_block",
        "indexer.fetch_receipts",
        "indexer.parse_erc20",
        "indexer.persist_block",
        "indexer.verify_contract",
        "indexer.trace_transaction",
        "ethereum.rpc",
        "rabbitmq.publish",
        "rabbitmq.consume",
        "bullmq.job",
        "portfolio.valuation",
        "portfolio.snapshot",
        "coingecko.request",
      ]);
      for (const service of [
        "blockchain-explorer-api",
        "blockchain-explorer-indexer",
        "blockchain-explorer-portfolio",
      ])
        assert(spans.some((span) => span.service === service));
      const hasRequestId = (span) =>
        (span.attributes ?? []).some(
          (attribute) =>
            attribute.key === "request.id" &&
            attribute.value?.stringValue === requestId,
        );
      for (const service of [
        "blockchain-explorer-api",
        "blockchain-explorer-indexer",
        "blockchain-explorer-portfolio",
      ])
        assert(
          spans.some(
            (span) =>
              span.service === service &&
              /^(?:GET|POST) \//.test(span.name) &&
              hasRequestId(span),
          ),
          "HTTP request ID missing from " + service + " trace",
        );
      assert(
        spans.some(
          (span) => span.name === "indexer.process_block" && hasRequestId(span),
        ),
        "Request ID missing from custom block span",
      );
      assert(
        spans.some((span) => span.name === "bullmq.job" && hasRequestId(span)),
        "Request ID missing from background job span",
      );
      for (const span of spans)
        for (const secret of secrets)
          assert(
            !JSON.stringify(span).includes(secret),
            "Configured secret appeared in trace",
          );
      for (const service of [
        "blockchain-explorer-api",
        "blockchain-explorer-indexer",
        "blockchain-explorer-portfolio",
      ]) {
        const logs = await eventually(
          "request-ID propagation to " + service,
          async () => {
            const records = await requestLogs(service);
            return records.some((record) => record.traceId === traceId)
              ? records
              : false;
          },
          60000,
        );
        assert(logs.length > 0);
      }
    },
  );
  await check(
    "Tempo generates dependency edges and same-request metric exemplars",
    async () => {
      await eventually(
        "service dependency graph",
        async () => {
          const result = await monitoringJson(
            monitoring.prometheus,
            "/api/v1/query",
            {
              query:
                'traces_service_graph_request_total{client="blockchain-explorer-api"}',
            },
          );
          return [
            "blockchain-explorer-indexer",
            "blockchain-explorer-portfolio",
          ].every((service) =>
            result.data.result.some(
              (row) =>
                row.metric.server === service && Number(row.value[1]) > 0,
            ),
          );
        },
        60000,
      );
      await eventually(
        "metric-to-current-trace exemplar",
        async () => {
          const result = await monitoringJson(
            monitoring.prometheus,
            "/api/v1/query_exemplars",
            {
              query: "traces_spanmetrics_latency_bucket",
              start: startedAt / 1000,
              end: Date.now() / 1000,
            },
          );
          return result.data.some((series) =>
            series.exemplars.some(
              (exemplar) => exemplar.labels.traceID === traceId,
            ),
          );
        },
        60000,
      );
    },
  );
  await check(
    "Malformed RabbitMQ delivery records error span without breaking services",
    async () => {
      const channel = await broker.createConfirmChannel();
      try {
        channel.publish(
          exchangeName,
          "block.indexed.v1",
          Buffer.from("invalid-json"),
          { headers: { traceparent, "x-request-id": requestId } },
        );
        await channel.waitForConfirms();
      } finally {
        await channel.close();
      }
      await requireMetric("rabbitmq_consumer_errors_total", (rows) =>
        rows.some((row) => Number(row.value[1]) > 0),
      );
      await eventually(
        "error trace status",
        async () => {
          const spans = await recordedTrace();
          return spans.some(
            (span) =>
              span.name === "rabbitmq.consume" &&
              (span.status?.code === 2 ||
                span.status?.code === "STATUS_CODE_ERROR") &&
              span.events?.some((event) => event.name === "exception"),
          );
        },
        60000,
      );
      await api("GET", "/stats", 200);
    },
  );
  await check(
    "Metrics exclude IDs, addresses, hashes, credentials and raw paths",
    async () => {
      const result = await monitoringJson(
        monitoring.prometheus,
        "/api/v1/query",
        {
          query: '{deployment_environment_name="' + telemetryEnvironment + '"}',
        },
      );
      assert.equal(result.status, "success");
      assert(result.data.result.length > 20);
      for (const row of result.data.result)
        for (const [key, value] of Object.entries(row.metric)) {
          assert(
            !/^(?:user_?id|portfolio_?id|request_?id|transaction_?hash|wallet_?address|cache_?key|password|token|authorization)$/i.test(
              key,
            ),
            "Unsafe metric label " + key,
          );
          assert(
            !/^0x[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value),
            "Address/hash metric label",
          );
          for (const secret of secrets)
            assert(
              !String(value).includes(secret),
              "Configured secret appeared in metric labels",
            );
        }
    },
  );
  await check(
    "Telemetry-disabled fixture still serves core HTTP and shuts down",
    async () => {
      await freePort(3704);
      const entry = pathToFileURL(
        resolve(root, "apps/api-gateway/dist/main.js"),
      ).href;
      const wrapper =
        'process.on("message",message=>{if(message?.type==="phase11-verification-stop")process.emit("SIGTERM","SIGTERM");});await import(' +
        JSON.stringify(entry) +
        ");";
      launch(
        "api-disabled",
        ["--input-type=module", "--eval", wrapper],
        resolve(root, "apps/api-gateway"),
        {
          ...env,
          API_GATEWAY_PORT: "3704",
          OTEL_ENABLED: "false",
          REALTIME_ENABLED: "false",
        },
      );
      await eventually("disabled telemetry HTTP", async () => {
        try {
          return (
            await fetch("http://127.0.0.1:3704/health", {
              signal: AbortSignal.timeout(2500),
            })
          ).ok;
        } catch {
          return false;
        }
      });
      const response = await fetch("http://127.0.0.1:3704/stats");
      assert.equal(response.status, 200);
    },
  );
  await check(
    "Offline OTLP exporter does not fail core HTTP operations",
    async () => {
      await freePort(3705);
      await freePort(3799);
      const entry = pathToFileURL(
        resolve(root, "apps/api-gateway/dist/main.js"),
      ).href;
      const wrapper =
        'process.on("message",message=>{if(message?.type==="phase11-verification-stop")process.emit("SIGTERM","SIGTERM");});await import(' +
        JSON.stringify(entry) +
        ");";
      launch(
        "api-offline",
        ["--input-type=module", "--eval", wrapper],
        resolve(root, "apps/api-gateway"),
        {
          ...env,
          API_GATEWAY_PORT: "3705",
          OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:3799",
          REALTIME_ENABLED: "false",
        },
      );
      await eventually("offline exporter HTTP", async () => {
        try {
          return (
            await fetch("http://127.0.0.1:3705/health", {
              signal: AbortSignal.timeout(2500),
            })
          ).ok;
        } catch {
          return false;
        }
      });
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await fetch("http://127.0.0.1:3705/stats");
        assert.equal(response.status, 200);
        await delay(1100);
      }
    },
  );
}

try {
  console.log(
    "Phase 11 isolated production observability: real OTLP/Prometheus/Loki/Tempo plus PostgreSQL/Redis/RabbitMQ/BullMQ/WebSocket; local provider fixtures.",
  );
  for (const key of [
    "IDENTITY_DATABASE_URL",
    "EXPLORER_DATABASE_URL",
    "PORTFOLIO_DATABASE_URL",
    "REDIS_URL",
    "RABBITMQ_URL",
  ])
    assert(sourceEnv[key], "Missing infrastructure setting " + key);
  await verifyMonitoringReady();
  await Promise.all([
    ...[3700, 3701, 3702].map(freePort),
    ...["api-gateway", "indexer-service", "portfolio-service"].map((name) =>
      access(resolve(root, "apps", name, "dist/main.js")),
    ),
  ]);
  await check(
    "isolated databases and existing plus advanced migrations applied",
    async () => {
      await createTestDatabase(
        "api-gateway",
        "identity",
        "IDENTITY_DATABASE_URL",
      );
      await createTestDatabase(
        "indexer-service",
        "explorer",
        "EXPLORER_DATABASE_URL",
      );
      await createTestDatabase(
        "portfolio-service",
        "portfolio",
        "PORTFOLIO_DATABASE_URL",
      );
      await seedExplorer();
    },
  );
  await check(
    "real isolated infrastructure and deterministic providers healthy",
    async () => {
      redis = createClient({
        url: env.REDIS_URL,
        socket: { connectTimeout: 5000, reconnectStrategy: false },
      });
      redis.on("error", () => undefined);
      await redis.connect();
      assert.equal(await redis.ping(), "PONG");
      broker = await amqp.connect(env.RABBITMQ_URL, { timeout: 5000 });
      broker.on("error", () => undefined);
      await startFixtures();
    },
  );
  const indexer = startControlledIndexer();
  startService("portfolio-service");
  startService("api-gateway");
  await check("built API, Indexer and Portfolio health", async () => {
    await Promise.all([
      ready("api-gateway", apiUrl),
      ready("indexer-service", env.INDEXER_INTERNAL_URL),
      ready("portfolio-service", env.PORTFOLIO_INTERNAL_URL),
    ]);
  });
  await check(
    "existing Explorer REST and cached network snapshot",
    async () => {
      assert.equal((await api("GET", "/stats", 200)).blocks, 1);
      const value = await eventually("network observation", async () => {
        const state = await api("GET", "/network/status", 200);
        return state.rpcLatestBlock ? state : false;
      });
      assert.equal(value.rpcLatestBlock, "10001");
      assert.equal(value.indexedBlock, "10000");
      assert.equal(value.lag, "1");
      assert.equal(value.chainId, 11155111);
    },
  );
  await check(
    "indexed search resolves block number and block hash",
    async () => {
      assert.equal(
        (await api("GET", "/search?q=10000", 200)).destination,
        "/blocks/10000",
      );
      assert.equal(
        (await api("GET", "/search?q=" + blockHash, 200)).destination,
        "/blocks/10000",
      );
      assert.equal(
        (await api("GET", "/blocks/hash/" + blockHash, 200)).number,
        "10000",
      );
    },
  );
  await check(
    "indexed transaction/address/token search and invalid input",
    async () => {
      for (const [query, type] of [
        [transactionHash, "transaction"],
        [wallet, "address"],
        [tokenAddress, "token"],
      ])
        assert.equal((await api("GET", "/search?q=" + query, 200)).type, type);
      await api("GET", "/search?q=not-an-address", 400);
      await api("GET", "/search?q=" + ("0x" + "0".repeat(40)), 404);
    },
  );
  await check("native WebSocket handshake and Origin boundary", async () => {
    socket = await openSocket();
    socket.on("message", (raw) => {
      try {
        socketEvents.push(JSON.parse(raw.toString()));
      } catch {}
    });
    await assert.rejects(openSocket("https://untrusted.example"));
  });
  await check(
    "real block processor commits creation, outbox and enrichment intents",
    async () => {
      await processFixtureBlock(indexer);
      const row = (
        await explorerDb.query(
          "SELECT is_contract FROM addresses WHERE address=$1",
          [contractAddress],
        )
      ).rows[0];
      assert.equal(row.is_contract, true);
      assert.equal(
        (await api("GET", "/blocks/10001", 200)).transactions.length,
        2,
      );
      const states = await explorerDb.query(
        "SELECT transaction_hash FROM transaction_trace_requests WHERE block_number=10001",
      );
      assert.equal(states.rows.length, 2);
    },
  );
  await check(
    "transactional outbox reaches RabbitMQ and native WebSocket",
    async () => {
      const event = await eventually("real block broadcast", async () =>
        socketEvents.find(
          (event) =>
            event.type === "block.indexed" &&
            event.payload.blockHash === newBlockHash,
        ),
      );
      assert.equal(event.payload.blockNumber, "10001");
      assert(!JSON.stringify(event).includes("secret"));
      await eventually(
        "stats cache invalidation",
        async () => (await api("GET", "/stats", 200)).blocks === 2,
      );
    },
  );
  await check(
    "verify-contract BullMQ result stores validated ABI/source metadata",
    async () => {
      const result = await eventually("verified contract", async () => {
        const data = await api("GET", "/contract/" + contractAddress, 200);
        return data.verification.status === "verified" ? data : false;
      });
      assert.equal(result.verification.contractName, "Fixture");
      assert.equal(result.verification.optimizationRuns, 200);
      assert(Array.isArray(result.verification.abi));
      assert(result.verification.sourceCode.includes("contract Fixture"));
      const row = (
        await explorerDb.query(
          "SELECT attempts,verified_at FROM contract_verifications WHERE contract_address=$1",
          [contractAddress],
        )
      ).rows[0];
      assert.equal(row.attempts, 1);
      assert(row.verified_at);
    },
  );
  await check(
    "eth_getCode detection and unverified cooldown remain valid states",
    async () => {
      await explorerDb.query(
        "INSERT INTO addresses(address,is_contract,first_seen_block,last_seen_block,code_check_after) VALUES ($1,false,10001,10001,now()),($2,false,10001,10001,now())",
        [discoveredAddress, unverifiedAddress],
      );
      const result = await eventually("unverified lookup", async () => {
        const response = await fetch(apiUrl + "/contract/" + unverifiedAddress);
        if (response.status !== 200) return false;
        const data = await response.json();
        return data.verification.status === "unverified" ? data : false;
      });
      assert.equal(result.verification.verified, false);
      assert.equal(result.verification.sourceCode, null);
      await eventually("code detected contract", async () => {
        const response = await fetch(apiUrl + "/contract/" + discoveredAddress);
        return response.ok;
      });
      const countsBefore = fixtureCounts.verification.get(unverifiedAddress);
      await delay(1200);
      assert.equal(
        fixtureCounts.verification.get(unverifiedAddress),
        countsBefore,
      );
      assert.equal(fixtureCounts.code.get(discoveredAddress), 1);
      assert.equal(
        (await api("GET", "/search?q=" + contractAddress, 200)).type,
        "contract",
      );
    },
  );
  await check(
    "trace-transaction BullMQ normalizes tree and exact internal value semantics",
    async () => {
      const result = await eventually("completed trace", async () => {
        const data = await api(
          "GET",
          "/tx/" + interactionHash + "/traces",
          200,
        );
        return data.available ? data : false;
      });
      assert.equal(result.status, "completed");
      assert.deepEqual(
        result.traces.map((row) => row.traceAddress),
        ["root", "0", "1", "2", "2.0"],
      );
      assert.equal(result.internalCalls.length, 1);
      assert.equal(result.internalCalls[0].value, "1000000000000000001");
      assert(
        !result.traces.find((row) => row.traceAddress === "2.0").valueBearing,
      );
      const rows = await explorerDb.query(
        "SELECT trace_address FROM transaction_traces WHERE transaction_hash=$1",
        [interactionHash],
      );
      assert.equal(rows.rows.length, 5);
      await api("GET", "/tx/" + interactionHash + "/traces", 200);
      await delay(300);
      assert.equal(
        (
          await explorerDb.query(
            "SELECT count(*)::int AS count FROM transaction_traces WHERE transaction_hash=$1",
            [interactionHash],
          )
        ).rows[0].count,
        5,
      );
    },
  );
  await check(
    "unsupported tracing is bounded and core REST remains healthy",
    async () => {
      await explorerDb.query(
        "INSERT INTO transactions(hash,block_number,block_hash,transaction_index,from_address,to_address,nonce,value,gas,input) VALUES($1,10001,$2,3,$3,$4,3,0,21000,$5)",
        [unsupportedHash, newBlockHash, wallet, contractAddress, "0x12345678"],
      );
      await api("GET", "/tx/" + unsupportedHash + "/traces", 200);
      const result = await eventually("unsupported status", async () => {
        const data = await api(
          "GET",
          "/tx/" + unsupportedHash + "/traces",
          200,
        );
        return data.reason === "not-supported" ? data : false;
      });
      assert.equal(result.available, false);
      assert.equal(result.status, "unsupported");
      const count = fixtureCounts.traces;
      await delay(1200);
      assert.equal(fixtureCounts.traces, count);
      assert.equal(
        (await api("GET", "/tx/" + ("0x" + "f".repeat(64)) + "/traces", 200))
          .reason,
        "not-indexed",
      );
      assert.equal((await api("GET", "/stats", 200)).blocks, 2);
    },
  );
  await check(
    "public transfer mapping, dedup and targeted cache invalidation",
    async () => {
      await api("GET", "/address/" + recipient, 200);
      await explorerDb.query(
        "INSERT INTO token_transfers(transaction_hash,block_number,token_address,from_address,to_address,amount,transaction_index,log_index) VALUES($1,10001,$2,$3,$4,1,1,9)",
        [interactionHash, tokenAddress, wallet, recipient],
      );
      const event = {
        id: randomBytes(16).toString("hex"),
        type: "token.transfer.indexed.v1",
        version: 1,
        occurredAt: new Date().toISOString(),
        producer: "indexer-service",
        payload: {
          chainId: 11155111,
          networkName: "ethereum-sepolia",
          blockNumber: "10001",
          transactionHash: interactionHash,
          transactionIndex: 1,
          logIndex: 9,
          tokenAddress,
          fromAddress: wallet,
          toAddress: recipient,
          amountRaw: "1",
        },
      };
      // Event IDs follow the actual envelope's UUID contract.
      event.id = randomUUID();
      await publishEvent(event);
      await publishEvent(event);
      await eventually("transfer broadcast", async () =>
        socketEvents.find((row) => row.id === event.id),
      );
      await delay(300);
      assert.equal(socketEvents.filter((row) => row.id === event.id).length, 1);
      await eventually(
        "target cache invalidation",
        async () =>
          (await api("GET", "/address/" + recipient, 200))
            .tokenTransferCount === 2,
      );
    },
  );
  await check(
    "reorg event invalidates cache and broadcasts a stable public DTO",
    async () => {
      const event = {
        id: randomUUID(),
        type: "chain.reorganized.v1",
        version: 1,
        occurredAt: new Date().toISOString(),
        producer: "indexer-service",
        payload: {
          chainId: 11155111,
          networkName: "ethereum-sepolia",
          detectedAtBlock: "10001",
          commonAncestorBlock: "10000",
          commonAncestorHash: blockHash,
        },
      };
      await publishEvent(event);
      const mapped = await eventually("reorg broadcast", async () =>
        socketEvents.find((row) => row.id === event.id),
      );
      assert.equal(mapped.type, "chain.reorganized");
      assert.equal(mapped.payload.commonAncestorBlock, "10000");
    },
  );
  await check(
    "advanced internal APIs retain token boundary and validation",
    async () => {
      const denied = await fetch(
        env.INDEXER_INTERNAL_URL +
          "/internal/explorer/contracts/" +
          contractAddress,
      );
      assert.equal(denied.status, 401);
      await api("GET", "/contract/" + wallet, 404);
      await api("GET", "/contract/not-an-address", 400);
      await api("GET", "/tx/invalid/traces", 400);
    },
  );
  await verifyActualTelemetry(indexer);
  console.log(
    "Phase 11 production observability integration: " +
      checks +
      " checks passed.",
  );
} catch (error) {
  process.exitCode = 1;
  console.error(
    `FAIL ${redact(error instanceof Error ? error.message : error)}`,
  );
  for (const service of children)
    console.error(
      `Captured ${service.name} output:\n${service.logs.split("\n").slice(-18).join("\n")}`,
    );
} finally {
  if (socket) socket.terminate();
  let closed = false;
  try {
    await stopChildren();
    closed = children.every((child) => child.exited);
    console.log("PASS own instrumented services shut down");
  } catch (error) {
    process.exitCode = 1;
    closed = children.every((child) => child.exited);
    console.error(`FAIL shutdown: ${redact(error.message)}`);
  }
  if (closed) {
    for (const [label, action] of [
      ["own Redis keys", cleanupRedis],
      ["own RabbitMQ topology", cleanupBroker],
      ["marker-proven temporary databases", cleanupDatabases],
    ]) {
      try {
        await action();
        console.log(`PASS cleanup ${label}`);
      } catch (error) {
        process.exitCode = 1;
        console.error(`FAIL cleanup ${label}: ${redact(error.message)}`);
      }
    }
  } else {
    process.exitCode = 1;
    console.error(
      "FAIL resource cleanup skipped because an owned child is still running",
    );
  }
  if (fixtureServer) {
    fixtureServer.closeAllConnections();
    await new Promise((accept) => fixtureServer.close(accept));
  }
  if (redis?.isOpen) await redis.quit().catch(() => undefined);
  if (broker) await broker.close().catch(() => undefined);
  for (const database of databases)
    await database.admin.end().catch(() => undefined);
}
