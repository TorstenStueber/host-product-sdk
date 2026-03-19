# host-product-sdk

This project is experimental. It serves as a playground for exploring the architecture of the Product SDK and Host SDK in interaction with the Host API.

The three packages in this repo map to the three layers of the Host-Product architecture:

- `packages/shared`: Host API definition (versioned, SCALE-encoded)
- `packages/host`: Host SDK
- `packages/product`: Product SDK

For a detailed walkthrough of the code in this repo, see [ARCHITECTURE.md](./ARCHITECTURE.md).
