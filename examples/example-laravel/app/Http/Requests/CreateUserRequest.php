<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class CreateUserRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'name' => 'required|string|min:1|max:100',
            'email' => 'required|email|max:255',
            'age' => 'nullable|integer|min:0|max:120',
            'role' => 'required|in:admin,user,guest',
            'active' => 'boolean',
        ];
    }
}
