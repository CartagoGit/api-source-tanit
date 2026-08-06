"""Schemas de orders. Mezcla Marshmallow y Pydantic a propósito: un
proyecto real puede tener las dos librerías conviviendo."""

from marshmallow import Schema, fields, validate
from pydantic import BaseModel
from typing import Literal, Optional


class OrderSchema(Schema):
    customer_name = fields.Str(required=True)
    customer_email = fields.Email(required=True)
    amount = fields.Float(required=True)
    currency = fields.Str(required=True, validate=validate.OneOf(["EUR", "USD"]))


class UpdateOrderStatus(BaseModel):
    status: Literal["pending", "shipped", "delivered", "cancelled"]
    note: Optional[str] = None
