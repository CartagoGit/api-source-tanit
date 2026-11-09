<?php
namespace App\Controller;

use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

#[Route('/orders')]
class OrderController
{
    #[Route('', methods: ['GET'])]
    public function list(): JsonResponse
    {
        return new JsonResponse([]);
    }

    #[Route('', methods: ['POST'])]
    public function create(
        #[Assert\NotBlank]
        string $customerName,
        #[Assert\Email]
        string $customerEmail,
        #[Assert\Positive]
        int $amount,
    ): JsonResponse {
        return new JsonResponse(['id' => 1, 'total' => $amount]);
    }

    #[Route('/{id}', methods: ['GET'])]
    public function show(string $id): JsonResponse
    {
        return new JsonResponse(['id' => $id]);
    }

    #[Route('/{id}/status', methods: ['PATCH'])]
    public function updateStatus(
        string $id,
        #[Assert\Choice(['pending', 'paid', 'shipped', 'cancelled'])]
        string $status,
    ): JsonResponse {
        return new JsonResponse(['id' => $id, 'status' => $status]);
    }
}
