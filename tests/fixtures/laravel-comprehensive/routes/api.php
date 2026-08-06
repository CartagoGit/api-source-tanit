<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\UserController;
use App\Http\Controllers\OrderController;
use App\Http\Controllers\AuthController;

/*
|--------------------------------------------------------------------------
| API Routes (comprehensive fixture)
|--------------------------------------------------------------------------
|
| Este archivo modela un `routes/api.php` REAL: el prefijo `/api` lo
| aplica el RouteServiceProvider al registrar el archivo, NO se declara
| aquí. Por eso las URIs finales llevan `/api` aunque el código no lo
| escriba.
|
| Health
|   GET    /api/health
|
| Users — apiResource (5 rutas RESTful JSON)
|   GET    /api/users
|   POST   /api/users
|   GET    /api/users/{id}
|   PUT    /api/users/{id}
|   DELETE /api/users/{id}
|
| Users — extra endpoints
|   PUT    /api/users/{id}/address
|   GET    /api/users/{id}/orders
|
| Orders — apiResource
|   GET    /api/orders
|   POST   /api/orders
|   GET    /api/orders/{id}
|   PUT    /api/orders/{id}
|   DELETE /api/orders/{id}
|
| Orders — action
|   POST   /api/orders/{id}/cancel
|
| Auth — explicit, bajo un grupo con prefijo propio
|   POST   /api/auth/login
|   POST   /api/auth/refresh
|   POST   /api/auth/logout
|
*/

Route::get('/health', fn () => response()->json(['ok' => true]));

// Users
Route::apiResource('users', UserController::class);
Route::put('/users/{id}/address', [UserController::class, 'updateAddress']);
Route::get('/users/{id}/orders', [UserController::class, 'userOrders']);

// Orders
Route::apiResource('orders', OrderController::class);
Route::post('/orders/{id}/cancel', [OrderController::class, 'cancel']);

// Auth
Route::prefix('auth')->group(function () {
    Route::post('/login', [AuthController::class, 'login']);
    Route::post('/refresh', [AuthController::class, 'refresh']);
    Route::post('/logout', [AuthController::class, 'logout']);
});
