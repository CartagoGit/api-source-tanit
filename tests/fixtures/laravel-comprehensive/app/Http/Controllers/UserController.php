<?php

namespace App\Http\Controllers;

use App\Http\Requests\CreateUserRequest;
use App\Http\Requests\UpdateUserRequest;
use App\Http\Requests\UpdateAddressRequest;
use Illuminate\Http\JsonResponse;

class UserController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json([]);
    }

    public function store(CreateUserRequest $request): JsonResponse
    {
        return response()->json(['id' => 1], 201);
    }

    public function show(int $id): JsonResponse
    {
        return response()->json(['id' => $id]);
    }

    public function update(UpdateUserRequest $request, int $id): JsonResponse
    {
        return response()->json(['id' => $id]);
    }

    public function destroy(int $id): JsonResponse
    {
        return response()->json(['deleted' => true]);
    }

    public function updateAddress(UpdateAddressRequest $request, int $id): JsonResponse
    {
        return response()->json(['id' => $id]);
    }

    public function userOrders(int $id): JsonResponse
    {
        return response()->json([]);
    }
}
