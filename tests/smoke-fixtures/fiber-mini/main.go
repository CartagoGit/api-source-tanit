package main

import "github.com/gofiber/fiber/v2"

func main() {
	app := fiber.New()
	app.Get("/users", func(c *fiber.Ctx) error { return c.JSON([]string{}) })
	app.Post("/users", func(c *fiber.Ctx) error { return c.SendStatus(201) })
	app.Listen(":3000")
}
