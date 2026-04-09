BINARY  := fwd
FRONT   := frontend

.PHONY: all gobuild frontend clean run dev

all: gobuild frontend

gobuild:
	go mod tidy
	go build -o $(BINARY) ./cmd/fwd/

frontend:
	cd $(FRONT) && npm install && npm run build

run:
	sudo ./$(BINARY) -addr :8080 -static ./frontend/dist -config ./config.json

clean:
	rm -f $(BINARY)
	cd $(FRONT) && rm -rf dist node_modules
