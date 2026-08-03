from rest_framework import generics
from .serializers import UserSerializer, UpdateUserSerializer, AddressSerializer


class UserListCreateView(generics.ListCreateAPIView):
    serializer_class = UserSerializer


class UserDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = UpdateUserSerializer


class UserAddressView(generics.UpdateAPIView):
    serializer_class = AddressSerializer