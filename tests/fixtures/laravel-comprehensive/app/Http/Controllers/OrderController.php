<?php

namespace App\Http\Controllers;

use App\Http\Requests\CreateOrderRequest;
use App\Http\Requests\UpdateOrderRequest;
use Illuminate\Http\JsonResponse;

class OrderController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json([]);
    }

    public function store(CreateOrderRequest $request): JsonResponse
    {
        return response()->json(['id' => 1], 201);
    }

    public function show(int $id): JsonResponse
    {
        return response()->json(['id' => $id]);
    }

    public function update(UpdateOrderRequest $request, int $id): JsonResponse
    {
        return response()->json(['id' => $id]);
    }

    public function destroy(int $id): JsonResponse
    {
        return response()->json(['deleted' => true]);
    }

    public function cancel(int $id): JsonResponse
    {
        return response()->json(['cancelled' => true]);
    }
}
