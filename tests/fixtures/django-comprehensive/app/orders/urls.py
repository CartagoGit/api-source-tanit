from django.urls import path
from .views import OrderListCreateView, OrderDetailView, UpdateOrderStatusView, cancel_order

urlpatterns = [
    path("", OrderListCreateView.as_view(), name="orders-list"),
    path("<int:id>/", OrderDetailView.as_view(), name="orders-detail"),
    path("<int:id>/status/", UpdateOrderStatusView.as_view(), name="orders-status"),
    path("<int:id>/cancel/", cancel_order, name="orders-cancel"),
]