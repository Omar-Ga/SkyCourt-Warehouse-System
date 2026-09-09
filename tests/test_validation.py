"""
Tests for Validation: Shape, Types, Range, Booleans, Non-finite Numbers, Enums, Foreign Keys, Unique Lines.
"""
import math
import pytest

from app.validation import (
    ValidationError,
    validate_dict,
    validate_allowed_fields,
    validate_required_fields,
    validate_integer,
    validate_positive_integer,
    validate_non_negative_integer,
    validate_number,
    validate_string,
    validate_enum,
    validate_foreign_key,
    validate_unique_lines,
    validate_line_ownership
)


def test_validate_dict_shape():
    """Verifies that non-dictionary objects are rejected."""
    assert validate_dict({"key": "value"}) == {"key": "value"}

    with pytest.raises(ValidationError) as exc:
        validate_dict(["item1", "item2"])
    assert exc.value.code == "INVALID_OBJECT_SHAPE"

    with pytest.raises(ValidationError):
        validate_dict("string_payload")

    with pytest.raises(ValidationError):
        validate_dict(123)


def test_validate_allowed_and_required_fields():
    """Tests unknown field rejection and missing field detection."""
    data = {"name": "Item A", "unit_id": 1, "extra": "forbidden"}

    with pytest.raises(ValidationError) as exc:
        validate_allowed_fields(data, ["name", "unit_id"])
    assert exc.value.code == "UNKNOWN_FIELD"
    assert exc.value.field == "extra"

    with pytest.raises(ValidationError) as exc:
        validate_required_fields({"name": "Item A"}, ["name", "unit_id"])
    assert exc.value.code == "MISSING_REQUIRED_FIELD"
    assert exc.value.field == "unit_id"


def test_reject_booleans_where_numbers_expected():
    """
    In Python, isinstance(True, int) is True.
    Validation must explicitly reject booleans where integers or numbers are required.
    """
    with pytest.raises(ValidationError) as exc:
        validate_integer(True, "quantity")
    assert exc.value.code == "INVALID_TYPE"

    with pytest.raises(ValidationError) as exc:
        validate_integer(False, "quantity")
    assert exc.value.code == "INVALID_TYPE"

    with pytest.raises(ValidationError) as exc:
        validate_positive_integer(True, "quantity")
    assert exc.value.code == "INVALID_TYPE"

    with pytest.raises(ValidationError) as exc:
        validate_number(True, "cost")
    assert exc.value.code == "INVALID_TYPE"


def test_reject_fractional_and_non_integer_quantities():
    """Tests that floats, fractions, and strings are rejected for integer fields."""
    with pytest.raises(ValidationError) as exc:
        validate_integer(2.5, "quantity")
    assert exc.value.code == "INVALID_TYPE"

    with pytest.raises(ValidationError) as exc:
        validate_positive_integer(10.0, "quantity")
    assert exc.value.code == "INVALID_TYPE"

    with pytest.raises(ValidationError):
        validate_integer("10", "quantity")


def test_reject_non_positive_quantities():
    """Tests that zero and negative quantities are rejected where positive integer is required."""
    assert validate_positive_integer(1, "quantity") == 1
    assert validate_positive_integer(50, "quantity") == 50

    with pytest.raises(ValidationError) as exc:
        validate_positive_integer(0, "quantity")
    assert exc.value.code == "OUT_OF_RANGE"

    with pytest.raises(ValidationError) as exc:
        validate_positive_integer(-5, "quantity")
    assert exc.value.code == "OUT_OF_RANGE"

    # Non-negative allows zero
    assert validate_non_negative_integer(0, "initial_quantity") == 0
    with pytest.raises(ValidationError):
        validate_non_negative_integer(-1, "initial_quantity")


def test_reject_non_finite_numbers():
    """Tests that NaN, Inf, and -Inf are rejected."""
    with pytest.raises(ValidationError) as exc:
        validate_number(float("nan"), "cost")
    assert exc.value.code == "NON_FINITE_NUMBER"

    with pytest.raises(ValidationError) as exc:
        validate_number(float("inf"), "cost")
    assert exc.value.code == "NON_FINITE_NUMBER"

    with pytest.raises(ValidationError) as exc:
        validate_number(float("-inf"), "cost")
    assert exc.value.code == "NON_FINITE_NUMBER"

    # Finite numbers pass
    assert validate_number(0.0, "cost", min_val=0.0) == 0.0
    assert validate_number(12.5, "cost", min_val=0.0) == 12.5


def test_validate_enums():
    """Tests enum membership validation."""
    assert validate_enum("addition", "adjustment_type", ("addition", "removal")) == "addition"
    assert validate_enum("active", "status", ("active", "inactive", "archived")) == "active"

    with pytest.raises(ValidationError) as exc:
        validate_enum("destroy", "adjustment_type", ("addition", "removal"))
    assert exc.value.code == "INVALID_ENUM"


