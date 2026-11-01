<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class CreateOrderRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'customer_name'  => ['required', 'string', 'max:200'],
            'customer_email' => ['required', 'email'],
            'amount'         => ['required', 'numeric', 'min:0'],
            'currency'       => ['required', 'string', 'in:EUR,USD,GBP'],
        ];
    }
}
