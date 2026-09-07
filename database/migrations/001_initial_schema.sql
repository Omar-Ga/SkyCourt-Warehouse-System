-- database/migrations/001_initial_schema.sql
-- Baseline schema representing the original single-operator inventory system.

PRAGMA foreign_keys = ON;

-- Units Table
CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
);

-- Categories Table
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER,
    FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories (parent_id);

-- Destinations Table
CREATE TABLE IF NOT EXISTS destinations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
);

-- Providers Table
CREATE TABLE IF NOT EXISTS providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_providers_name ON providers (name);

-- Items Table
CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    unit_id INTEGER NOT NULL,
    sub_category_id INTEGER,
    provider_id INTEGER,
    current_quantity INTEGER NOT NULL DEFAULT 0,
    cost REAL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'archived')),
    barcode TEXT UNIQUE,
    FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE RESTRICT,
    FOREIGN KEY (sub_category_id) REFERENCES categories(id) ON DELETE SET NULL,
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_items_name ON items (name);
CREATE INDEX IF NOT EXISTS idx_items_status ON items (status);
CREATE INDEX IF NOT EXISTS idx_items_sub_category_id ON items (sub_category_id);

-- Movement Logs Table
CREATE TABLE IF NOT EXISTS movement_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    item_id INTEGER NOT NULL,
    item_name TEXT,
    action_type TEXT NOT NULL,
    quantity_changed INTEGER,
    resulting_quantity INTEGER,
    provider_id INTEGER,
    cost_per_item REAL,
    details TEXT,
    person_name TEXT,
    destination_id INTEGER,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT,
    FOREIGN KEY (destination_id) REFERENCES destinations(id) ON DELETE RESTRICT,
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_mov_log_item_id ON movement_logs (item_id);
CREATE INDEX IF NOT EXISTS idx_mov_log_action_type ON movement_logs (action_type);
CREATE INDEX IF NOT EXISTS idx_mov_log_timestamp ON movement_logs (timestamp);
CREATE INDEX IF NOT EXISTS idx_mov_log_provider_id ON movement_logs (provider_id);
CREATE INDEX IF NOT EXISTS idx_mov_log_destination_id ON movement_logs (destination_id);
