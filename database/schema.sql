-- database/schema.sql
-- Complete fresh-install schema for SkyCourt Warehouse System

PRAGMA foreign_keys = ON;

-- Schema Migrations Table
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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

-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('office', 'warehouse', 'admin')),
    display_name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    session_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

-- Items Table
CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    unit_id INTEGER NOT NULL,
    sub_category_id INTEGER,
    provider_id INTEGER,
    current_quantity INTEGER NOT NULL DEFAULT 0,
    reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK(reserved_quantity >= 0 AND reserved_quantity <= current_quantity),
    cost REAL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'archived')),
    FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE RESTRICT,
    FOREIGN KEY (sub_category_id) REFERENCES categories(id) ON DELETE SET NULL,
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_items_name ON items (name);
CREATE INDEX IF NOT EXISTS idx_items_status ON items (status);
CREATE INDEX IF NOT EXISTS idx_items_sub_category_id ON items (sub_category_id);

-- Operations Table (Idempotency and Atomic Operations)
CREATE TABLE IF NOT EXISTS operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_key TEXT UNIQUE NOT NULL,
    actor_id INTEGER,
    operation_type TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('in_progress', 'completed', 'failed')),
    response_status INTEGER,
    response_body TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_operations_key ON operations (operation_key);
CREATE INDEX IF NOT EXISTS idx_operations_actor_id ON operations (actor_id);

