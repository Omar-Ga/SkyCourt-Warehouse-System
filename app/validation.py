"""
Validation utilities for SkyCourt Warehouse System.
Provides strict type, range, enum, foreign key, and shape validations.
"""
import math
from decimal import Decimal, InvalidOperation
from typing import Any, Container, Optional, Tuple


class ValidationError(ValueError):
    """Raised when request payload or business input fails validation."""
    def __init__(self, message: str, field: Optional[str] = None, code: str = "VALIDATION_ERROR", details: Any = None):
        super().__init__(message)
        self.message = message
        self.field = field
        self.code = code
        self.details = details or message

    def to_dict(self):
        result = {
            "error": self.message,
            "code": self.code,
            "details": self.details
        }
        if self.field:
            result["field"] = self.field
        return result


def validate_dict(data: Any, field_name: str = "body") -> dict:
    """Ensures input is a dictionary / JSON object, not list or primitive."""
    if not isinstance(data, dict):
        raise ValidationError(
            f"Expected JSON object for '{field_name}', got {type(data).__name__}",
            field=field_name,
            code="INVALID_OBJECT_SHAPE"
        )
    return data


def validate_allowed_fields(data: dict, allowed_fields: Container[str]) -> None:
    """Rejects unknown fields not in allowed_fields."""
    unknown = [k for k in data.keys() if k not in allowed_fields]
    if unknown:
        raise ValidationError(
            f"Unknown field(s) not allowed: {', '.join(unknown)}",
            field=unknown[0],
            code="UNKNOWN_FIELD"
        )


def validate_required_fields(data: dict, required_fields: Container[str]) -> None:
    """Ensures all required fields are present in data."""
    for field in required_fields:
        if field not in data or data[field] is None:
            raise ValidationError(
                f"Missing required field: '{field}'",
                field=field,
                code="MISSING_REQUIRED_FIELD"
            )


def validate_integer(
    val: Any,
    field_name: str,
    min_val: Optional[int] = None,
    max_val: Optional[int] = None,
    allow_none: bool = False
) -> Optional[int]:
    """
    Validates that a value is an integer (strictly excluding booleans and floats).
    Applies optional min_val and max_val bounds.
    """
    if val is None:
        if allow_none:
            return None
        raise ValidationError(f"Field '{field_name}' cannot be null", field=field_name, code="NULL_VALUE")

    # In Python, isinstance(True, int) is True! Explicitly reject booleans and non-integers.
    if isinstance(val, bool) or not isinstance(val, int):
        type_name = "boolean" if isinstance(val, bool) else type(val).__name__
        raise ValidationError(
            f"Field '{field_name}' must be an integer, got {type_name}",
            field=field_name,
            code="INVALID_TYPE"
        )

    if min_val is not None and val < min_val:
        raise ValidationError(
            f"Field '{field_name}' must be at least {min_val}, got {val}",
            field=field_name,
            code="OUT_OF_RANGE"
        )

    if max_val is not None and val > max_val:
        raise ValidationError(
            f"Field '{field_name}' must be at most {max_val}, got {val}",
            field=field_name,
            code="OUT_OF_RANGE"
        )

    return val


def validate_positive_integer(val: Any, field_name: str, allow_none: bool = False) -> Optional[int]:
    """Validates integer > 0."""
    return validate_integer(val, field_name, min_val=1, allow_none=allow_none)


def validate_non_negative_integer(val: Any, field_name: str, allow_none: bool = False) -> Optional[int]:
    """Validates integer >= 0."""
    return validate_integer(val, field_name, min_val=0, allow_none=allow_none)


