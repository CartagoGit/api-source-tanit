<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateOrderRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'status' => ['sometimes', 'string', 'in:pending,paid,shipped,cancelled'],
            'amount' => ['sometimes', 'numeric', 'min:0'],
        ];
    }
}
