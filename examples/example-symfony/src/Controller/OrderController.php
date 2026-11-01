<?php
namespace App\Controller;

use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;

class OrderController
{
    #[Route('/orders', methods: ['GET'])]
    public function listOrders(): JsonResponse
    {
        return new JsonResponse([]);
    }

    #[Route('/orders', methods: ['POST'])]
    public function createOrder(
        #[Assert\NotBlank]
        string $customerName,
        #[Assert\Email]
        string $customerEmail,
        #[Assert\Positive]
        int $amount,
    ): JsonResponse {
        return new JsonResponse(['ok' => true]);
    }
}
