package main

import "github.com/gofiber/fiber/v2"

// CreateUserRequest es el body de POST /api/users.
type CreateUserRequest struct {
	Name  string `json:"name" validate:"required,min=1,max=100"`
	Email string `json:"email" validate:"required,email"`
	Age   int    `json:"age" validate:"min=0,max=120"`
	Role  string `json:"role" validate:"required,oneof=admin user guest"`
}

type LoginRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required,min=8"`
}

func main() {
	app := fiber.New()

	api := app.Group("/api")

	api.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"ok": true})
	})

	api.Get("/users", func(c *fiber.Ctx) error {
		return c.JSON([]string{})
	})

	api.Post("/users", func(c *fiber.Ctx) error {
		var body CreateUserRequest
		if err := c.BodyParser(&body); err != nil {
			return err
		}
		return c.Status(201).JSON(body)
	})

	api.Get("/users/:id", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"id": c.Params("id")})
	})

	api.Put("/users/:id", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{})
	})

	api.Delete("/users/:id", func(c *fiber.Ctx) error {
		return c.SendStatus(204)
	})

	api.Post("/auth/login", func(c *fiber.Ctx) error {
		var body LoginRequest
		if err := c.BodyParser(&body); err != nil {
			return err
		}
		return c.JSON(fiber.Map{"token": "jwt"})
	})

	app.Listen(":3000")
}
