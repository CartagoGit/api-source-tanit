from django.urls import path
from .views import login, refresh, logout

urlpatterns = [
    path("login/", login, name="auth-login"),
    path("refresh/", refresh, name="auth-refresh"),
    path("logout/", logout, name="auth-logout"),
]