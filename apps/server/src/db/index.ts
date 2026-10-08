import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema";

const DB_PATH = process.env.DB_PATH ?? "./data/app.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

export const sqlite = new Database(DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL;");

export const db = drizzle(sqlite, { schema });
