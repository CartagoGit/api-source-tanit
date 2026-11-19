<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateUserRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'name' => 'sometimes|string|min:1|max:100',
            'age' => 'sometimes|integer|min:0|max:120',
        ];
    }
}
