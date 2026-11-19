<?php
use Illuminate\Support\Facades\Route;

Route::get('/health', fn() => ['ok' => true]);
Route::get('/users', [\App\Http\Controllers\UserController::class, 'index']);
Route::post('/users', [\App\Http\Controllers\UserController::class, 'store']);
Route::get('/users/{id}', [\App\Http\Controllers\UserController::class, 'show']);
Route::delete('/users/{id}', [\App\Http\Controllers\UserController::class, 'destroy']);
