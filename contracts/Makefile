.PHONY: build test clean deploy-sepolia verify-sepolia fmt

# Load environment variables from parent .env if it exists
ifneq (,$(wildcard ../.env))
    include ../.env
    export
endif

build:
	forge build

test:
	forge test -vvv

clean:
	forge clean

fmt:
	forge fmt

# Deploy to Sepolia testnet
# Requires SEPOLIA_RPC_URL and SEED_PHRASE in environment
deploy-sepolia:
	@if [ -z "$(SEPOLIA_RPC_URL)" ]; then echo "Error: SEPOLIA_RPC_URL not set"; exit 1; fi
	@if [ -z "$(SEED_PHRASE)" ]; then echo "Error: SEED_PHRASE not set"; exit 1; fi
	forge script script/DeployTestUSDT.s.sol:DeployTestUSDT \
		--rpc-url $(SEPOLIA_RPC_URL) \
		--mnemonic "$(SEED_PHRASE)" \
		--broadcast \
		--verify

# Verify an already-deployed contract
# Usage: make verify-sepolia ADDRESS=0x...
verify-sepolia:
	@if [ -z "$(ADDRESS)" ]; then echo "Error: ADDRESS not set. Usage: make verify-sepolia ADDRESS=0x..."; exit 1; fi
	@if [ -z "$(ETHERSCAN_API_KEY)" ]; then echo "Error: ETHERSCAN_API_KEY not set"; exit 1; fi
	forge verify-contract $(ADDRESS) src/TestUSDT.sol:TestUSDT \
		--chain sepolia \
		--etherscan-api-key $(ETHERSCAN_API_KEY)

# Dry run deployment (simulation without broadcasting)
deploy-dry-run:
	@if [ -z "$(SEPOLIA_RPC_URL)" ]; then echo "Error: SEPOLIA_RPC_URL not set"; exit 1; fi
	forge script script/DeployTestUSDT.s.sol:DeployTestUSDT \
		--rpc-url $(SEPOLIA_RPC_URL) \
		-vvvv
