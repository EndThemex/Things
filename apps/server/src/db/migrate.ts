import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DB_PATH ?? "./data/app.db";

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");

const MIGRATIONS: string[] = [
  // 001: init schema
  `
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS components (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    quantity     INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    spec         TEXT,
    price        TEXT,
    color        TEXT,
    purchase_url TEXT,
    image_path   TEXT,
    note         TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_components_category ON components(category_id);
  CREATE INDEX IF NOT EXISTS idx_components_name ON components(name);

  CREATE TABLE IF NOT EXISTS component_tags (
    component_id INTEGER NOT NULL REFERENCES components(id) ON DELETE CASCADE,
    tag_id       INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (component_id, tag_id)
  );
  CREATE INDEX IF NOT EXISTS idx_component_tags_tag ON component_tags(tag_id);

  CREATE TABLE IF NOT EXISTS plans (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS plan_items (
    id           INTEGER PRIMARY KEY,
    plan_id      INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    component_id INTEGER NOT NULL REFERENCES components(id) ON DELETE CASCADE,
    quantity_per INTEGER NOT NULL CHECK (quantity_per > 0),
    UNIQUE (plan_id, component_id)
  );
  CREATE INDEX IF NOT EXISTS idx_plan_items_plan ON plan_items(plan_id);

  CREATE TABLE IF NOT EXISTS stock_movements (
    id           INTEGER PRIMARY KEY,
    component_id INTEGER NOT NULL REFERENCES components(id) ON DELETE CASCADE,
    delta        INTEGER NOT NULL,
    reason       TEXT,
    plan_id      INTEGER REFERENCES plans(id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_stock_movements_component ON stock_movements(component_id);
  `,
];

export function migrate(database = db) {
  database.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`,
  );
  const applied = new Set(
    database.query(`SELECT version FROM schema_migrations`).all().map((r: any) => r.version),
  );
  MIGRATIONS.forEach((sql, i) => {
    const version = i + 1;
    if (applied.has(version)) return;
    database.transaction(() => {
      database.exec(sql);
      database
        .query(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`)
        .run(version, new Date().toISOString());
    })();
    console.log(`[db] migration ${version} applied`);
  });
}

if (import.meta.main) {
  migrate();
  console.log(`[db] migrate done: ${DB_PATH}`);
}
