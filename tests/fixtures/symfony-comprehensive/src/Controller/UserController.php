<?php
namespace App\Controller;

use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

#[Route('/users')]
class UserController
{
    #[Route('', methods: ['GET'])]
    public function list(): JsonResponse
    {
        return new JsonResponse([]);
    }

    #[Route('', methods: ['POST'])]
    public function create(
        #[Assert\NotBlank]
        string $name,
        #[Assert\Email]
        string $email,
        #[Assert\Range(min: 0, max: 120)]
        int $age,
        #[Assert\Choice(['admin', 'user', 'guest'])]
        string $role = 'user',
    ): JsonResponse {
        return new JsonResponse(['id' => 1, 'name' => $name, 'email' => $email]);
    }

    #[Route('/{id}', methods: ['GET'])]
    public function show(string $id): JsonResponse
    {
        return new JsonResponse(['id' => $id]);
    }

    #[Route('/{id}', methods: ['PUT'])]
    public function update(
        string $id,
        #[Assert\NotBlank]
        string $name,
        #[Assert\Email]
        string $email,
    ): JsonResponse {
        return new JsonResponse(['id' => $id, 'name' => $name]);
    }

    #[Route('/{id}', methods: ['DELETE'])]
    public function delete(string $id): JsonResponse
    {
        return new JsonResponse(['deleted' => $id]);
    }

    #[Route('/{id}/address', methods: ['PUT'])]
    public function updateAddress(
        string $id,
        #[Assert\NotBlank]
        string $street,
        #[Assert\NotBlank]
        string $city,
        #[Assert\Length(min: 2, max: 2)]
        string $country,
        #[Assert\Regex('/^\d{5}$/')]
        string $postalCode,
    ): JsonResponse {
        return new JsonResponse(['id' => $id, 'address' => ['street' => $street]]);
    }
}
