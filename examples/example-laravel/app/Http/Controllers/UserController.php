<?php

namespace App\Http\Controllers;

use App\Http\Requests\CreateUserRequest;
use App\Http\Requests\UpdateAddressRequest;
use App\Http\Requests\UpdateUserRequest;
use Illuminate\Http\Request;

class UserController extends Controller
{
    public function index(Request $request)
    {
        return response()->json([]);
    }

    // El FormRequest tipado en la firma es de donde el scanner saca las
    // reglas de validación, y con ellas el body de ejemplo.
    public function store(CreateUserRequest $request)
    {
        return response()->json($request->validated(), 201);
    }

    public function show(string $id)
    {
        return response()->json(['id' => $id]);
    }

    public function update(UpdateUserRequest $request, string $id)
    {
        return response()->json($request->validated());
    }

    public function destroy(string $id)
    {
        return response()->noContent();
    }

    public function updateAddress(UpdateAddressRequest $request, string $id)
    {
        return response()->json($request->validated());
    }

    public function userOrders(string $id)
    {
        return response()->json([]);
    }
}
