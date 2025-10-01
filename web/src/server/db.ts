import Database from "better-sqlite3";
import path from "path";
const db = new Database(path.join(process.cwd(), ".data", "coinrush.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS trades (
  pool TEXT, block INTEGER, tx TEXT, type TEXT,
  bnbIn TEXT, tokensOut TEXT, tokenIn TEXT, bnbOut TEXT,
  PRIMARY KEY (pool, tx, type)
);
CREATE TABLE IF NOT EXISTS balances (
  token TEXT, address TEXT, balance TEXT,
  PRIMARY KEY (token, address)
);
CREATE TABLE IF NOT EXISTS meta (
  pool TEXT PRIMARY KEY, token TEXT, creationBlock INTEGER, lastScanned INTEGER
);
`);
export default db;
