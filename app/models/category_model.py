from .db_utils import get_db
import logging

logger = logging.getLogger(__name__)

def add_category(name: str, parent_id: int | None = None) -> dict | None:
    """Adds a new category to the database.
    Can be a main category (parent_id is None) or a sub-category.
    Returns the newly added category as a dictionary.
    Raises ValueError if the category limit is reached.
    """
    db = get_db()
    cursor = db.cursor()
    try:
        if parent_id is None:
            cursor.execute("SELECT COUNT(*) FROM categories WHERE parent_id IS NULL")
            if cursor.fetchone()[0] >= 25:
                raise ValueError("تم الوصول إلى الحد الأقصى للفئات الرئيسية (25).")

        cursor.execute(
            "INSERT INTO categories (name, parent_id) VALUES (?, ?)",
            (name, parent_id)
        )
        db.commit()
        new_category_id = cursor.lastrowid
        
        if new_category_id:
            return {"id": new_category_id, "name": name, "parent_id": parent_id}
        return None
    except Exception as e:
        db.rollback()
        raise e

def get_categories(
    parent_id: int | None = None, 
    main_categories_only: bool = False,
    page: int = 1,
    page_size: int = 10
) -> dict:
    """
    Retrieves categories from the database based on criteria, with pagination.
    """
    db = get_db()
    cursor = db.cursor()
    
    base_query = "FROM categories"
    count_query = "SELECT COUNT(*) "
    select_query = "SELECT id, name, parent_id "
    
    params = []
    where_clauses = []

    if main_categories_only:
        where_clauses.append("parent_id IS NULL")
    elif parent_id is not None:
        where_clauses.append("parent_id = ?")
        params.append(parent_id)
        
    if where_clauses:
        base_query += " WHERE " + " AND ".join(where_clauses)
    
    cursor.execute(count_query + base_query, params)
    total_count = cursor.fetchone()[0]
    
    select_query += base_query + " ORDER BY name ASC LIMIT ? OFFSET ?"
    params.extend([page_size, (page - 1) * page_size])
    
    cursor.execute(select_query, params)
    categories = [
        {"id": row["id"], "name": row["name"], "parent_id": row["parent_id"]}
        for row in cursor.fetchall()
    ]
    
    return {"categories": categories, "total_count": total_count}

def get_category_by_id(category_id: int) -> dict | None:
    """Retrieves a single category by its ID."""
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT id, name, parent_id FROM categories WHERE id = ?", (category_id,))
    row = cursor.fetchone()
    if row:
        return {"id": row["id"], "name": row["name"], "parent_id": row["parent_id"]}
    return None

def update_category(category_id: int, name: str) -> dict | None:
    """Updates an existing category's name."""
    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute("UPDATE categories SET name = ? WHERE id = ?", (name, category_id))
        db.commit()
        if cursor.rowcount > 0:
            return {"id": category_id, "name": name}
        return None
    except Exception as e:
        db.rollback()
        raise e

def is_category_in_use(category_id: int) -> bool:
    """
    Checks if a category has any ACTIVE associated items or any sub-categories.
    """
    db = get_db()
    cursor = db.cursor()
    
    cursor.execute("SELECT 1 FROM items WHERE sub_category_id = ? AND status = 'active' LIMIT 1", (category_id,))
    if cursor.fetchone():
        return True
        
    cursor.execute("SELECT 1 FROM categories WHERE parent_id = ? LIMIT 1", (category_id,))
    if cursor.fetchone():
        return True
        
    return False

def delete_category(category_id: int) -> bool:
    """
    Deletes a category after archiving its inactive items.
    """
    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute(
            "UPDATE items SET status = 'archived' WHERE sub_category_id = ? AND status = 'inactive'",
            (category_id,)
        )
        
        cursor.execute("DELETE FROM categories WHERE id = ?", (category_id,))
        
        db.commit()
        return cursor.rowcount > 0
    except Exception as e:
        logger.error(f"Database error in delete_category for ID {category_id}: {e}")
        db.rollback()
        return False