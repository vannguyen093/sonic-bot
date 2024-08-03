const fs = require('fs');
require('colors');
const solana = require('@solana/web3.js');
const axios = require('axios').default;
const base58 = require('bs58');
const nacl = require('tweetnacl');
const { connection } = require('./src/solanaUtils');
const { HEADERS } = require('./src/headers');
const { displayHeader } = require('./src/displayUtils');
const readlineSync = require('readline-sync');
const moment = require('moment');
const HttpsProxyAgent = require('https-proxy-agent');

const PRIVATE_KEYS = JSON.parse(fs.readFileSync('privateKeys.json', 'utf-8'));

function readProxies() {
  const proxyFile = fs.readFileSync('proxy.txt', 'utf-8');
  return proxyFile.split('\n').filter(line => line.trim() !== '');
}

function getRandomProxy(proxies) {
  return proxies[Math.floor(Math.random() * proxies.length)];
}

function formatProxyUrl(proxy) {
  const [auth, ipPort] = proxy.split('@');
  if (!auth || !ipPort) {
    console.error('Invalid proxy format:', proxy);
    return null;
  }
  const [username, password] = auth.split(':');
  const [ip, port] = ipPort.split(':');
  if (!username || !password || !ip || !port) {
    console.error('Invalid proxy format:', proxy);
    return null;
  }
  return `http://${username}:${password}@${ip}:${port}`;
}

function createAxiosInstance(proxyUrl) {
  return axios.create({
    httpsAgent: new HttpsProxyAgent(proxyUrl),
    proxy: false,
  });
}

function getKeypair(privateKey) {
  const decodedPrivateKey = base58.decode(privateKey);
  return solana.Keypair.fromSecretKey(decodedPrivateKey);
}

async function getToken(privateKey, axiosInstance) {
  try {
    const { data } = await axiosInstance({
      url: 'https://odyssey-api-beta.sonic.game/auth/sonic/challenge',
      params: {
        wallet: getKeypair(privateKey).publicKey,
      },
      headers: HEADERS,
    });

    const sign = nacl.sign.detached(
      Buffer.from(data.data),
      getKeypair(privateKey).secretKey
    );
    const signature = Buffer.from(sign).toString('base64');
    const publicKey = getKeypair(privateKey).publicKey;
    const encodedPublicKey = Buffer.from(publicKey.toBytes()).toString(
      'base64'
    );
    const response = await axiosInstance({
      url: 'https://odyssey-api-beta.sonic.game/auth/sonic/authorize',
      method: 'POST',
      headers: HEADERS,
      data: {
        address: publicKey,
        address_encoded: encodedPublicKey,
        signature,
      },
    });

    return response.data.data.token;
  } catch (error) {
    console.log(`Error fetching token: ${error}`.red);
  }
}

async function getProfile(token, axiosInstance) {
  try {
    const { data } = await axiosInstance({
      url: 'https://odyssey-api-beta.sonic.game/user/rewards/info',
      method: 'GET',
      headers: { ...HEADERS, Authorization: token },
    });

    return data.data;
  } catch (error) {
    console.log(`Error fetching profile: ${error}`.red);
  }
}

async function doTransactions(tx, keypair, retries = 3) {
  try {
    const bufferTransaction = tx.serialize();
    const signature = await connection.sendRawTransaction(bufferTransaction);
    await connection.confirmTransaction(signature);
    return signature;
  } catch (error) {
    if (retries > 0) {
      console.log(`Retrying transaction... (${retries} retries left)`.yellow);
      await new Promise((res) => setTimeout(res, 1000));
      return doTransactions(tx, keypair, retries - 1);
    } else {
      console.log(`Error in transaction: ${error}`.red);
      throw error;
    }
  }
}

