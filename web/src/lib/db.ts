// src/lib/db.ts

// ─────────────────────────────────────────────────────────────
// Prisma client singleton (preferred for new code)
// ─────────────────────────────────────────────────────────────
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// ─────────────────────────────────────────────────────────────
// Legacy better-sqlite3 helpers (kept for backward compatibility)
// ─────────────────────────────────────────────────────────────
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

let _db: Database.Database | null = null;

/** Extra data dir (e.g., for cached images, exports, etc.) */
const APP_DATA_DIR = process.env.APP_DATA_DIR || ".appdata";

/** Resolve DB path with backward-compatible defaults */
function resolveDbPath() {
  const root = process.cwd();
  const legacyDataDir =
    process.env.SQLITE_DIR || // old override: directory only
    path.join(root, "var");
  const legacyFile = path.join(legacyDataDir, "app.db");

  // Preferred explicit file path (new & old snippet agree on SQLITE_PATH)
  const explicit = (process.env.SQLITE_PATH || "").trim();
  if (explicit) return explicit;

  // Fall back to legacy location to avoid breaking existing setups
  return legacyFile;
}

/** Ensure required directories exist (DB dir + app data dir) */
export function ensureDirs() {
  const dbPath = resolveDbPath();
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  if (!fs.existsSync(APP_DATA_DIR)) fs.mkdirSync(APP_DATA_DIR, { recursive: true });
}

/** Create/upgrade tables and indexes idempotently */
function ensureTables(db: Database.Database) {
  // --- Profiles table (back-compat + new timestamps) ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      address     TEXT PRIMARY KEY,
      username    TEXT NOT NULL,
      avatar_url  TEXT,
      telegram    TEXT,
      twitter     TEXT,
      updated_at  INTEGER
    );
  `);

  // Add created_at to profiles if missing (quietly ignore if already there)
  try {
    db.exec(`ALTER TABLE profiles ADD COLUMN created_at INTEGER;`);
  } catch {}

  // --- Tokens table (legacy shape; keep defaults to avoid breaking) ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS tokens (
      token_addr   TEXT PRIMARY KEY,
      pool_addr    TEXT NOT NULL,
      name         TEXT NOT NULL,
      symbol       TEXT NOT NULL,
      image_url    TEXT,
      created_by   TEXT,
      created_at   INTEGER DEFAULT (strftime('%s','now'))
    );
  `);

  // Schema-upgrade patches (no-op if columns already exist)
  try {
    db.exec(`ALTER TABLE tokens ADD COLUMN image_url TEXT;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE tokens ADD COLUMN chain_id INTEGER DEFAULT 97;`);
  } catch {}

  // Indexes (keep your original; add created_at index for faster sorting)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tokens_creator     ON tokens(created_by);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tokens_created_at  ON tokens(created_at);`);
}

/** Main singleton (backward compatible) */
export function getDB() {
  if (_db) return _db;

  const dbPath = resolveDbPath();
  ensureDirs();

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  ensureTables(db);

  _db = db;
  return db;
}

/**
 * Async-friendly wrapper (compatible with the snippet you shared).
 * Returns the same singleton instance as getDB(), just as a Promise.
 */
export async function openDb(): Promise<Database.Database> {
  return getDB();
}