def validate_number(
    val: Any,
    field_name: str,
    min_val: Optional[float] = None,
    max_val: Optional[float] = None,
    allow_none: bool = False
) -> Optional[float]:
    """
    Validates that a value is a finite number (excluding booleans, NaN, and Inf).
    """
    if val is None:
        if allow_none:
            return None
        raise ValidationError(f"Field '{field_name}' cannot be null", field=field_name, code="NULL_VALUE")

    if isinstance(val, bool):
        raise ValidationError(
            f"Field '{field_name}' must be a number, got boolean",
            field=field_name,
            code="INVALID_TYPE"
        )

    if not isinstance(val, (int, float)):
        raise ValidationError(
            f"Field '{field_name}' must be a number, got {type(val).__name__}",
            field=field_name,
            code="INVALID_TYPE"
        )

    if math.isnan(val) or math.isinf(val):
        raise ValidationError(
            f"Field '{field_name}' must be a finite number",
            field=field_name,
            code="NON_FINITE_NUMBER"
        )

    if min_val is not None and val < min_val:
        raise ValidationError(
            f"Field '{field_name}' must be at least {min_val}, got {val}",
            field=field_name,
            code="OUT_OF_RANGE"
        )

    if max_val is not None and val > max_val:
        raise ValidationError(
            f"Field '{field_name}' must be at most {max_val}, got {val}",
            field=field_name,
            code="OUT_OF_RANGE"
        )

    return float(val)


def validate_string(
    val: Any,
    field_name: str,
    min_len: int = 1,
    max_len: Optional[int] = 255,
    allow_none: bool = False
) -> Optional[str]:
    """Validates string value and trimmed length bounds."""
    if val is None:
        if allow_none:
            return None
        raise ValidationError(f"Field '{field_name}' cannot be null", field=field_name, code="NULL_VALUE")

    if not isinstance(val, str):
        raise ValidationError(
            f"Field '{field_name}' must be a string, got {type(val).__name__}",
            field=field_name,
            code="INVALID_TYPE"
        )

    trimmed = val.strip()
    if min_len > 0 and len(trimmed) < min_len:
        raise ValidationError(
            f"Field '{field_name}' cannot be empty",
            field=field_name,
            code="EMPTY_STRING"
        )

    if max_len is not None and len(trimmed) > max_len:
        raise ValidationError(
            f"Field '{field_name}' exceeds maximum length of {max_len}",
            field=field_name,
            code="STRING_TOO_LONG"
        )

    return trimmed


def validate_enum(val: Any, field_name: str, allowed_values: Container[Any]) -> Any:
    """Validates membership in an allowed enum/set."""
    if val not in allowed_values:
        raise ValidationError(
            f"Invalid value '{val}' for '{field_name}'. Allowed: {sorted(list(allowed_values)) if isinstance(allowed_values, (set, list, tuple)) else allowed_values}",
            field=field_name,
            code="INVALID_ENUM"
        )
    return val


def validate_foreign_key(
    conn,
    table: str,
    id_val: Optional[int],
    field_name: str,
    condition: Optional[str] = None,
    allow_none: bool = False
) -> Optional[int]:
    """Validates that a referenced entity exists in the specified table."""
    if id_val is None:
        if allow_none:
            return None
        raise ValidationError(f"Field '{field_name}' cannot be null", field=field_name, code="NULL_VALUE")

    # Ensure id_val is integer
    validate_positive_integer(id_val, field_name)

    cursor = conn.cursor()
    # Note: table name is hardcoded in callers, id_val is parameterized
    query = f"SELECT 1 FROM {table} WHERE id = ?"
    params = [id_val]
    if condition:
        query += f" AND {condition}"
    query += " LIMIT 1"

    cursor.execute(query, params)
    if cursor.fetchone() is None:
        raise ValidationError(
            f"Referenced {field_name} with ID {id_val} does not exist in {table}",
            field=field_name,
            code="INVALID_FOREIGN_KEY"
        )
    return id_val


