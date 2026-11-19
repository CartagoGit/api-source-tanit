<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class CreateUserRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'name'     => ['required', 'string', 'max:100'],
            'email'    => ['required', 'email'],
            'age'      => ['required', 'integer', 'min:0', 'max:120'],
            'role'     => ['required', 'string', 'in:admin,user,guest'],
        ];
    }
}
