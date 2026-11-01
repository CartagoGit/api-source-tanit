from rest_framework import generics
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .serializers import OrderSerializer, UpdateOrderStatusSerializer


class OrderListCreateView(generics.ListCreateAPIView):
    serializer_class = OrderSerializer


class OrderDetailView(generics.RetrieveAPIView):
    serializer_class = OrderSerializer


class UpdateOrderStatusView(generics.UpdateAPIView):
    serializer_class = UpdateOrderStatusSerializer


# Function-based view with @api_view.
@api_view(["POST"])
def cancel_order(request, id):
    return Response({"id": id, "status": "cancelled"})