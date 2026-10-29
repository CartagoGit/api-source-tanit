package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type User struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

func main() {
	r := gin.Default()

	r.GET("/users", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"id": 1, "name": "Ada"})
	})

	r.POST("/users", func(c *gin.Context) {
		c.JSON(http.StatusCreated, gin.H{"id": 2, "name": "Grace"})
	})

	r.GET("/users/:id", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"id": 1, "name": "Ada"})
	})

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	_ = http.ListenAndServe(":8080", r)
}
