from rest_framework import serializers


class OrderSerializer(serializers.Serializer):
    customer_name = serializers.CharField()
    customer_email = serializers.EmailField()
    amount = serializers.IntegerField(min_value=1)
    currency = serializers.ChoiceField(choices=["EUR", "USD", "GBP"])


class UpdateOrderStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(
        choices=["pending", "paid", "shipped", "cancelled"]
    )