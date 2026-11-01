from rest_framework.decorators import api_view
from rest_framework.response import Response

from .serializers import LoginSerializer, RefreshTokenSerializer


@api_view(["POST"])
def login(request):
    return Response({"token": "fake"})


@api_view(["POST"])
def refresh(request):
    return Response({"token": "fake"})


@api_view(["POST"])
def logout(request):
    return Response({"ok": True})