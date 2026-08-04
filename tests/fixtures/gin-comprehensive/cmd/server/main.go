package main

import (
	"gin-comprehensive/internal"

	"github.com/gin-gonic/gin"
)

func main() {
	r := gin.Default()
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	api := r.Group("/api")
	api.GET("/users", internal.ListUsers)
	api.POST("/users", internal.CreateUser)
	api.GET("/users/:id", internal.GetUser)
	api.PUT("/users/:id", internal.UpdateUser)
	api.DELETE("/users/:id", internal.DeleteUser)
	api.PUT("/users/:id/address", internal.UpdateUserAddress)
	api.GET("/orders", internal.ListOrders)
	api.POST("/orders", internal.CreateOrder)
	api.GET("/orders/:id", internal.GetOrder)
	api.PATCH("/orders/:id/status", internal.UpdateOrderStatus)
	api.POST("/auth/login", internal.LoginHandler)
	api.POST("/auth/refresh", internal.RefreshHandler)
	api.POST("/auth/logout", internal.LogoutHandler)
	// internal.RegisterUserRoutes(api)
	// internal.RegisterOrderRoutes(api)
	// internal.RegisterAuthRoutes(api)

	r.Run(":8080")
}