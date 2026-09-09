import sqlite3
from .db_utils import get_db

# Read Methods (Mostly Unchanged, but ensure they don't do business logic)

def get_items_paginated(page=1, page_size=10, search_term=None, sub_category_id=None):
    """
    Retrieves a paginated list of items using a single DB connection for the request.
    Only 'active' items are retrieved. Archived and inactive items are excluded.
    """
    db = get_db()
    cursor = db.cursor()
    
    base_query = "FROM items i JOIN units u ON i.unit_id = u.id LEFT JOIN categories c ON i.sub_category_id = c.id LEFT JOIN providers p ON i.provider_id = p.id"
    where_clauses = ["i.status = 'active'"]
    params = []

    if search_term:
        where_clauses.append("(i.name LIKE ? OR CAST(i.id AS TEXT) LIKE ?)")
        search_like = f"%{search_term}%"
        params.extend([search_like, search_like])
    
    if sub_category_id is not None:
        where_clauses.append("i.sub_category_id = ?")
        params.append(sub_category_id)
        
    full_where_clause = " WHERE " + " AND ".join(where_clauses)
    
    count_query = "SELECT COUNT(i.id) " + base_query + full_where_clause
    cursor.execute(count_query, params)
    total_count = cursor.fetchone()[0]

    select_clause = "SELECT i.id, i.name, i.current_quantity, i.reserved_quantity, (i.current_quantity - i.reserved_quantity) AS available_quantity, i.unit_id, u.name as unit_name, i.sub_category_id, c.name as sub_category_name, c.parent_id as main_category_id, i.provider_id, p.name as provider_name, i.cost, i.status"
    query = select_clause + " " + base_query + full_where_clause + " ORDER BY i.id DESC LIMIT ? OFFSET ?"
    params.extend([page_size, (page - 1) * page_size])
    
    cursor.execute(query, params)
    items = [dict(row) for row in cursor.fetchall()]
    
    return {"items": items, "total_count": total_count}

def get_item_by_id(item_id: int, db=None):
    """Retrieves a single item by ID. Can use an existing DB connection."""
    if db is None:
        db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT i.*, (i.current_quantity - i.reserved_quantity) AS available_quantity, u.name as unit_name, c.name as sub_category_name, c.parent_id as main_category_id FROM items i JOIN units u ON i.unit_id = u.id LEFT JOIN categories c ON i.sub_category_id = c.id WHERE i.id = ?", (item_id,))
    item = cursor.fetchone()
    
    return dict(item) if item else None

def get_item_by_name(name: str, db=None):
    """Retrieves an item by name. Can use an existing DB connection."""
    if db is None:
        db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT * FROM items WHERE LOWER(name) = LOWER(?)", (name,))
    item = cursor.fetchone()
    
    return dict(item) if item else None

def get_item_position(item_id: int, sub_category_id: int, db=None) -> int:
    """
    Calculates the 1-based position of an item within its sub-category, 
    based on the default sorting (ID DESC).
    Returns the count of items with ID > item_id in the same sub-category + 1.
    """
    if db is None:
        db = get_db()
    cursor = db.cursor()
    
    cursor.execute(
        "SELECT COUNT(*) FROM items WHERE sub_category_id = ? AND status = 'active' AND id > ?", 
        (sub_category_id, item_id)
    )
    count_before = cursor.fetchone()[0]
    return count_before + 1

# Write Methods (DAO only)

def insert_item(cursor, name, unit_id, sub_category_id, quantity, provider_id=None, cost=None):
    """Inserts a new item record. Expects an open cursor."""
    cursor.execute("INSERT INTO items (name, current_quantity, reserved_quantity, unit_id, sub_category_id, provider_id, cost, status) VALUES (?, ?, 0, ?, ?, ?, ?, 'active')",
                   (name, quantity, unit_id, sub_category_id, provider_id, cost))
    return cursor.lastrowid

def update_status_and_category(cursor, item_id, status, sub_category_id):
    """Updates status and category. Expects cursor."""
    cursor.execute("UPDATE items SET status = ?, sub_category_id = ? WHERE id = ?", (status, sub_category_id, item_id))

