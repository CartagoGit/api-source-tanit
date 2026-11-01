from django.urls import path
from .views import UserListCreateView, UserDetailView, UserAddressView

urlpatterns = [
    path("", UserListCreateView.as_view(), name="users-list"),
    path("<int:id>/", UserDetailView.as_view(), name="users-detail"),
    path("<int:id>/address/", UserAddressView.as_view(), name="users-address"),
]