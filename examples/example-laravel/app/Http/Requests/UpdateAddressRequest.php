<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateAddressRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'street' => 'required|string|max:200',
            'city' => 'required|string|max:100',
            'zip' => 'required|string|max:10',
            'country' => 'required|string|size:2',
        ];
    }
}