def test_validate_foreign_keys(migrated_db, sample_metadata):
    """Tests validation of foreign key references."""
    unit_id = sample_metadata["unit_id"]

    # Valid FK
    assert validate_foreign_key(migrated_db, "units", unit_id, "unit_id") == unit_id

    # Non-existent FK
    with pytest.raises(ValidationError) as exc:
        validate_foreign_key(migrated_db, "units", 99999, "unit_id")
    assert exc.value.code == "INVALID_FOREIGN_KEY"


def test_validate_unique_lines():
    """Tests duplicate item detection in line lists."""
    # Valid unique lines
    lines = [
        {"item_id": 1, "quantity": 10},
        {"item_id": 2, "quantity": 5}
    ]
    validate_unique_lines(lines, "item_id")  # Should pass without error

    # Duplicate item_id
    duplicate_lines = [
        {"item_id": 1, "quantity": 10},
        {"item_id": 1, "quantity": 5}
    ]
    with pytest.raises(ValidationError) as exc:
        validate_unique_lines(duplicate_lines, "item_id")
    assert exc.value.code == "DUPLICATE_LINE"

    # Empty lines
    with pytest.raises(ValidationError) as exc:
        validate_unique_lines([], "item_id")
    assert exc.value.code == "EMPTY_LINES"


def test_out_of_range_values():
    """Tests boundary values and out-of-range checks."""
    assert validate_integer(100, "val", min_val=1, max_val=100) == 100

    with pytest.raises(ValidationError) as exc:
        validate_integer(101, "val", min_val=1, max_val=100)
    assert exc.value.code == "OUT_OF_RANGE"

    with pytest.raises(ValidationError) as exc:
        validate_integer(0, "val", min_val=1, max_val=100)
    assert exc.value.code == "OUT_OF_RANGE"


def test_validate_unique_lines_rejects_invalid_ids():
    """Verifies that line items with boolean or non-integer IDs are rejected."""
    with pytest.raises(ValidationError) as exc:
        validate_unique_lines([{"item_id": True}], "item_id")
    assert exc.value.code == "INVALID_TYPE"

    with pytest.raises(ValidationError) as exc:
        validate_unique_lines([{"item_id": "abc"}], "item_id")
    assert exc.value.code == "INVALID_TYPE"


def test_validate_line_ownership(migrated_db):
    """
    Tests validate_line_ownership:
    - Passes when line belongs to expected parent order
    - Rejects when line does not exist (INVALID_FOREIGN_KEY)
    - Rejects foreign lines belonging to a different order (FOREIGN_LINE)
    """
    cursor = migrated_db.cursor()
    # Seed users and providers for PO
    cursor.execute("INSERT INTO users (username, password_hash, role, display_name) VALUES ('buyer', 'h', 'office', 'Buyer')")
    buyer_id = cursor.lastrowid
    cursor.execute("INSERT INTO providers (name) VALUES ('Test Supplier')")
    prov_id = cursor.lastrowid
    cursor.execute("INSERT INTO units (name) VALUES ('pcs')")
    unit_id = cursor.lastrowid
    cursor.execute("INSERT INTO items (name, unit_id, current_quantity) VALUES ('Widget', ?, 10)", (unit_id,))
    item_id = cursor.lastrowid

    # Create PO 1 and PO 2
    cursor.execute(
        "INSERT INTO purchase_orders (po_number, provider_id, provider_name, created_by, status) VALUES ('PO-001', ?, 'Test Supplier', ?, 'draft')",
        (prov_id, buyer_id)
    )
    po1_id = cursor.lastrowid

    cursor.execute(
        "INSERT INTO purchase_orders (po_number, provider_id, provider_name, created_by, status) VALUES ('PO-002', ?, 'Test Supplier', ?, 'draft')",
        (prov_id, buyer_id)
    )
    po2_id = cursor.lastrowid

    # Create line for PO 1
    cursor.execute(
        "INSERT INTO purchase_order_items (po_id, item_id, item_name, unit_id, unit_name, requested_quantity, ordered_quantity) VALUES (?, ?, 'Widget', ?, 'pcs', 5, 5)",
        (po1_id, item_id, unit_id)
    )
    line1_id = cursor.lastrowid
    migrated_db.commit()

    # 1. Valid line belonging to PO 1
    row = validate_line_ownership(migrated_db, "purchase_order_items", line1_id, "po_id", po1_id)
    assert row["id"] == line1_id

    # 2. Foreign line: line 1 belongs to PO 1, but we expected PO 2!
    with pytest.raises(ValidationError) as exc:
        validate_line_ownership(migrated_db, "purchase_order_items", line1_id, "po_id", po2_id)
    assert exc.value.code == "FOREIGN_LINE"

    # 3. Non-existent line ID
    with pytest.raises(ValidationError) as exc:
        validate_line_ownership(migrated_db, "purchase_order_items", 99999, "po_id", po1_id)
    assert exc.value.code == "INVALID_FOREIGN_KEY"
