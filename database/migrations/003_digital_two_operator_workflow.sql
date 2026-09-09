-- database/migrations/003_digital_two_operator_workflow.sql
-- Reconstructs the order and inventory tables for reservation-based execution.
-- Legacy identifier values are intentionally discarded.

PRAGMA foreign_keys = OFF;

-- Child tables are rebuilt before their parent tables. The migration runner
-- keeps enforcement disabled while this script runs.

CREATE TABLE items_v3 (
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
INSERT INTO items_v3 (id, name, unit_id, sub_category_id, provider_id, current_quantity, reserved_quantity, cost, status)
SELECT id, name, unit_id, sub_category_id, provider_id, current_quantity, 0, cost, status FROM items;
DROP TABLE items;
ALTER TABLE items_v3 RENAME TO items;
CREATE INDEX idx_items_name_v3 ON items (name);
CREATE INDEX idx_items_status_v3 ON items (status);
CREATE INDEX idx_items_sub_category_id_v3 ON items (sub_category_id);

CREATE TABLE purchase_orders_v3 (
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
    CHECK(status IN ('draft', 'void') OR (expires_at IS NOT NULL AND dispatched_at IS NOT NULL)),
    CHECK(status != 'draft' OR (expires_at IS NULL AND dispatched_at IS NULL)),
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (dispatched_by) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE RESTRICT
);
INSERT INTO purchase_orders_v3 (
    id, po_number, provider_id, provider_name, status, notes, created_by, created_at,
    expires_at, dispatched_at, dispatched_by, revision, received_by, closed_at,
    voided_by, voided_at, void_reason, currency, currency_scale, total_amount
)
SELECT id, po_number, provider_id, provider_name,
       CASE WHEN status = 'open' THEN 'open' ELSE status END,
       notes, created_by, created_at,
       CASE WHEN status = 'draft' THEN NULL ELSE datetime(created_at, '+30 days') END,
       CASE WHEN status = 'draft' THEN NULL ELSE created_at END,
       CASE WHEN status = 'draft' THEN NULL ELSE created_by END,
       revision, received_by, closed_at, voided_by, voided_at, void_reason,
       currency, currency_scale, total_amount
FROM purchase_orders;
DROP TABLE purchase_orders;
ALTER TABLE purchase_orders_v3 RENAME TO purchase_orders;
CREATE INDEX idx_purchase_orders_status_v3 ON purchase_orders (status);
CREATE INDEX idx_purchase_orders_created_at_v3 ON purchase_orders (created_at);
CREATE INDEX idx_purchase_orders_status_created_at_v3 ON purchase_orders (status, created_at);
CREATE INDEX idx_purchase_orders_status_dispatched_at_v3 ON purchase_orders (status, dispatched_at);
CREATE INDEX idx_purchase_orders_provider_id_v3 ON purchase_orders (provider_id);

CREATE TABLE purchase_order_items_v3 (
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
INSERT INTO purchase_order_items_v3 (
    id, po_id, item_id, item_name, unit_id, unit_name, line_description,
    requested_quantity, ordered_quantity, unit_price, line_total, received_quantity
)
SELECT id, po_id, item_id, item_name, unit_id, unit_name, line_description,
       ordered_quantity, ordered_quantity, unit_price, line_total,
       COALESCE(received_quantity, 0)
FROM purchase_order_items;
DROP TABLE purchase_order_items;
ALTER TABLE purchase_order_items_v3 RENAME TO purchase_order_items;
CREATE INDEX idx_po_items_po_id_v3 ON purchase_order_items (po_id);
CREATE INDEX idx_po_items_item_id_v3 ON purchase_order_items (item_id);
CREATE INDEX idx_po_items_po_item_v3 ON purchase_order_items (po_id, item_id);

CREATE TABLE leave_orders_v3 (
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
    FOREIGN KEY (destination_id) REFERENCES destinations(id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (rejected_by) REFERENCES users(id) ON DELETE RESTRICT
);
INSERT INTO leave_orders_v3 (
    id, order_number, employee_name, destination_id, destination_name, status, notes,
    created_by, created_at, revision, closed_by, closed_at, close_reason
)
SELECT id, order_number, employee_name, destination_id, destination_name,
       CASE WHEN status = 'open' THEN 'closed' ELSE status END,
       notes, created_by, created_at, revision, closed_by, closed_at, close_reason
FROM leave_orders;
DROP TABLE leave_orders;
ALTER TABLE leave_orders_v3 RENAME TO leave_orders;
CREATE INDEX idx_leave_orders_status_v3 ON leave_orders (status);
CREATE INDEX idx_leave_orders_created_at_v3 ON leave_orders (created_at);
CREATE INDEX idx_leave_orders_status_created_at_v3 ON leave_orders (status, created_at);

CREATE TABLE leave_order_items_v3 (
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
INSERT INTO leave_order_items_v3 (
    id, leave_order_id, item_id, item_name, unit_id, unit_name,
    requested_quantity, dispensed_quantity, returned_quantity
)
SELECT id, leave_order_id, item_id, item_name, unit_id, unit_name,
       quantity, quantity, returned_quantity
FROM leave_order_items;
DROP TABLE leave_order_items;
ALTER TABLE leave_order_items_v3 RENAME TO leave_order_items;
CREATE INDEX idx_lo_items_order_id_v3 ON leave_order_items (leave_order_id);
CREATE INDEX idx_lo_items_item_id_v3 ON leave_order_items (item_id);
CREATE INDEX idx_lo_items_item_order_v3 ON leave_order_items (item_id, leave_order_id);

CREATE TABLE leave_order_rejection_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    leave_order_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    rejected_by INTEGER NOT NULL,
    rejected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revision INTEGER NOT NULL,
    FOREIGN KEY (leave_order_id) REFERENCES leave_orders(id) ON DELETE RESTRICT,
    FOREIGN KEY (rejected_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX idx_leave_rejection_events_order ON leave_order_rejection_events (leave_order_id);

-- Preserve existing return/audit rows while changing their referenced tables.
CREATE TABLE return_events_v3 (
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
INSERT INTO return_events_v3 SELECT id, leave_order_id, operation_key, created_by, created_at, notes FROM return_events;

CREATE TABLE return_event_items_v3 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    return_event_id INTEGER NOT NULL,
    leave_order_item_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    FOREIGN KEY (return_event_id) REFERENCES return_events(id) ON DELETE RESTRICT,
    FOREIGN KEY (leave_order_item_id) REFERENCES leave_order_items(id) ON DELETE RESTRICT,
    UNIQUE (return_event_id, leave_order_item_id)
);
INSERT INTO return_event_items_v3 SELECT id, return_event_id, leave_order_item_id, quantity FROM return_event_items;

CREATE TABLE movement_logs_v3 (
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
INSERT INTO movement_logs_v3 SELECT id, timestamp, item_id, item_name, action_type, quantity_changed, resulting_quantity, provider_id, cost_per_item, details, person_name, destination_id, user_id, actor_name, operation_key, po_line_id, leave_line_id, return_event_id, unit_name FROM movement_logs;

DROP TABLE movement_logs;
DROP TABLE return_event_items;
DROP TABLE return_events;
ALTER TABLE return_events_v3 RENAME TO return_events;
ALTER TABLE return_event_items_v3 RENAME TO return_event_items;
ALTER TABLE movement_logs_v3 RENAME TO movement_logs;

CREATE INDEX idx_return_events_leave_order ON return_events(leave_order_id);
CREATE INDEX idx_return_items_event_id ON return_event_items(return_event_id);
CREATE INDEX idx_mov_log_item_id ON movement_logs(item_id);
CREATE INDEX idx_mov_log_action_type ON movement_logs(action_type);
CREATE INDEX idx_mov_log_timestamp ON movement_logs(timestamp);
CREATE INDEX idx_mov_log_provider_id ON movement_logs(provider_id);
CREATE INDEX idx_mov_log_destination_id ON movement_logs(destination_id);
CREATE INDEX idx_movement_logs_user_id ON movement_logs(user_id);
CREATE INDEX idx_movement_logs_operation_key ON movement_logs(operation_key);
CREATE UNIQUE INDEX idx_mov_log_op_item_action ON movement_logs(operation_key, item_id, action_type) WHERE operation_key IS NOT NULL;

PRAGMA foreign_keys = ON;
