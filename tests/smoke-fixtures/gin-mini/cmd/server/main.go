package main

import "github.com/gin-gonic/gin"

func main() {
	r := gin.Default()
	r.GET("/health", func(c *gin.Context) { c.JSON(200, gin.H{"status": "ok"}) })

	api := r.Group("/api")
	api.GET("/users", func(c *gin.Context) { c.JSON(200, gin.H{}) })
	api.POST("/users", func(c *gin.Context) { c.JSON(201, gin.H{}) })
	api.GET("/users/:id", func(c *gin.Context) { c.JSON(200, gin.H{}) })
	api.DELETE("/users/:id", func(c *gin.Context) { c.JSON(204, nil) })
	r.Run()
}
