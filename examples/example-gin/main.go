package main

import (
	"net/http"
	"github.com/gin-gonic/gin"
)

type User struct {
	Name  string `json:"name"`
	Email string `json:"email"`
	Age   int    `json:"age"`
}

func main() {
	r := gin.Default()

	// Public routes.
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// Users API.
	users := r.Group("/api/v1")
	{
		users.GET("/users", func(c *gin.Context) {
			c.JSON(http.StatusOK, []User{})
		})
		users.POST("/users", func(c *gin.Context) {
			var u User
			c.BindJSON(&u)
			c.JSON(http.StatusCreated, u)
		})
		users.GET("/users/:id", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"id": c.Param("id")})
		})
		users.PUT("/users/:id", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"id": c.Param("id")})
		})
		users.DELETE("/users/:id", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"deleted": c.Param("id")})
		})

		// Orders.
		users.GET("/orders", func(c *gin.Context) {
			c.JSON(http.StatusOK, []gin.H{})
		})
		users.POST("/orders", func(c *gin.Context) {
			c.JSON(http.StatusCreated, gin.H{"id": 1})
		})

		// Auth.
		users.POST("/auth/login", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"token": "fake"})
		})
		users.POST("/auth/refresh", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"token": "fake"})
		})
	}

	r.Run(":8080")
}
