package api

import (
	"github.com/gin-gonic/gin"
)

func NewRouter(store Store) *gin.Engine {
	r := gin.Default()

	r.Use(corsMiddleware())

	v1 := r.Group("/api")
	{
		v1.GET("/series", listSeries(store))
		v1.GET("/series/:id", getSeries(store))
		v1.GET("/series/:id/graph", getGraphSnapshot(store))
		v1.GET("/series/:id/compiled", getCompiledGraph(store))
	}

	return r
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "http://localhost:5173")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}
