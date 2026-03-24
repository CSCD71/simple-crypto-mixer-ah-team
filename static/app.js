// AI generated / AI assisted frontend scaffold.

import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeAbiParameters,
  formatEther,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseEther
} from "https://esm.sh/viem@2.19.4";
import { sepolia } from "https://esm.sh/viem@2.19.4/chains";
import { IncrementalMerkleTree } from "https://esm.sh/@zk-kit/incremental-merkle-tree"
import { poseidon2 } from "https://esm.sh/poseidon-lite@0.3.0";
import * as snarkjs from "https://esm.sh/snarkjs@0.7.5";

/* =========================
   CONFIG
   ========================= */

const MIXER_ADDRESS = "0x469081dBBD0fFb418839cc1351AF30884572F014";
const ETHERSCAN_BASE = "https://sepolia.etherscan.io";
const DEPOSIT_AMOUNT_ETH = "0.1";
const MERKLE_LEVELS = 20;
const ZERO_VALUE = 0n;

const WASM_PATH = "./zk-data/ProofOfMembership_js/ProofOfMembership.wasm";
const ZKEY_PATH = "./zk-data/ProofOfMembership.zkey";

const NOTES_STORAGE_KEY = "crypto-mixer-notes";

/* =========================
   ABI
   ========================= */

const MIXER_ABI = parseAbi([
  "function deposit(uint256 commitment) payable",
  "function withdraw(bytes proof, address to, uint256 nonce)",
  "function roots(uint256) view returns (bool)",
  "function nullifiers(uint256) view returns (bool)",
  "event Deposited(uint256 commitment)"
]);

/* =========================
   DOM
   ========================= */

const connectButton = document.getElementById("connectButton");
const walletStatus = document.getElementById("walletStatus");
const message = document.getElementById("message");

const networkName = document.getElementById("networkName");
const contractLink = document.getElementById("contractLink");
const contractBalance = document.getElementById("contractBalance");
const depositCount = document.getElementById("depositCount");
const refreshButton = document.getElementById("refreshButton");

const generateDepositButton = document.getElementById("generateDepositButton");
const secretOutput = document.getElementById("secretOutput");
const nullifierOutput = document.getElementById("nullifierOutput");
const commitmentOutput = document.getElementById("commitmentOutput");
const saveLocalCheckbox = document.getElementById("saveLocalCheckbox");
const depositButton = document.getElementById("depositButton");

const savedNotesSelect = document.getElementById("savedNotesSelect");
const loadSelectedNoteButton = document.getElementById("loadSelectedNoteButton");
const reloadNotesButton = document.getElementById("reloadNotesButton");
const noteInput = document.getElementById("noteInput");
const recipientInput = document.getElementById("recipientInput");
const withdrawNonceInput = document.getElementById("withdrawNonceInput");
const generateProofButton = document.getElementById("generateProofButton");
const withdrawButton = document.getElementById("withdrawButton");
const proofOutput = document.getElementById("proofOutput");

const notesList = document.getElementById("notesList");
const exportNotesButton = document.getElementById("exportNotesButton");
const clearNotesButton = document.getElementById("clearNotesButton");

/* =========================
   STATE
   ========================= */

let walletClient = null;
let publicClient = createPublicClient({
  chain: sepolia,
  transport: http()
});

let isConnected = false;
let currentAccount = null;
let currentProofBytes = "";
let currentPublicSignals = null;
let lastGeneratedDeposit = null;
let cachedDeposits = [];

/* =========================
   HELPERS
   ========================= */

function clearDepositForm() {
  secretOutput.value = "";
  nullifierOutput.value = "";
  commitmentOutput.value = "";
  lastGeneratedDeposit = null;
}

function clearWithdrawForm() {
  noteInput.value = "";
  recipientInput.value = "";
  withdrawNonceInput.value = "";
  proofOutput.value = "";
  currentProofBytes = "";
  currentPublicSignals = null;
}

function setMessage(text, tone = "info") {
  message.textContent = text;
  message.dataset.tone = tone;
}

function shortAddress(address) {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function parseJsonBigints(obj) {
  if (Array.isArray(obj)) return obj.map(parseJsonBigints);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = parseJsonBigints(v);
    }
    return out;
  }
  return obj;
}

function formatDate(ts) {
  return new Date(ts).toLocaleString();
}

