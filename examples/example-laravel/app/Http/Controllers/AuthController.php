<?php

namespace App\Http\Controllers;

use App\Http\Requests\LoginRequest;
use App\Http\Requests\RefreshTokenRequest;

class AuthController extends Controller
{
    // Devuelve el token bajo `data.token`, una de las rutas de respuesta
    // que el flujo de auth prueba en tiempo de ejecución para guardarlo
    // en el environment.
    public function login(LoginRequest $request)
    {
        return response()->json(['data' => ['token' => 'jwt-de-ejemplo']]);
    }

    public function refresh(RefreshTokenRequest $request)
    {
        return response()->json(['data' => ['token' => 'jwt-renovado']]);
    }

    public function logout()
    {
        return response()->noContent();
    }
}
