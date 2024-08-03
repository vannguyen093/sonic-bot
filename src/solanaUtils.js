const {
  Connection,
  LAMPORTS_PER_SOL,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  PublicKey,
  Keypair,
} = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const base58 = require('bs58');
const colors = require('colors');
const { HttpsProxyAgent } = require('https-proxy-agent');
const https = require('https');

const DEVNET_URL = 'https://devnet.sonic.game/';

function createConnection(proxyUrl = null) {
  const connectionConfig = {
    commitment: 'confirmed',
  };

  if (proxyUrl) {
    try {
      const httpsAgent = new HttpsProxyAgent(proxyUrl);
      connectionConfig.httpAgent = new https.Agent({ keepAlive: true });
      connectionConfig.httpsAgent = httpsAgent;
      connectionConfig.wsAgent = httpsAgent;
    } catch (error) {
      console.error('Error creating proxy agent:', error);
    }
  }

  return new Connection(DEVNET_URL, connectionConfig);
}

async function sendSol(fromKeypair, toPublicKey, amount, proxyUrl = null) {
  console.log('Creating connection with proxy URL:', proxyUrl);
  const connection = createConnection(proxyUrl);
  console.log('Connection created successfully');
  
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: fromKeypair.publicKey,
      toPubkey: toPublicKey,
      lamports: amount * LAMPORTS_PER_SOL,
    })
  );
  
  console.log('Sending and confirming transaction...');
  const signature = await sendAndConfirmTransaction(connection, transaction, [
    fromKeypair,
  ]);
  console.log(colors.green('Transaction confirmed with signature:'), signature);
}

function generateRandomAddresses(count) {
  return Array.from({ length: count }, () =>
    Keypair.generate().publicKey.toString()
  );
}

async function getKeypairFromSeed(seedPhrase) {
  const seed = await bip39.mnemonicToSeed(seedPhrase);
  const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
  return Keypair.fromSeed(derivedSeed.slice(0, 32));
}

function getKeypairFromPrivateKey(privateKey) {
  return Keypair.fromSecretKey(base58.decode(privateKey));
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  sendSol,
  generateRandomAddresses,
  getKeypairFromSeed,
  getKeypairFromPrivateKey,
  DEVNET_URL,
  createConnection,
  PublicKey,
  LAMPORTS_PER_SOL,
  delay,
};