function getNotes() {
  try {
    const raw = localStorage.getItem(NOTES_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveNotes(notes) {
  localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes, null, 2));
}

function addNote(note) {
  const notes = getNotes();
  notes.unshift(note);
  saveNotes(notes);
  renderNotes();
}

function removeNote(id) {
  const notes = getNotes().filter((n) => n.id !== id);
  saveNotes(notes);
  renderNotes();
}

function randomBigInt() {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return BigInt(hex);
}

function generateNonce() {
  return randomBigInt();
}

function normalizeBigInt(value) {
  if (typeof value === "bigint") return value;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Invalid number for bigint conversion");
    }
    return BigInt(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error("Empty string cannot be converted to bigint");
    }
    return BigInt(trimmed);
  }

  throw new Error(`Unable to convert value to bigint: ${String(value)}`);
}

function addressToField(address) {
  return BigInt(address);
}

// Observed public signal order:
// [root, authHash, nullifier, nonce, to]
function extractSignals(publicSignals) {
  if (!Array.isArray(publicSignals) || publicSignals.length !== 5) {
    throw new Error("Expected 5 public signals.");
  }

  return {
    root: normalizeBigInt(publicSignals[0]),
    authHash: normalizeBigInt(publicSignals[1]),
    nullifier: normalizeBigInt(publicSignals[2]),
    nonce: normalizeBigInt(publicSignals[3]),
    to: normalizeBigInt(publicSignals[4])
  };
}

async function checkProofAgainstContract(publicSignals, recipient, nonce) {
  const signals = extractSignals(publicSignals);
  const expectedRecipientField = addressToField(getAddress(recipient));
  const expectedNonce = normalizeBigInt(nonce);

  if (signals.nonce !== expectedNonce) {
    throw new Error("Nonce mismatch before submit.");
  }

  if (signals.to !== expectedRecipientField) {
    throw new Error("Recipient mismatch before submit.");
  }

  const [rootExists, nullifierUsed] = await Promise.all([
    publicClient.readContract({
      address: getAddress(MIXER_ADDRESS),
      abi: MIXER_ABI,
      functionName: "roots",
      args: [signals.root]
    }),
    publicClient.readContract({
      address: getAddress(MIXER_ADDRESS),
      abi: MIXER_ABI,
      functionName: "nullifiers",
      args: [signals.nullifier]
    })
  ]);

  if (!rootExists) {
    throw new Error("Generated root is not registered in the mixer contract.");
  }

  if (nullifierUsed) {
    throw new Error("This note appears to have already been withdrawn.");
  }

  return signals;
}

/* =========================
   WALLET
   ========================= */

async function ensureWalletClients() {
  if (!window.ethereum) {
    throw new Error("MetaMask not found. Please install MetaMask.");
  }

  if (!walletClient) {
    walletClient = createWalletClient({
      chain: sepolia,
      transport: custom(window.ethereum)
    });
  }

  publicClient = createPublicClient({
    chain: sepolia,
    transport: custom(window.ethereum)
  });
}

async function connectWallet() {
  if (isConnected) {
    resetWalletUi();
    return;
  }

  try {
    await ensureWalletClients();

    const accounts = await walletClient.requestAddresses();
    if (!accounts.length) throw new Error("No wallet account selected.");

    currentAccount = getAddress(accounts[0]);
    isConnected = true;

    connectButton.textContent = "Disconnect Wallet";
    walletStatus.textContent = `Connected: ${shortAddress(currentAccount)}`;
    setMessage("Wallet connected.", "success");

    await refreshOnChainData();
  } catch (error) {
    setMessage(error.message || "Failed to connect wallet.", "error");
  }
}

function resetWalletUi() {
  isConnected = false;
  currentAccount = null;
  currentProofBytes = "";
  currentPublicSignals = null;
  connectButton.textContent = "Connect Wallet";
  walletStatus.textContent = "";
  proofOutput.value = "";
  clearDepositForm();
  clearWithdrawForm();
  setMessage("Please connect your wallet first.");
}

if (window.ethereum) {
  window.ethereum.on("accountsChanged", async (accounts) => {
    if (!accounts || !accounts.length) {
      resetWalletUi();
      return;
    }
    if (isConnected) {
      currentAccount = getAddress(accounts[0]);
      walletStatus.textContent = `Connected: ${shortAddress(currentAccount)}`;
      clearDepositForm();
      clearWithdrawForm();
      await refreshOnChainData();
    }
  });

  window.ethereum.on("chainChanged", () => {
    window.location.reload();
  });
}

/* =========================
   ON-CHAIN DATA
   ========================= */

async function fetchDeposits() {
  const logs = await publicClient.getLogs({
    address: getAddress(MIXER_ADDRESS),
    event: {
      type: "event",
      name: "Deposited",
      inputs: [{ indexed: false, name: "commitment", type: "uint256" }]
    },
    fromBlock: 0n,
    toBlock: "latest"
  });

  return logs.map((log, index) => ({
    index,
    commitment: normalizeBigInt(log.args.commitment),
    txHash: log.transactionHash,
    blockNumber: log.blockNumber
  }));
}