def update_status(cursor, item_id, status):
    """Updates only status. Expects cursor."""
    cursor.execute("UPDATE items SET status = ? WHERE id = ?", (status, item_id))

def has_movement_logs(cursor, item_id):
    """Checks if there are any movement logs for this item."""
    cursor.execute("SELECT 1 FROM movement_logs WHERE item_id = ? LIMIT 1", (item_id,))
    return cursor.fetchone() is not None

def has_unresolved_orders(cursor, item_id: int) -> bool:
    """Checks if an item is referenced by open purchase orders or active leave orders with unreturned stock."""
    cursor.execute(
        """
        SELECT 1 FROM purchase_order_items poi
        JOIN purchase_orders po ON poi.po_id = po.id
        WHERE poi.item_id = ? AND po.status = 'open'
        LIMIT 1
        """,
        (item_id,)
    )
    if cursor.fetchone():
        return True

    cursor.execute(
        """
        SELECT 1 FROM leave_order_items loi
        WHERE loi.item_id = ? AND (loi.dispensed_quantity - loi.returned_quantity) > 0
        LIMIT 1
        """,
        (item_id,)
    )
    if cursor.fetchone():
        return True

    return False

def update_item_details(cursor, item_id, name, unit_id, sub_category_id):
    """Updates basic item details."""
    cursor.execute("UPDATE items SET name = ?, unit_id = ?, sub_category_id = ? WHERE id = ?",
                   (name, unit_id, sub_category_id, item_id))

def update_quantity(cursor, item_id, new_quantity):
    """Updates item quantity directly."""
    cursor.execute("UPDATE items SET current_quantity = ? WHERE id = ?", (new_quantity, item_id))

def add_item_quantity_conditional(cursor, item_id: int, amount: int, active_only: bool = True) -> int:
    """
    Atomically adds quantity to an item.
    Returns new balance if successful, raises ValueError if item not eligible.
    """
    if active_only:
        cursor.execute(
            "UPDATE items SET current_quantity = current_quantity + ? WHERE id = ? AND status = 'active'",
            (amount, item_id)
        )
    else:
        cursor.execute(
            "UPDATE items SET current_quantity = current_quantity + ? WHERE id = ?",
            (amount, item_id)
        )
    if cursor.rowcount == 0:
        cursor.execute("SELECT id, status FROM items WHERE id = ?", (item_id,))
        row = cursor.fetchone()
        if not row:
            raise ValueError(f"Item with ID {item_id} does not exist.")
        status = row["status"] if hasattr(row, "__getitem__") and "status" in row else row[1]
        raise ValueError(f"Item '{item_id}' is {status}, cannot adjust quantity.")

    cursor.execute("SELECT current_quantity FROM items WHERE id = ?", (item_id,))
    return cursor.fetchone()[0]

def subtract_item_quantity_conditional(cursor, item_id: int, amount: int) -> int:
    """
    Atomically subtracts quantity from an active item if sufficient stock exists.
    Returns new balance if successful, raises ValueError if item not found, inactive, or insufficient stock.
    """
    cursor.execute(
        "UPDATE items SET current_quantity = current_quantity - ? WHERE id = ? AND status = 'active' AND current_quantity - reserved_quantity >= ?",
        (amount, item_id, amount)
    )
    if cursor.rowcount == 0:
        cursor.execute("SELECT id, status, current_quantity, reserved_quantity FROM items WHERE id = ?", (item_id,))
        row = cursor.fetchone()
        if not row:
            raise ValueError(f"Item with ID {item_id} does not exist.")
        status = row["status"] if hasattr(row, "__getitem__") and "status" in row else row[1]
        if status != "active":
            raise ValueError(f"Cannot deduct stock: item '{item_id}' is {status}.")
        curr_qty = row["current_quantity"] if hasattr(row, "__getitem__") and "current_quantity" in row else row[2]
        reserved = row["reserved_quantity"] if hasattr(row, "__getitem__") and "reserved_quantity" in row else row[3]
        raise ValueError(f"Insufficient stock for item '{item_id}': available {curr_qty - reserved}, requested {amount}.")

    cursor.execute("SELECT current_quantity FROM items WHERE id = ?", (item_id,))
    return cursor.fetchone()[0]
