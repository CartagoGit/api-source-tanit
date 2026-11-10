<?php

namespace App\Http\Controllers;

use App\Http\Requests\LoginRequest;
use App\Http\Requests\RefreshTokenRequest;
use Illuminate\Http\JsonResponse;

class AuthController extends Controller
{
    public function login(LoginRequest $request): JsonResponse
    {
        return response()->json(['access_token' => 'token']);
    }

    public function refresh(RefreshTokenRequest $request): JsonResponse
    {
        return response()->json(['access_token' => 'new-token']);
    }

    public function logout(): JsonResponse
    {
        return response()->json(['ok' => true]);
    }
}