async function openMysteryBox(token, keypair, axiosInstance, accountIndex, retries = 3) {
  try {
    const { data } = await axiosInstance({
      url: 'https://odyssey-api-beta.sonic.game/user/rewards/mystery-box/build-tx',
      method: 'GET',
      headers: { ...HEADERS, Authorization: token },
    });

    const txBuffer = Buffer.from(data.data.hash, 'base64');
    const tx = solana.Transaction.from(txBuffer);
    tx.partialSign(keypair);
    const signature = await doTransactions(tx, keypair);
    const response = await axiosInstance({
      url: 'https://odyssey-api-beta.sonic.game/user/rewards/mystery-box/open',
      method: 'POST',
      headers: { ...HEADERS, Authorization: token },
      data: {
        hash: signature,
      },
    });

    return response.data;
  } catch (error) {
    if (retries > 0) {
      console.log(
        `[Account ${accountIndex}] Retrying opening mystery box... (${retries} retries left)`.yellow
      );
      await new Promise((res) => setTimeout(res, 1000));
      return openMysteryBox(token, keypair, axiosInstance, accountIndex, retries - 1);
    } else {
      console.log(`[Account ${accountIndex}] Error opening mystery box: ${error}`.red);
      throw error;
    }
  }
}

async function processPrivateKey(privateKey, method, totalClaim, axiosInstance, accountIndex) {
  try {
    const publicKey = getKeypair(privateKey).publicKey.toBase58();
    const token = await getToken(privateKey, axiosInstance);
    const profile = await getProfile(token, axiosInstance);

    if (profile.wallet_balance > 0) {
      const balance = profile.wallet_balance / solana.LAMPORTS_PER_SOL;
      const ringBalance = profile.ring;
      const availableBoxes = profile.ring_monitor;
      console.log(
        `[Account ${accountIndex}] Hello ${publicKey}! Welcome to our bot. Here are your details:`.green
      );
      console.log(`[Account ${accountIndex}] Solana Balance: ${balance} SOL`.green);
      console.log(`[Account ${accountIndex}] Ring Balance: ${ringBalance}`.green);
      console.log(`[Account ${accountIndex}] Available Box(es): ${availableBoxes}`.green);
      console.log('');

      if (method === '1') {
        console.log(`[Account ${accountIndex}] [ ${moment().format('HH:mm:ss')} ] Please wait...`.yellow);
        await dailyClaim(token, axiosInstance, accountIndex);
        console.log(
          `[Account ${accountIndex}] [ ${moment().format('HH:mm:ss')} ] All tasks completed!`.cyan
        );
      } else if (method === '2') {
        if (totalClaim > availableBoxes) {
          console.log(`[Account ${accountIndex}] You cannot open more boxes than available (${availableBoxes})`.red);
          totalClaim = availableBoxes;
        }
        console.log(
          `[Account ${accountIndex}] [ ${moment().format('HH:mm:ss')} ] Please wait...`.yellow
        );
        for (let i = 0; i < totalClaim; i++) {
          const openedBox = await openMysteryBox(
            token,
            getKeypair(privateKey),
            axiosInstance,
            accountIndex
          );
          if (openedBox.data.success) {
            console.log(
              `[Account ${accountIndex}] [ ${moment().format(
                'HH:mm:ss'
              )} ] Box opened successfully! Status: ${
                openedBox.status
              } | Amount: ${openedBox.data.amount}`.green
            );
          }
        }
        console.log(
          `[Account ${accountIndex}] [ ${moment().format('HH:mm:ss')} ] All tasks completed!`.cyan
        );
      } else if (method === '3') {
        console.log(`[Account ${accountIndex}] [ ${moment().format('HH:mm:ss')} ] Please wait...`.yellow);
        const claimLogin = await dailyLogin(token, getKeypair(privateKey), axiosInstance, accountIndex);
        if (claimLogin) {
          console.log(
            `[Account ${accountIndex}] [ ${moment().format(
              'HH:mm:ss'
            )} ] Daily login has been success! Status: ${
              claimLogin.status
            } | Accumulative Days: ${claimLogin.data.accumulative_days}`.green
          );
        }
        console.log(
          `[Account ${accountIndex}] [ ${moment().format('HH:mm:ss')} ] All tasks completed!`.cyan
        );
      }
    } else {
      console.log(
        `[Account ${accountIndex}] There might be errors if you don't have sufficient balance or the RPC is down. Please ensure your balance is sufficient and your connection is stable`
          .red
      );
    }
  } catch (error) {
    console.log(`[Account ${accountIndex}] Error processing private key: ${error}`.red);
  }
  console.log('');
}

