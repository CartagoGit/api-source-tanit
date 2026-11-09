from rest_framework import serializers


class UserSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100)
    email = serializers.EmailField()
    age = serializers.IntegerField(required=False, min_value=0, max_value=120)
    role = serializers.ChoiceField(choices=["admin", "user", "guest"], default="user")


class CreateUserSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100)
    email = serializers.EmailField()
    age = serializers.IntegerField(required=False, min_value=0, max_value=120)


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(min_length=8)