async function refreshOnChainData() {
  try {
    networkName.textContent = "Sepolia";
    contractLink.href = `${ETHERSCAN_BASE}/address/${MIXER_ADDRESS}`;
    contractLink.textContent = MIXER_ADDRESS;

    const [balance, deposits] = await Promise.all([
      publicClient.getBalance({ address: getAddress(MIXER_ADDRESS) }),
      fetchDeposits()
    ]);

    cachedDeposits = deposits;
    contractBalance.textContent = `${formatEther(balance)} ETH`;
    depositCount.textContent = String(deposits.length);

    setMessage("On-chain data refreshed.", "success");
  } catch (error) {
    setMessage(error.message || "Failed to refresh on-chain data.", "error");
  }
}

/* =========================
   NOTES UI
   ========================= */

function renderNotes() {
  const notes = getNotes();

  savedNotesSelect.innerHTML = "";
  if (!notes.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No saved notes";
    savedNotesSelect.appendChild(option);
  } else {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a note";
    savedNotesSelect.appendChild(placeholder);

    notes.forEach((note) => {
      const option = document.createElement("option");
      option.value = note.id;
      option.textContent = `${note.label} • ${note.commitment.slice(0, 18)}...`;
      savedNotesSelect.appendChild(option);
    });
  }

  notesList.innerHTML = "";
  if (!notes.length) {
    notesList.innerHTML = `<div class="muted">No saved deposit notes yet.</div>`;
    return;
  }

  notes.forEach((note) => {
    const card = document.createElement("div");
    card.className = "note-card";

    card.innerHTML = `
      <div><strong>${note.label}</strong></div>
      <div class="note-meta">Created: ${formatDate(note.createdAt)}</div>
      <div class="note-meta">Commitment: ${note.commitment}</div>
      <div class="note-code">${JSON.stringify(note, null, 2)}</div>
      <div class="note-actions">
        <button class="btn ghost note-load-btn" data-id="${note.id}" type="button">Load</button>
        <button class="btn ghost note-copy-btn" data-id="${note.id}" type="button">Copy JSON</button>
        <button class="btn danger note-delete-btn" data-id="${note.id}" type="button">Delete</button>
      </div>
    `;

    notesList.appendChild(card);
  });
}

notesList.addEventListener("click", async (event) => {
  const loadBtn = event.target.closest(".note-load-btn");
  const copyBtn = event.target.closest(".note-copy-btn");
  const deleteBtn = event.target.closest(".note-delete-btn");

  const notes = getNotes();

  if (loadBtn) {
    const note = notes.find((n) => n.id === loadBtn.dataset.id);
    if (!note) return;
    noteInput.value = JSON.stringify(note, null, 2);
    withdrawNonceInput.value = generateNonce().toString();
    setMessage("Note loaded into withdraw form.", "success");
    return;
  }

  if (copyBtn) {
    const note = notes.find((n) => n.id === copyBtn.dataset.id);
    if (!note) return;
    await navigator.clipboard.writeText(JSON.stringify(note, null, 2));
    setMessage("Note JSON copied.", "success");
    return;
  }

  if (deleteBtn) {
    removeNote(deleteBtn.dataset.id);
    setMessage("Note deleted.", "success");
  }
});

/* =========================
   DEPOSIT HELPERS
   ========================= */

function buildDepositData() {
  const secret = randomBigInt();
  const nullifier = randomBigInt();
  const commitment = normalizeBigInt(poseidon2([secret, nullifier]));
  return { secret, nullifier, commitment };
}

function buildNoteObject({ secret, nullifier, commitment }) {
  return {
    id: crypto.randomUUID(),
    label: `Deposit ${new Date().toLocaleString()}`,
    createdAt: Date.now(),
    secret: secret.toString(),
    nullifier: nullifier.toString(),
    commitment: commitment.toString(),
    mixerAddress: MIXER_ADDRESS,
    chainId: sepolia.id,
    depositAmountEth: DEPOSIT_AMOUNT_ETH,
    noteVersion: 1
  };
}

/* =========================
   MERKLE / PROOF HELPERS
   ========================= */

function buildTreeFromDeposits(deposits) {
  const tree = new IncrementalMerkleTree(poseidon2, MERKLE_LEVELS, ZERO_VALUE, 2);
  for (const dep of deposits) {
    tree.insert(dep.commitment);
  }
  return tree;
}

function findCommitmentIndex(deposits, commitment) {
  const target = normalizeBigInt(commitment).toString();
  return deposits.findIndex((dep) => dep.commitment.toString() === target);
}

