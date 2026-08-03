<?php
namespace App\Controller;

use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

#[Route('/api/auth')]
class AuthController
{
    #[Route('/login', methods: ['POST'])]
    public function login(
        #[Assert\Email] string $email,
        #[Assert\Length(min: 8, max: 128)] string $password,
    ): JsonResponse
    {
        return new JsonResponse(['token' => 'fake']);
    }

    #[Route('/refresh', methods: ['POST'])]
    public function refresh(
        #[Assert\NotBlank] string $refreshToken,
    ): JsonResponse
    {
        return new JsonResponse(['token' => 'fake']);
    }

    #[Route('/logout', methods: ['POST'])]
    public function logout(): JsonResponse
    {
        return new JsonResponse(['ok' => true]);
    }
}
