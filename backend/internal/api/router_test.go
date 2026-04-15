package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// ── CORS middleware ───────────────────────────────────────────────────────────

func newCORSRouter() *gin.Engine {
	r := gin.New()
	r.Use(corsMiddleware())
	r.GET("/ping", func(c *gin.Context) { c.Status(http.StatusOK) })
	return r
}

func TestCORSMiddleware_SetsHeaders(t *testing.T) {
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/ping", nil)
	newCORSRouter().ServeHTTP(w, req)

	tests := []struct{ header, want string }{
		{"Access-Control-Allow-Origin", "http://localhost:5173"},
		{"Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS"},
		{"Access-Control-Allow-Headers", "Content-Type, Authorization"},
	}
	for _, tt := range tests {
		got := w.Header().Get(tt.header)
		if got != tt.want {
			t.Errorf("header %q: want %q, got %q", tt.header, tt.want, got)
		}
	}
}

func TestCORSMiddleware_OptionsReturns204(t *testing.T) {
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("OPTIONS", "/ping", nil)
	newCORSRouter().ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("want 204, got %d", w.Code)
	}
}

func TestCORSMiddleware_OptionsDoesNotCallNext(t *testing.T) {
	nextCalled := false
	r := gin.New()
	r.Use(corsMiddleware())
	r.OPTIONS("/ping", func(c *gin.Context) { nextCalled = true })

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("OPTIONS", "/ping", nil)
	r.ServeHTTP(w, req)

	if nextCalled {
		t.Error("handler should not be called for OPTIONS requests")
	}
}

// ── NewRouter ─────────────────────────────────────────────────────────────────

func TestNewRouter_RegistersRoutes(t *testing.T) {
	store := &mockStore{} // zero value — handlers won't be reached for 404 checks
	router := NewRouter(store)

	routes := map[string]string{
		"GET /api/series":               "/api/series",
		"GET /api/series/:id":           "/api/series/" + seriesID.String(),
		"GET /api/series/:id/graph":     "/api/series/" + seriesID.String() + "/graph?at=1",
	}

	for name, path := range routes {
		t.Run(name, func(t *testing.T) {
			w := httptest.NewRecorder()
			req, _ := http.NewRequest("GET", path, nil)
			router.ServeHTTP(w, req)
			// 404 would mean the route isn't registered; any other code means it was handled.
			if w.Code == http.StatusNotFound {
				t.Errorf("route %q not registered (got 404)", path)
			}
		})
	}
}
