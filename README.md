# Simple Crypto Mixer

* **Deployed dApp:** [https://cscd71.github.io/limit-order-exchange-ah](https://cscd71.github.io/limit-order-exchange-ah) // TODO
* **Verified Sepolia Smart Contract:** [https://sepolia.etherscan.io/address/0x469081dbbd0ffb418839cc1351af30884572f014](https://sepolia.etherscan.io/address/0x469081dbbd0ffb418839cc1351af30884572f014)

## Installing Dependencies

Follow these steps to install all dependencies:

Install Solidity dependencies (OpenZeppelin here) 

```bash
forge install OpenZeppelin/openzeppelin-contracts
```

Install dependencies

  ```bash
  npm i @zk-kit/incremental-merkle-tree.sol --save
  npm i poseidon-solidity
  ```

Compile the Circom Circuits

```bash
npm install circomlib

mkdir zk-data

circom circuits/ProofOfMembership.circom --r1cs --wasm -o zk-data
```

## Power of Tau Ceremony

Phase 1

```bash
snarkjs powersoftau new bn128 15 zk-data/pot15_0000.ptau -v

snarkjs powersoftau contribute zk-data/pot15_0000.ptau zk-data/pot15_0001.ptau --name="First contribution" -v

snarkjs powersoftau prepare phase2 zk-data/pot15_0001.ptau zk-data/pot15_final.ptau -v
```

If it gives an error try, do the same for the rest of the instructions if snarkjs causes errors:

```bash
./node_modules/.bin/snarkjs powersoftau new bn128 15 zk-data/pot15_0000.ptau -v

./node_modules/.bin/snarkjs powersoftau contribute zk-data/pot15_0000.ptau zk-data/pot15_0001.ptau --name="First contribution" -v

./node_modules/.bin/snarkjs powersoftau prepare phase2 zk-data/pot15_0001.ptau zk-data/pot15_final.ptau -v
```

Phase 2

```bash
./node_modules/.bin/snarkjs groth16 setup zk-data/ProofOfMembership.r1cs zk-data/pot15_final.ptau zk-data/ProofOfMembership.zkey

./node_modules/.bin/snarkjs zkey export verificationkey zk-data/ProofOfMembership.zkey zk-data/ProofOfMembership.vkey
```

## Generate the Solidity Veriffier
```bash
./node_modules/.bin/snarkjs zkey export solidityverifier zk-data/ProofOfMembership.zkey contracts/ProofOfMembershipVerifier.sol

sed -i "" "s/contract Groth16Verifier/contract ProofOfMembershipVerifier/" contracts/ProofOfMembershipVerifier.sol
```

## Delete waste

```bash
rm -f zk-data/ProofOfMembership.r1cs
rm -f zk-data/pot15*
```

-------------------

Install dependencies

  ```bash
  npm install
  ```

Compile the Solidity contracts

  ```bash
  forge build
  ```
  
## Deploying the Smart Contract to Sepolia

Use the same steps used for deploying Auction House to the Sepolia test network:

### Prerequisites

To deploy your app, you need two things:

- A private key account with some Sepolia ETH. There are different wallets for Ethereum; we are going to use [MetaMask](https://metamask.io/) here.
- An RPC endpoint for sending queries and transactions to the Ethereum Sepolia network. There are several Ethereum RPC providers such as [Alchemy](https://www.alchemy.com/) (our choice here) and [Infura](https://www.infura.io/).

1. Install MetaMask, create a wallet, and [export your private key](https://support.metamask.io/configure/accounts/how-to-export-an-accounts-private-key).

2. Provision your account with Sepolia ETH. To get those ETH, you can use a faucet such as [Google Sepolia Faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) or [Sepolia PoW Faucet](https://sepolia-faucet.pk910.de/).

3. Create an account on [Alchemy](https://www.alchemy.com/), then create and export an API key for Sepolia.

#### Setup

1. Create an `.env` file and set `ALCHEMY_API_KEY`:

  ```
  ALCHEMY_API_KEY=
  ALCHEMY_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}
  ```

2. Load this `.env` file:

  ```bash
  source .env
  ```

3. Verify that your RPC endpoint works. This command should show the Sepolia chain ID `11155111`:

  ```bash
  cast chain-id --rpc-url $ALCHEMY_RPC_URL
  ```

4. Record your key inside the Foundry keystore (use a strong password):

  ```bash
  cast wallet import deployer --private-key your_private_key
  ```

5. Check your balance on Sepolia and make sure that you have at least 0.01 ETH on your account:

  ```
  cast balance \
    --rpc-url $ALCHEMY_RPC_URL \
    --ether $(cast wallet address --account deployer)
  ```

### Deploy the Contract (Have to deploy multiple)

Each forge create call will return output:

```bash
Deployer: <ACCOUNT_ADDRESS>
Deployed to: <DEPLOYED_ADDRESS>
Transaction hash: <TX_HASH>
```

Your contract will be deployed to `<DEPLOYED_ADDRESS>` and `<TX_HASH>` contains the transaction that includes the deployment.

You can look at that contract on Etherscan: 

```
https://sepolia.etherscan.io/address/<DEPLOYED_ADDRESS>
```

#### Deploy Verifier

```bash
forge create contracts/ProofOfMembershipVerifier.sol:ProofOfMembershipVerifier \
  --rpc-url $ALCHEMY_RPC_URL \
  --account deployer \
  --broadcast
```

#### Deploy Poseidon

```bash
forge create node_modules/poseidon-solidity/PoseidonT3.sol:PoseidonT3 \
  --rpc-url $ALCHEMY_RPC_URL \
  --account deployer \
  --broadcast
```

#### Deploy Merkle Tree Library

```bash
forge create node_modules/@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree \
  --rpc-url $ALCHEMY_RPC_URL \
  --account deployer \
  --broadcast
```

##### Note: update foundry.toml with the new addresses:

```bash
libraries = [
    "poseidon-solidity/PoseidonT3.sol:PoseidonT3:<ADDRESS>",
    "@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree:<Address>"
]
```

#### Deploy Crypto Mixer (main contract)

```bash
forge create contracts/CryptoMixer.sol:CryptoMixer \
  --rpc-url $ALCHEMY_RPC_URL \
  --account deployer \
  --broadcast \
  --constructor-args <VERIFIER_ADDRESS>
```

#### (Optional) Verify the Contract on Etherscan

```bash
forge verify-contract \
  --chain sepolia \
  --etherscan-api-key "$ETHERSCAN_API_KEY" \
  <DEPLOYED_ADDRESS> \
  contracts/CryptoMixer.sol:CryptoMixer
  ```

## Running the dApp Frontend Locally

To start the frontend locally:

1. Replace **MIXER_ADDRESS** in **app.js** with the address of your deployed contract (if you deployed one)

2. Install dependencies
  ```bash
  npm install
  ```
3. Start the local development server:
  ```bash
  browser-sync start --server --files "**/*" --port 3000
  ```
4. Open the app in your browser:
  ```bash
  http://localhost:3000
  ```