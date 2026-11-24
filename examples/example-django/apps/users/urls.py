from django.urls import path
from rest_framework import viewsets
from . import views

urlpatterns = [
    path("users/", views.UsersViewSet.as_view({"get": "list", "post": "create"})),
    path("users/<int:id>/", views.UsersViewSet.as_view({"get": "retrieve", "put": "update", "delete": "destroy"})),
    path("auth/login/", views.login_view),
    path("auth/refresh/", views.refresh_view),
]
