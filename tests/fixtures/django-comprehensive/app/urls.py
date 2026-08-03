from django.urls import path, include

urlpatterns = [
    path("health/", views.health, name="health"),
    path("api/users/", include("app.users.urls")),
    path("api/orders/", include("app.orders.urls")),
    path("api/auth/", include("app.auth.urls")),
]