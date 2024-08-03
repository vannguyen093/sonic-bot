const fs = require('fs');
const readlineSync = require('readline-sync');
const colors = require('colors');
const HttpsProxyAgent = require('https-proxy-agent').HttpsProxyAgent;

const {
  sendSol,
  generateRandomAddresses,
  getKeypairFromSeed,
  getKeypairFromPrivateKey,
  PublicKey,
  createConnection,
  LAMPORTS_PER_SOL,
  delay,
} = require('./src/solanaUtils');

const { displayHeader } = require('./src/displayUtils');

function readProxies() {
  const proxyFile = fs.readFileSync('proxy.txt', 'utf-8');
  return proxyFile
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '');
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
  return `https://${username}:${password}@${ip}:${port}`;
}

(async () => {
  displayHeader();
  const proxies = readProxies();
  
  const method = readlineSync.question(
    'Select input method (0 for seed phrase, 1 for private key): '
  );

  let seedPhrasesOrKeys;
  if (method === '0') {
    seedPhrasesOrKeys = JSON.parse(fs.readFileSync('accounts.json', 'utf-8'));
    if (!Array.isArray(seedPhrasesOrKeys) || seedPhrasesOrKeys.length === 0) {
      throw new Error(
        colors.red('accounts.json is not set correctly or is empty')
      );
    }
  } else if (method === '1') {
    seedPhrasesOrKeys = JSON.parse(
      fs.readFileSync('privateKeys.json', 'utf-8')
    );
    if (!Array.isArray(seedPhrasesOrKeys) || seedPhrasesOrKeys.length === 0) {
      throw new Error(
        colors.red('privateKeys.json is not set correctly or is empty')
      );
    }
  } else {
    throw new Error(colors.red('Invalid input method selected'));
  }

  const defaultAddressCount = 100;
  const addressCountInput = readlineSync.question(
    `How many random addresses do you want to generate? (default is ${defaultAddressCount}): `
  );
  const addressCount = addressCountInput
    ? parseInt(addressCountInput, 10)
    : defaultAddressCount;

  if (isNaN(addressCount) || addressCount <= 0) {
    throw new Error(colors.red('Invalid number of addresses specified'));
  }

  const randomAddresses = generateRandomAddresses(addressCount);

  let rentExemptionAmount;
  try {
    const connection = createConnection();
    rentExemptionAmount =
      (await connection.getMinimumBalanceForRentExemption(0)) /
      LAMPORTS_PER_SOL;
    console.log(
      colors.yellow(
        `Minimum balance required for rent exemption: ${rentExemptionAmount} SOL`
      )
    );
  } catch (error) {
    console.error(
      colors.red(
        'Failed to fetch minimum balance for rent exemption. Using default value.'
      )
    );
    rentExemptionAmount = 0.001;
  }

  let amountToSend;
  do {
    const amountInput = readlineSync.question(
      'Enter the amount of SOL to send (default is 0.001 SOL): '
    );
    amountToSend = amountInput ? parseFloat(amountInput) : 0.001;

    if (isNaN(amountToSend) || amountToSend < rentExemptionAmount) {
      console.log(
        colors.red(
          `Invalid amount specified. The amount must be at least ${rentExemptionAmount} SOL to avoid rent issues.`
        )
      );
      console.log(
        colors.yellow(
          `Suggested amount to send: ${Math.max(
            0.001,
            rentExemptionAmount
          )} SOL`
        )
      );
    }
  } while (isNaN(amountToSend) || amountToSend < rentExemptionAmount);

  const defaultDelay = 1000;
  const delayInput = readlineSync.question(
    `Enter the delay between transactions in milliseconds (default is ${defaultDelay}ms): `
  );
  const delayBetweenTx = delayInput ? parseInt(delayInput, 10) : defaultDelay;

  if (isNaN(delayBetweenTx) || delayBetweenTx < 0) {
    throw new Error(colors.red('Invalid delay specified'));
  }

  for (const [index, seedOrKey] of seedPhrasesOrKeys.entries()) {
    let fromKeypair;
    if (method === '0') {
      fromKeypair = await getKeypairFromSeed(seedOrKey);
    } else {
      fromKeypair = getKeypairFromPrivateKey(seedOrKey);
    }
    console.log(
      colors.yellow(
        `Sending SOL from account ${
          index + 1
        }: ${fromKeypair.publicKey.toString()}`
      )
    );

    const proxy = getRandomProxy(proxies);
const proxyUrl = formatProxyUrl(proxy);
if (proxyUrl) {
  console.log(colors.cyan(`Using proxy: ${proxy}`));
  // Sử dụng proxyUrl trong các hàm khác
} else {
  console.log(colors.red(`Skipping invalid proxy: ${proxy}`));
  continue; // Bỏ qua proxy này và chuyển sang proxy tiếp theo
}

    for (const address of randomAddresses) {
      const toPublicKey = new PublicKey(address);
      try {
        await sendSol(fromKeypair, toPublicKey, amountToSend, proxyUrl);
        console.log(
          colors.green(`Successfully sent ${amountToSend} SOL to ${address}`)
        );
      } catch (error) {
        console.error(colors.red(`Failed to send SOL to ${address}:`), error);
      }
      await delay(delayBetweenTx);
    }
  }
})();