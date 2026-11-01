<?php

namespace App\Http\Controllers;

use App\Http\Requests\CreateOrderRequest;
use App\Http\Requests\UpdateOrderRequest;
use Illuminate\Http\Request;

class OrderController extends Controller
{
    public function index(Request $request)
    {
        return response()->json([]);
    }

    public function store(CreateOrderRequest $request)
    {
        return response()->json($request->validated(), 201);
    }

    public function show(string $id)
    {
        return response()->json(['id' => $id]);
    }

    public function update(UpdateOrderRequest $request, string $id)
    {
        return response()->json($request->validated());
    }

    public function destroy(string $id)
    {
        return response()->noContent();
    }

    public function cancel(string $id)
    {
        return response()->json(['id' => $id, 'status' => 'cancelled']);
    }
}
