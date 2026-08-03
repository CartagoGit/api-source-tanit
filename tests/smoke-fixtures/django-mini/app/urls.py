from django.urls import path
from django.http import JsonResponse


def health(request):
    return JsonResponse({"ok": True})


def list_users(request):
    return JsonResponse([])


def create_user(request):
    return JsonResponse({})


def show_user(request, id):
    return JsonResponse({})


urlpatterns = [
    path("health/", health, name="health"),
    path("api/users/", list_users, name="users-list"),
    path("api/users/create/", create_user, name="users-create"),
    path("api/users/<int:id>/", show_user, name="users-show"),
]
