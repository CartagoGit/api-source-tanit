<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;

class OrderController extends Controller
{
    public function index()
    {
        // A plain model, not a Resource: the shape of the response is
        // a database question, so this slice does not apply.
        return User::all();
    }
}
