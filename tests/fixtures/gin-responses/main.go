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

	// The dominant Gin idiom: a group, and the routes declared on it.
	// Nothing forces the group to be called `r` or `router` — the
	// project calls it whatever it calls it, and the inferrer has to
	// read the route all the same.
	v1 := r.Group("/api/v1")

	v1.GET("/accounts", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"id": 3, "name": "Alan"})
	})

	v1.POST("/accounts", func(c *gin.Context) {
		c.JSON(http.StatusCreated, gin.H{"id": 4, "name": "Edsger"})
	})

	// The edge: a collection with no items in it. There is no field
	// to prove, so the inferrer has nothing to say — and saying
	// nothing is the honest answer.
	v1.GET("/orders", func(c *gin.Context) {
		c.JSON(http.StatusOK, []gin.H{})
	})

	_ = http.ListenAndServe(":8080", r)
}
