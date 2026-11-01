<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\OrderController;
use App\Http\Controllers\UserController;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
|
| El prefijo `/api` NO se escribe aquí: lo aplica el RouteServiceProvider
| al registrar este archivo. El scanner lo sabe, así que las URIs que
| acaban en la colección sí lo llevan.
|
*/

Route::get('/health', fn () => response()->json(['ok' => true]));

// Users — apiResource expande a las 5 rutas RESTful.
Route::apiResource('users', UserController::class);
Route::put('/users/{id}/address', [UserController::class, 'updateAddress']);
Route::get('/users/{id}/orders', [UserController::class, 'userOrders']);

// Orders
Route::apiResource('orders', OrderController::class);
Route::post('/orders/{id}/cancel', [OrderController::class, 'cancel']);

// Auth — el login de aquí es el que hace que el token se guarde solo
// en el environment de Postman.
Route::prefix('auth')->group(function () {
    Route::post('/login', [AuthController::class, 'login']);
    Route::post('/refresh', [AuthController::class, 'refresh']);
    Route::post('/logout', [AuthController::class, 'logout']);
});