function parseNoteFromTextarea() {
  let parsed;
  try {
    parsed = JSON.parse(noteInput.value);
  } catch {
    throw new Error("Deposit note is not valid JSON.");
  }

  if (!parsed.secret || !parsed.nullifier || !parsed.commitment) {
    throw new Error("Deposit note is missing secret, nullifier, or commitment.");
  }

  return {
    ...parseJsonBigints(parsed),
    secret: normalizeBigInt(parsed.secret),
    nullifier: normalizeBigInt(parsed.nullifier),
    commitment: normalizeBigInt(parsed.commitment)
  };
}

function buildCircuitInputs({ note, merkleProof, recipient, nonce }) {
  const toField = addressToField(recipient);

  return {
    secret: note.secret.toString(),
    siblings: merkleProof.siblings.map((s) => {
      if (!Array.isArray(s) || s.length !== 1) {
        throw new Error("Unexpected sibling structure in Merkle proof.");
      }
      return normalizeBigInt(s[0]).toString();
    }),
    pathIndices: merkleProof.pathIndices.map((i) => Number(i)),
    nullifier: note.nullifier.toString(),
    nonce: nonce.toString(),
    to: toField.toString()
  };
}

function decodeProofStructForContract(proof, publicSignals) {
  return {
    a: [normalizeBigInt(proof.pi_a[0]), normalizeBigInt(proof.pi_a[1])],
    b: [
      [normalizeBigInt(proof.pi_b[0][1]), normalizeBigInt(proof.pi_b[0][0])],
      [normalizeBigInt(proof.pi_b[1][1]), normalizeBigInt(proof.pi_b[1][0])]
    ],
    c: [normalizeBigInt(proof.pi_c[0]), normalizeBigInt(proof.pi_c[1])],
    input: publicSignals.map((x) => normalizeBigInt(x))
  };
}

function encodeProofForContract(proof, publicSignals) {
  const proofStruct = decodeProofStructForContract(proof, publicSignals);

  return encodeAbiParameters(
    [
      { type: "uint256[2]" },
      { type: "uint256[2][2]" },
      { type: "uint256[2]" },
      { type: "uint256[5]" }
    ],
    [proofStruct.a, proofStruct.b, proofStruct.c, proofStruct.input]
  );
}

/* =========================
   ACTIONS
   ========================= */

async function handleGenerateDeposit() {
  try {
    const { secret, nullifier, commitment } = buildDepositData();

    lastGeneratedDeposit = { secret, nullifier, commitment };
    secretOutput.value = secret.toString();
    nullifierOutput.value = nullifier.toString();
    commitmentOutput.value = commitment.toString();

    setMessage("Generated a fresh secret, nullifier, and commitment.", "success");
  } catch (error) {
    setMessage(error.message || "Failed to generate deposit values.", "error");
  }
}

