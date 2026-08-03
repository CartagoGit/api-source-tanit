from rest_framework import serializers


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(min_length=8, max_length=128)


class RefreshTokenSerializer(serializers.Serializer):
    refresh_token = serializers.CharField()