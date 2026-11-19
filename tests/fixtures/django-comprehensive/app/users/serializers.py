from rest_framework import serializers


class UserSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100)
    email = serializers.EmailField()
    age = serializers.IntegerField(min_value=0, max_value=120)
    role = serializers.ChoiceField(choices=["admin", "user", "guest"])


class UpdateUserSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100)
    email = serializers.EmailField()


class AddressSerializer(serializers.Serializer):
    street = serializers.CharField()
    city = serializers.CharField()
    country = serializers.CharField(max_length=2)
    postal_code = serializers.CharField()