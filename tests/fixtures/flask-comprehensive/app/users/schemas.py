"""Schemas Marshmallow de users — la forma más habitual de validar en Flask."""

from marshmallow import Schema, fields, validate


class UserSchema(Schema):
    name = fields.Str(required=True, validate=validate.Length(min=1, max=80))
    email = fields.Email(required=True)
    age = fields.Int(required=False)
    role = fields.Str(required=True, validate=validate.OneOf(["admin", "user", "guest"]))


class UpdateUserSchema(Schema):
    name = fields.Str(required=False, validate=validate.Length(min=1, max=80))
    email = fields.Email(required=False)


class AddressSchema(Schema):
    street = fields.Str(required=True)
    city = fields.Str(required=True)
    country = fields.Str(required=True, validate=validate.Length(min=2, max=2))
    postal_code = fields.Str(required=True)