-- Purchase Orders Table
CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_number TEXT UNIQUE NOT NULL,
    provider_id INTEGER NOT NULL,
    provider_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'open', 'closed', 'void', 'expired')),
    notes TEXT,
    created_by INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    dispatched_at TIMESTAMP,
    dispatched_by INTEGER,
    revision INTEGER NOT NULL DEFAULT 0,
    received_by INTEGER,
    closed_at TIMESTAMP,
    voided_by INTEGER,
    voided_at TIMESTAMP,
    void_reason TEXT,
    currency TEXT NOT NULL DEFAULT 'EGP',
    currency_scale INTEGER NOT NULL DEFAULT 2,
    total_amount INTEGER NOT NULL DEFAULT 0,
    CHECK(status = 'draft' OR status = 'void' OR (expires_at IS NOT NULL AND dispatched_at IS NOT NULL)),
    CHECK(status != 'draft' OR (expires_at IS NULL AND dispatched_at IS NULL)),
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (dispatched_by) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders (status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_at ON purchase_orders (created_at);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status_created_at ON purchase_orders (status, created_at);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status_dispatched_at ON purchase_orders (status, dispatched_at);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_provider_id ON purchase_orders (provider_id);

-- Purchase Order Items Table
CREATE TABLE IF NOT EXISTS purchase_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    unit_id INTEGER NOT NULL,
    unit_name TEXT NOT NULL,
    line_description TEXT,
    requested_quantity INTEGER NOT NULL CHECK(requested_quantity >= 0),
    ordered_quantity INTEGER NOT NULL CHECK(ordered_quantity >= 0),
    unit_price INTEGER NOT NULL DEFAULT 0 CHECK(unit_price >= 0),
    line_total INTEGER NOT NULL DEFAULT 0 CHECK(line_total >= 0),
    received_quantity INTEGER NOT NULL DEFAULT 0 CHECK(received_quantity >= 0 AND received_quantity <= ordered_quantity),
    FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE RESTRICT,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT,
    FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE RESTRICT,
    UNIQUE (po_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_po_items_po_id ON purchase_order_items (po_id);
CREATE INDEX IF NOT EXISTS idx_po_items_item_id ON purchase_order_items (item_id);

-- Leave Orders Table
CREATE TABLE IF NOT EXISTS leave_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT UNIQUE NOT NULL,
    employee_name TEXT NOT NULL,
    destination_id INTEGER NOT NULL,
    destination_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'rejected', 'closed', 'partially_returned', 'cancelled')),
    notes TEXT,
    created_by INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revision INTEGER NOT NULL DEFAULT 0,
    closed_by INTEGER,
    closed_at TIMESTAMP,
    close_reason TEXT,
    rejection_reason TEXT,
    rejected_by INTEGER,
    rejected_at TIMESTAMP,
    FOREIGN KEY (rejected_by) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (destination_id) REFERENCES destinations(id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_leave_orders_status ON leave_orders (status);
CREATE INDEX IF NOT EXISTS idx_leave_orders_created_at ON leave_orders (created_at);

-- Leave Order Items Table
CREATE TABLE IF NOT EXISTS leave_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    leave_order_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    unit_id INTEGER NOT NULL,
    unit_name TEXT NOT NULL,
    requested_quantity INTEGER NOT NULL CHECK(requested_quantity > 0),
    dispensed_quantity INTEGER NOT NULL DEFAULT 0 CHECK(dispensed_quantity >= 0 AND dispensed_quantity <= requested_quantity),
    returned_quantity INTEGER NOT NULL DEFAULT 0 CHECK(returned_quantity >= 0 AND returned_quantity <= dispensed_quantity),
    FOREIGN KEY (leave_order_id) REFERENCES leave_orders(id) ON DELETE RESTRICT,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT,
    FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE RESTRICT,
    UNIQUE (leave_order_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_lo_items_order_id ON leave_order_items (leave_order_id);
CREATE INDEX IF NOT EXISTS idx_lo_items_item_id ON leave_order_items (item_id);
CREATE INDEX IF NOT EXISTS idx_lo_items_item_order ON leave_order_items (item_id, leave_order_id);

CREATE TABLE IF NOT EXISTS leave_order_rejection_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    leave_order_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    rejected_by INTEGER NOT NULL,
    rejected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revision INTEGER NOT NULL,
    FOREIGN KEY (leave_order_id) REFERENCES leave_orders(id) ON DELETE RESTRICT,
    FOREIGN KEY (rejected_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_leave_rejection_events_order ON leave_order_rejection_events (leave_order_id);

-- Return Events Table
CREATE TABLE IF NOT EXISTS return_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    leave_order_id INTEGER NOT NULL,
    operation_key TEXT UNIQUE,
    created_by INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    FOREIGN KEY (leave_order_id) REFERENCES leave_orders(id) ON DELETE RESTRICT,
    FOREIGN KEY (operation_key) REFERENCES operations(operation_key) ON DELETE RESTRICT,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_return_events_leave_order ON return_events (leave_order_id);

-- Return Event Items Table
CREATE TABLE IF NOT EXISTS return_event_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    return_event_id INTEGER NOT NULL,
    leave_order_item_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    FOREIGN KEY (return_event_id) REFERENCES return_events(id) ON DELETE RESTRICT,
    FOREIGN KEY (leave_order_item_id) REFERENCES leave_order_items(id) ON DELETE RESTRICT,
    UNIQUE (return_event_id, leave_order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_return_items_event_id ON return_event_items (return_event_id);

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
    user_id INTEGER,
    actor_name TEXT,
    operation_key TEXT,
    po_line_id INTEGER,
    leave_line_id INTEGER,
    return_event_id INTEGER,
    unit_name TEXT,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT,
    FOREIGN KEY (destination_id) REFERENCES destinations(id) ON DELETE RESTRICT,
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (po_line_id) REFERENCES purchase_order_items(id) ON DELETE RESTRICT,
    FOREIGN KEY (leave_line_id) REFERENCES leave_order_items(id) ON DELETE RESTRICT,
    FOREIGN KEY (return_event_id) REFERENCES return_events(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_mov_log_item_id ON movement_logs (item_id);
CREATE INDEX IF NOT EXISTS idx_mov_log_action_type ON movement_logs (action_type);
CREATE INDEX IF NOT EXISTS idx_mov_log_timestamp ON movement_logs (timestamp);
CREATE INDEX IF NOT EXISTS idx_mov_log_provider_id ON movement_logs (provider_id);
CREATE INDEX IF NOT EXISTS idx_mov_log_destination_id ON movement_logs (destination_id);
CREATE INDEX IF NOT EXISTS idx_movement_logs_user_id ON movement_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_movement_logs_operation_key ON movement_logs (operation_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mov_log_op_item_action ON movement_logs (operation_key, item_id, action_type) WHERE operation_key IS NOT NULL;
