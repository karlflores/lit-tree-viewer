package api

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"lit-tree-viewer/internal/db"
)

// listSeries handles GET /series
func listSeries(pool *pgxpool.Pool) gin.HandlerFunc {
	return func(c *gin.Context) {
		series, err := db.GetAllSeries(c.Request.Context(), pool)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch series"})
			return
		}
		c.JSON(http.StatusOK, series)
	}
}

// getSeries handles GET /series/:id
func getSeries(pool *pgxpool.Pool) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid series id"})
			return
		}

		series, err := db.GetSeriesByID(c.Request.Context(), pool, id)
		if errors.Is(err, db.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "series not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch series"})
			return
		}

		c.JSON(http.StatusOK, series)
	}
}

// getGraphSnapshot handles GET /series/:id/graph?at=N
func getGraphSnapshot(pool *pgxpool.Pool) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid series id"})
			return
		}

		atStr := c.DefaultQuery("at", "1")
		atUnit, err := strconv.Atoi(atStr)
		if err != nil || atUnit < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "at must be a positive integer"})
			return
		}

		snapshot, err := db.GetGraphSnapshot(c.Request.Context(), pool, id, atUnit)
		if errors.Is(err, db.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "series not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to build graph snapshot"})
			return
		}

		c.JSON(http.StatusOK, snapshot)
	}
}
