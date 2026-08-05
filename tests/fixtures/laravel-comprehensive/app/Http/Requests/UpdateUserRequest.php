<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateUserRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'name'  => ['sometimes', 'string', 'max:100'],
            'email' => ['sometimes', 'email'],
        ];
    }
}
