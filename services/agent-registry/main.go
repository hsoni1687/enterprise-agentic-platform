package main

import (
	"database/sql"
	"log"
	"net/http"
	"os"

	_ "github.com/lib/pq"

	"github.com/agent-platform/agent-registry/pkg/service"
	"github.com/agent-platform/agent-registry/pkg/store"
)

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Tenant-ID")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	var s store.Store
	var rawDB *sql.DB
	dsn := os.Getenv("DATABASE_URL")
	if dsn != "" {
		db, err := sql.Open("postgres", dsn)
		if err != nil {
			log.Fatalf("Failed to open database: %v", err)
		}
		pg, err := store.NewPostgresStore(db)
		if err != nil {
			log.Fatalf("Failed to connect to database: %v", err)
		}
		s = pg
		rawDB = db // kept for improvement-proposal queries
		log.Println("Agent Registry: using PostgreSQL store")
	} else {
		s = store.NewInMemoryStore()
		log.Println("Agent Registry: using in-memory store (set DATABASE_URL for production)")
	}

	h := service.NewHandlerWithDB(s, rawDB)
	mux := service.BuildMux(h)

	addr := ":8088"
	log.Printf("Starting Agent Registry on %s", addr)
	if err := http.ListenAndServe(addr, withCORS(mux)); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
