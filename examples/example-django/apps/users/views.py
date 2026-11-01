from rest_framework import viewsets, status
from rest_framework.decorators import api_view
from rest_framework.response import Response
from .serializers import UserSerializer, CreateUserSerializer, LoginSerializer


class UsersViewSet(viewsets.ModelViewSet):
    queryset = []
    serializer_class = UserSerializer


@api_view(["POST"])
def login_view(request):
    serializer = LoginSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    return Response({"token": "fake"})


@api_view(["POST"])
def refresh_view(request):
    serializer = LoginSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    return Response({"token": "fake"})