async function dailyClaim(token, axiosInstance, accountIndex) {
  let counter = 1;
  let maxCounter = 3;

  while (counter <= maxCounter) {
    try {
      const { data } = await axiosInstance({
        url: 'https://odyssey-api.sonic.game/user/transactions/rewards/claim',
        method: 'POST',
        headers: { ...HEADERS, Authorization: token },
        data: {
          stage: counter,
        },
      });

      console.log(
        `[Account ${accountIndex}] [ ${moment().format(
          'HH:mm:ss'
        )} ] Daily claim for stage ${counter} has been successful! Stage: ${counter} | Status: ${
          data.data.claimed
        }`
      );

      counter++;
    } catch (error) {
      if (error.response.data.message === 'interact task not finished') {
        console.log(
          `[Account ${accountIndex}] [ ${moment().format(
            'HH:mm:ss'
          )} ] Error claiming for stage ${counter}: ${
            error.response.data.message
          }`.red
        );
        counter++;
      } else if (
        error.response &&
        (error.response.data.code === 100015 ||
          error.response.data.code === 100016)
      ) {
        console.log(
          `[Account ${accountIndex}] [ ${moment().format(
            'HH:mm:ss'
          )} ] Already claimed for stage ${counter}, proceeding to the next stage...`
            .cyan
        );
        counter++;
      } else {
        console.log(
          `[Account ${accountIndex}] [ ${moment().format('HH:mm:ss')} ] Error claiming: ${
            error.response.data.message
          }`.red
        );
      }
    }
  }

  console.log(`[Account ${accountIndex}] All stages processed or max stage reached.`.green);
}

async function dailyLogin(token, keypair, axiosInstance, accountIndex, retries = 3) {
  try {
    const { data } = await axiosInstance({
      url: 'https://odyssey-api-beta.sonic.game/user/check-in/transaction',
      method: 'GET',
      headers: { ...HEADERS, Authorization: token },
    });

    const txBuffer = Buffer.from(data.data.hash, 'base64');
    const tx = solana.Transaction.from(txBuffer);
    tx.partialSign(keypair);
    const signature = await doTransactions(tx, keypair);

    const response = await axiosInstance({
      url: 'https://odyssey-api-beta.sonic.game/user/check-in',
      method: 'POST',
      headers: { ...HEADERS, Authorization: token },
      data: {
        hash: signature,
      },
    });

    return response.data;
  } catch (error) {
    if (error.response.data.message === 'current account already checked in') {
      console.log(
        `[Account ${accountIndex}] [ ${moment().format('HH:mm:ss')} ] Error in daily login: ${
          error.response.data.message
        }`.red
      );
    } else {
      console.log(
        `[Account ${accountIndex}] [ ${moment().format('HH:mm:ss')} ] Error claiming: ${
          error.response.data.message
        }`.red
      );
    }
  }
}

(async () => {
  try {
    displayHeader();
    const proxies = readProxies();
    
    const method = readlineSync.question(
      'Select input method (1 for claim box, 2 for open box, 3 for daily login): '
    );

    let totalClaim;
    if (method === '2') {
      totalClaim = parseInt(readlineSync.question(
        `How many boxes do you want to open for each account?: `.blue
      ));
      if (isNaN(totalClaim) || totalClaim <= 0) {
        throw new Error('Invalid number of boxes specified'.red);
      }
    }

    for (let i = 0; i < PRIVATE_KEYS.length; i++) {
      const privateKey = PRIVATE_KEYS[i];
      const proxy = getRandomProxy(proxies);
      const proxyUrl = formatProxyUrl(proxy);
      console.log(`[Account ${i + 1}] Using proxy: ${proxy}`.cyan);
      const axiosInstance = createAxiosInstance(proxyUrl);
      await processPrivateKey(privateKey, method, totalClaim, axiosInstance, i + 1);
    }
    console.log('All private keys processed.'.cyan);
  } catch (error) {
    console.log(`Error in bot operation: ${error}`.red);
  } finally {
    console.log(
      'Thanks for having us! Subscribe: https://t.me/HappyCuanAirdrop'.magenta
    );
  }
})();