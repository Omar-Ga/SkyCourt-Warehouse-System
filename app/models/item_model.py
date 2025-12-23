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
        where_clauses.append("(i.name LIKE ? OR i.id LIKE ? OR i.barcode LIKE ?)")
        search_like = f"%{search_term}%"
        params.extend([search_like, search_like, search_like])
    
    if sub_category_id is not None:
        where_clauses.append("i.sub_category_id = ?")
        params.append(sub_category_id)
        
    full_where_clause = " WHERE " + " AND ".join(where_clauses)
    
    count_query = "SELECT COUNT(i.id) " + base_query + full_where_clause
    cursor.execute(count_query, params)
    total_items = cursor.fetchone()[0]

    select_clause = "SELECT i.id, i.name, i.current_quantity, i.unit_id, u.name as unit_name, i.sub_category_id, c.name as sub_category_name, i.provider_id, p.name as provider_name, i.cost, i.status, i.barcode"
    query = select_clause + " " + base_query + full_where_clause + " ORDER BY i.id DESC LIMIT ? OFFSET ?"
    params.extend([page_size, (page - 1) * page_size])
    
    cursor.execute(query, params)
    items = [dict(row) for row in cursor.fetchall()]
    
    return {"items": items, "total_items": total_items}

def get_item_by_id(item_id: int, db=None):
    """Retrieves a single item by ID. Can use an existing DB connection."""
    if db is None:
        db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT i.*, u.name as unit_name, c.name as sub_category_name FROM items i JOIN units u ON i.unit_id = u.id LEFT JOIN categories c ON i.sub_category_id = c.id WHERE i.id = ?", (item_id,))
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

def get_item_by_barcode(barcode: str, db=None):
    """Retrieves a single active item by its barcode. Can use an existing DB connection."""
    if db is None:
        db = get_db()
    cursor = db.cursor()
    cursor.execute(
        """
        SELECT i.*, u.name as unit_name, c.name as sub_category_name 
        FROM items i 
        JOIN units u ON i.unit_id = u.id 
        LEFT JOIN categories c ON i.sub_category_id = c.id 
        WHERE i.barcode = ? AND i.status = 'active'
        """, 
        (barcode,)
    )
    item = cursor.fetchone()
    return dict(item) if item else None

# Write Methods (DAO only)

def insert_item(cursor, name, unit_id, sub_category_id, quantity, provider_id, cost, barcode):
    """Inserts a new item record. Expects an open cursor."""
    cursor.execute("INSERT INTO items (name, current_quantity, unit_id, sub_category_id, provider_id, cost, status, barcode) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)",
                   (name, quantity, unit_id, sub_category_id, provider_id, cost, barcode))
    return cursor.lastrowid

def update_status_and_category(cursor, item_id, status, sub_category_id):
    """Updates status and category. Expects cursor."""
    cursor.execute("UPDATE items SET status = ?, sub_category_id = ? WHERE id = ?", (status, sub_category_id, item_id))

def update_status(cursor, item_id, status):
    """Updates only status. Expects cursor."""
    cursor.execute("UPDATE items SET status = ? WHERE id = ?", (status, item_id))

def check_barcode_exists(cursor, barcode, exclude_item_id):
    """Checks if a barcode exists for another item."""
    cursor.execute("SELECT id FROM items WHERE barcode = ? AND id != ?", (barcode, exclude_item_id))
    return cursor.fetchone() is not None

def has_movement_logs(cursor, item_id):
    """Checks if there are any movement logs for this item."""
    cursor.execute("SELECT 1 FROM movement_logs WHERE item_id = ? LIMIT 1", (item_id,))
    return cursor.fetchone() is not None

def update_item_details(cursor, item_id, name, unit_id, sub_category_id, barcode):
    """Updates basic item details."""
    cursor.execute("UPDATE items SET name = ?, unit_id = ?, sub_category_id = ?, barcode = ? WHERE id = ?",
                   (name, unit_id, sub_category_id, barcode, item_id))

def update_quantity(cursor, item_id, new_quantity):
    """Updates item quantity directly."""
    cursor.execute("UPDATE items SET current_quantity = ? WHERE id = ?", (new_quantity, item_id))