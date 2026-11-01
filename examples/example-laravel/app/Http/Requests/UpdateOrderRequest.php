<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateOrderRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'status' => 'required|in:pending,paid,shipped,cancelled',
            'notes' => 'nullable|string|max:500',
        ];
    }
}