def validate_unique_lines(lines: list, id_field: str = "item_id") -> None:
    """Validates that a list of line items contains no duplicate item IDs and IDs are valid positive integers."""
    if not isinstance(lines, list):
        raise ValidationError(
            f"Expected list for lines, got {type(lines).__name__}",
            field="items",
            code="INVALID_OBJECT_SHAPE"
        )

    if len(lines) == 0:
        raise ValidationError("Order must contain at least one line item", field="items", code="EMPTY_LINES")

    seen = set()
    for idx, line in enumerate(lines):
        if not isinstance(line, dict):
            raise ValidationError(
                f"Line {idx} must be a dictionary object",
                field=f"items[{idx}]",
                code="INVALID_OBJECT_SHAPE"
            )
        val = line.get(id_field)
        if val is None:
            raise ValidationError(
                f"Line {idx} missing '{id_field}'",
                field=f"items[{idx}].{id_field}",
                code="MISSING_REQUIRED_FIELD"
            )
        validate_positive_integer(val, f"items[{idx}].{id_field}")
        if val in seen:
            raise ValidationError(
                f"Duplicate {id_field} ({val}) in line items",
                field=id_field,
                code="DUPLICATE_LINE"
            )
        seen.add(val)


def validate_line_ownership(
    conn: Any,
    table: str,
    line_id: int,
    order_id_col: str,
    expected_order_id: int
) -> Any:
    """
    Validates that a line item exists and belongs to the specified parent order.
    Rejects foreign lines belonging to another order or non-existent lines.
    """
    validate_positive_integer(line_id, "line_id")
    validate_positive_integer(expected_order_id, "expected_order_id")

    if not table.isidentifier() or not order_id_col.isidentifier():
        raise ValueError(f"Invalid table or column identifier: {table}.{order_id_col}")

    cursor = conn.cursor()
    cursor.execute(f"SELECT id, {order_id_col} FROM {table} WHERE id = ?", (line_id,))
    row = cursor.fetchone()
    if row is None:
        raise ValidationError(
            f"Line item with ID {line_id} does not exist in {table}",
            field="line_id",
            code="INVALID_FOREIGN_KEY"
        )

    actual_order_id = row[order_id_col] if hasattr(row, "__getitem__") and order_id_col in row else row[1]
    if actual_order_id != expected_order_id:
        raise ValidationError(
            f"Line item {line_id} belongs to {order_id_col} {actual_order_id}, not {expected_order_id}",
            field="line_id",
            code="FOREIGN_LINE"
        )
    return row


def validate_decimal_money(
    val: Any,
    field_name: str,
    scale: int = 2,
    allow_none: bool = False
) -> Optional[Tuple[Decimal, int]]:
    """
    Validates that a price/amount is finite, non-negative, and does not exceed the allowed decimal scale.
    Returns (Decimal, minor_unit_integer).
    """
    if val is None:
        if allow_none:
            return None
        raise ValidationError(f"Field '{field_name}' cannot be null", field=field_name, code="NULL_VALUE")

    if isinstance(val, bool):
        raise ValidationError(f"Field '{field_name}' must be a number, got boolean", field=field_name, code="INVALID_TYPE")

    try:
        dec = Decimal(str(val).strip())
    except (InvalidOperation, TypeError):
        raise ValidationError(f"Field '{field_name}' must be a valid decimal number", field=field_name, code="INVALID_TYPE")

    if not dec.is_finite():
        raise ValidationError(f"Field '{field_name}' must be a finite number", field=field_name, code="NON_FINITE_NUMBER")

    if dec < 0:
        raise ValidationError(f"Field '{field_name}' must be non-negative", field=field_name, code="OUT_OF_RANGE")

    exp = dec.as_tuple().exponent
    if isinstance(exp, int) and exp < -scale:
        raise ValidationError(
            f"Field '{field_name}' exceeds maximum allowed precision of {scale} decimal places",
            field=field_name,
            code="EXCESS_PRECISION"
        )

    multiplier = Decimal(10 ** scale)
    minor_unit = int(round(dec * multiplier))
    return dec, minor_unit

