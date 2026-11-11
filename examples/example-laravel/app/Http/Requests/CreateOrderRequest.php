<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class CreateOrderRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'user_id' => 'required|integer',
            'total' => 'required|numeric|min:0',
            'currency' => 'required|in:EUR,USD,GBP',
            'notes' => 'nullable|string|max:500',
        ];
    }
}