async function handleDeposit() {
  if (!isConnected || !currentAccount) {
    setMessage("Connect your wallet first.", "warn");
    return;
  }

  if (!lastGeneratedDeposit) {
    setMessage("Generate secret and nullifier first.", "warn");
    return;
  }

  try {
    setMessage("Submitting deposit transaction...");

    const hash = await walletClient.writeContract({
      account: currentAccount,
      address: getAddress(MIXER_ADDRESS),
      abi: MIXER_ABI,
      functionName: "deposit",
      args: [lastGeneratedDeposit.commitment],
      value: parseEther(DEPOSIT_AMOUNT_ETH),
      chain: sepolia
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    const note = buildNoteObject(lastGeneratedDeposit);

    if (saveLocalCheckbox.checked) {
      addNote(note);
    }

    noteInput.value = JSON.stringify(note, null, 2);

    setMessage(
      `Deposit confirmed. Tx: ${ETHERSCAN_BASE}/tx/${receipt.transactionHash}`,
      "success"
    );

    clearDepositForm();
    await refreshOnChainData();
  } catch (error) {
    setMessage(error.message || "Deposit failed.", "error");
  }
}

async function handleGenerateProof() {
  try {
    if (!noteInput.value.trim()) {
      throw new Error("Load or paste a deposit note first.");
    }

    const recipient = recipientInput.value.trim();
    if (!isAddress(recipient)) {
      throw new Error("Recipient address is invalid.");
    }

    let nonce;
    if (!withdrawNonceInput.value.trim()) {
      nonce = generateNonce();
      withdrawNonceInput.value = nonce.toString();
    } else {
      nonce = normalizeBigInt(withdrawNonceInput.value.trim());
    }

    setMessage("Refreshing deposits and rebuilding Merkle tree...");
    const deposits = await fetchDeposits();
    cachedDeposits = deposits;

    const note = parseNoteFromTextarea();
    const leafIndex = findCommitmentIndex(deposits, note.commitment);

    if (leafIndex === -1) {
      throw new Error("This commitment was not found in on-chain deposit events.");
    }

    const tree = buildTreeFromDeposits(deposits);
    const merkleProof = tree.createProof(leafIndex);

    const circuitInputs = buildCircuitInputs({
      note,
      merkleProof,
      recipient,
      nonce
    });

    setMessage("Generating zk proof in browser. This may take a bit...");

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInputs,
      WASM_PATH,
      ZKEY_PATH
    );

    await checkProofAgainstContract(publicSignals, recipient, nonce);

    const proofBytes = encodeProofForContract(proof, publicSignals);
    currentProofBytes = proofBytes;
    currentPublicSignals = publicSignals;
    proofOutput.value = proofBytes;

    setMessage("zk proof generated successfully.", "success");
  } catch (error) {
    setMessage(error.message || "Failed to generate proof.", "error");
  }
}

async function handleWithdraw() {
  if (!isConnected || !currentAccount) {
    setMessage("Connect your wallet first.", "warn");
    return;
  }

  try {
    const recipient = recipientInput.value.trim();
    if (!isAddress(recipient)) {
      throw new Error("Recipient address is invalid.");
    }

    const nonceRaw = withdrawNonceInput.value.trim();
    if (!nonceRaw) throw new Error("Withdrawal nonce is required.");
    const nonce = normalizeBigInt(nonceRaw);

    if (!currentProofBytes) {
      throw new Error("Generate the zk proof first.");
    }

    if (!currentPublicSignals) {
      throw new Error("Missing public signals. Generate the zk proof again.");
    }

    await checkProofAgainstContract(currentPublicSignals, recipient, nonce);

    setMessage("Submitting withdrawal transaction...");

    const hash = await walletClient.writeContract({
      account: currentAccount,
      address: getAddress(MIXER_ADDRESS),
      abi: MIXER_ABI,
      functionName: "withdraw",
      args: [currentProofBytes, getAddress(recipient), nonce],
      chain: sepolia
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    try {
      const usedNote = JSON.parse(noteInput.value);
      if (usedNote.id) {
        removeNote(usedNote.id);
      }
    } catch {
      // ignore if pasted note is not from local storage
    }

    clearWithdrawForm();

    setMessage(
      `Withdrawal confirmed. Tx: ${ETHERSCAN_BASE}/tx/${receipt.transactionHash}`,
      "success"
    );

    await refreshOnChainData();
  } catch (error) {
    setMessage(error.message || "Withdraw failed.", "error");
  }
}

/* =========================
   NOTES BUTTONS
   ========================= */

function handleLoadSelectedNote() {
  const noteId = savedNotesSelect.value;
  if (!noteId) {
    setMessage("Select a saved note first.", "warn");
    return;
  }

  const note = getNotes().find((n) => n.id === noteId);
  if (!note) {
    setMessage("Selected note not found.", "error");
    return;
  }

  noteInput.value = JSON.stringify(note, null, 2);
  withdrawNonceInput.value = generateNonce().toString();
  setMessage("Saved note loaded.", "success");
}

async function handleExportNotes() {
  const notes = getNotes();
  downloadTextFile("crypto-mixer-notes.json", JSON.stringify(notes, null, 2));
  setMessage("Notes exported.", "success");
}

function handleClearNotes() {
  localStorage.removeItem(NOTES_STORAGE_KEY);
  renderNotes();
  setMessage("All local notes cleared.", "success");
}

/* =========================
   EVENT LISTENERS
   ========================= */

connectButton.addEventListener("click", connectWallet);
refreshButton.addEventListener("click", refreshOnChainData);

generateDepositButton.addEventListener("click", handleGenerateDeposit);
depositButton.addEventListener("click", handleDeposit);

generateProofButton.addEventListener("click", handleGenerateProof);
withdrawButton.addEventListener("click", handleWithdraw);

loadSelectedNoteButton.addEventListener("click", handleLoadSelectedNote);
reloadNotesButton.addEventListener("click", renderNotes);
exportNotesButton.addEventListener("click", handleExportNotes);
clearNotesButton.addEventListener("click", handleClearNotes);

/* =========================
   INIT
   ========================= */

function init() {
  contractLink.href = `${ETHERSCAN_BASE}/address/${MIXER_ADDRESS}`;
  contractLink.textContent = MIXER_ADDRESS;
  networkName.textContent = sepolia.name;
  renderNotes();
}

init();