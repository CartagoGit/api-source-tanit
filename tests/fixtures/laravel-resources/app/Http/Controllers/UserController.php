<?php

namespace App\Http\Controllers;

use App\Http\Resources\UserResource;
use Illuminate\Http\Request;

class UserController extends Controller
{
    public function index()
    {
        return UserResource::collection(User::all());
    }

    public function store(Request $request)
    {
        $user = User::create($request->all());

        return new UserResource($user);
    }

    public function show($user)
    {
        return new UserResource(User::findOrFail($user));
    }
}
