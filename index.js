/* eslint-disable no-unused-vars */
const { EventEmitter } = require('events');
const ethUtil = require('ethereumjs-util');
const HDKey = require('hdkey');

const PROKEY_LINK_URL = 'http://localhost:4200';

const hdPathString = `m/44'/1'/0'/0`;
const keyringType = 'Prokey Hardware';
const pathBase = 'm';
const MAX_INDEX = 1000;

const {
  concatSig,
  decrypt,
  getEncryptionPublicKey,
  normalize,
  personalSign,
  signTypedData,
  SignTypedDataVersion,
} = require('@metamask/eth-sig-util');

const CommandType = {
  GetEthereumPublicKey: 'GetEthereumPublicKey',
  GetAddress: 'GetAddress',
  SignTransaction: 'SignTransaction',
  SignMessage: 'SignMessage',
  GetAddresses: 'GetAddresses',
};

class ProkeyKeyring extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.type = keyringType;
    this._wallets = [];
    this.accounts = [];
    this.hdk = new HDKey();
    this.page = 0;
    this.perPage = 5;
    this.unlockedAccount = 0;
    this.paths = {};
    this.deserialize(opts);
  }

  handleMessage(e, resolve) {
    if (e.origin.startsWith(PROKEY_LINK_URL)) {
      window.removeEventListener('message', this.handleMessage);
      resolve(e.data);
    }
  }

  runCommandOnProkeyLink(param, type) {
    return new Promise((resolve) => {
      const popup = window.open(PROKEY_LINK_URL);
      setTimeout(() => {
        popup.postMessage({ param, type }, PROKEY_LINK_URL);
      }, 2000);

      window.addEventListener(
        'message',
        (e) => this.handleMessage(e, resolve),
        false,
      );
    });
  }

  getFirstPage() {
    this.page = 0;
    return this.__getPage(1);
  }

  getNextPage() {
    return this.__getPage(1);
  }

  getPreviousPage() {
    return this.__getPage(-1);
  }

  // eslint-disable-next-line no-shadow
  _addressFromIndex(pathBase, i) {
    const dkey = this.hdKey.derive(`${pathBase}/${i}`);
    const address = ethUtil
      .publicToAddress(dkey.publicKey, true)
      .toString('hex');
    return ethUtil.toChecksumAddress(`0x${address}`);
  }

  __getPage(increment) {
    this.page += increment;

    if (this.page <= 0) {
      this.page = 1;
    }

    return new Promise((resolve, reject) => {
      this.unlock()
        .then((_) => {
          const from = (this.page - 1) * this.perPage;
          const to = from + this.perPage;

          const accounts = [];

          for (let i = from; i < to; i++) {
            const address = this._addressFromIndex(pathBase, i);
            accounts.push({
              address,
              balance: null,
              index: i,
            });
            this.paths[ethUtil.toChecksumAddress(address)] = i;
          }
          resolve(accounts);
        })
        .catch((e) => {
          reject(e);
        });
    });
  }

  isUnlocked() {
    return Boolean(this.hdKey && this.hdKey.publicKey);
  }

  unlock() {
    if (this.isUnlocked()) {
      return Promise.resolve('already unlocked');
    }
    return new Promise((resolve, reject) => {
      this.runCommandOnProkeyLink(
        { path: this.hdPath },
        CommandType.GetEthereumPublicKey,
      )
        .then((response) => {
          this.hdKey = HDKey.fromExtendedKey(response.xpub);
          resolve('just unlocked');
        })
        .catch((e) => {
          reject(new Error((e && e.toString()) || 'Unknown error'));
        });
    });
  }

  setAccountToUnlock(index) {
    this.unlockedAccount = parseInt(index, 10);
  }

  serialize() {
    return Promise.resolve({
      hdPath: this.hdPath,
      accounts: this.accounts,
      page: this.page,
      paths: this.paths,
      perPage: this.perPage,
      unlockedAccount: this.unlockedAccount,
    });
  }

  async deserialize(opts = {}) {
    this.hdPath = opts.hdPath || hdPathString;
    this.accounts = opts.accounts || [];
    this.page = opts.page || 0;
    this.perPage = opts.perPage || 5;
    return Promise.resolve();
  }

  addAccounts(n = 1) {
    return new Promise((resolve, reject) => {
      this.unlock()
        .then((_) => {
          const from = this.unlockedAccount;
          const to = from + n;

          for (let i = from; i < to; i++) {
            const address = this._addressFromIndex(pathBase, i);
            if (!this.accounts.includes(address)) {
              this.accounts.push(address);
            }
            this.page = 0;
          }
          resolve(this.accounts);
        })
        .catch((e) => {
          reject(e);
        });
    });
  }

  getAccounts() {
    return Promise.resolve(this.accounts.slice());
  }

  // tx is an instance of the ethereumjs-transaction class.
  async signTransaction(address, tx, opts = {}) {
    const privKey = this._getPrivateKeyFor(address, opts);
    const signedTx = tx.sign(privKey);
    // Newer versions of Ethereumjs-tx are immutable and return a new tx object
    return signedTx === undefined ? tx : signedTx;
  }

  // For eth_sign, we need to sign arbitrary data:
  async signMessage(address, data, opts = {}) {
    const message = ethUtil.stripHexPrefix(data);
    const privKey = this._getPrivateKeyFor(address, opts);
    const msgSig = ethUtil.ecsign(Buffer.from(message, 'hex'), privKey);
    const rawMsgSig = concatSig(msgSig.v, msgSig.r, msgSig.s);
    return rawMsgSig;
  }

  // For personal_sign, we need to prefix the message:
  async signPersonalMessage(address, msgHex, opts = {}) {
    const privKey = this._getPrivateKeyFor(address, opts);
    const privateKey = Buffer.from(privKey, 'hex');
    const sig = personalSign({ privateKey, data: msgHex });
    return sig;
  }

  // For eth_decryptMessage:
  async decryptMessage(withAccount, encryptedData) {
    const wallet = this._getWalletForAccount(withAccount);
    const privateKey = ethUtil.stripHexPrefix(wallet.privateKey);
    const sig = decrypt({ privateKey, encryptedData });
    return sig;
  }

  // personal_signTypedData, signs data along with the schema
  async signTypedData(
    withAccount,
    typedData,
    opts = { version: SignTypedDataVersion.V1 },
  ) {
    // Treat invalid versions as "V1"
    const version = Object.keys(SignTypedDataVersion).includes(opts.version)
      ? opts.version
      : SignTypedDataVersion.V1;

    const privateKey = this._getPrivateKeyFor(withAccount, opts);
    return signTypedData({ privateKey, data: typedData, version });
  }

  // get public key for nacl
  async getEncryptionPublicKey(withAccount, opts = {}) {
    const privKey = this._getPrivateKeyFor(withAccount, opts);
    const publicKey = getEncryptionPublicKey(privKey);
    return publicKey;
  }

  _getPrivateKeyFor(address, opts = {}) {
    if (!address) {
      throw new Error('Must specify address.');
    }
    const wallet = this._getWalletForAccount(address, opts);
    return wallet.privateKey;
  }

  // returns an address specific to an app
  async getAppKeyAddress(address, org) {
    if (!org || typeof org !== 'string') {
      throw new Error(`'origin' must be a non-empty string`);
    }
    const wallet = this._getWalletForAccount(address, {
      withAppKeyOrigin: org,
    });
    const appKeyAddress = normalize(
      ethUtil.publicToAddress(wallet.publicKey).toString('hex'),
    );
    return appKeyAddress;
  }

  // exportAccount should return a hex-encoded private key:
  async exportAccount(address, opts = {}) {
    const wallet = this._getWalletForAccount(address, opts);
    return wallet.privateKey.toString('hex');
  }

  removeAccount(address) {
    if (
      !this._wallets
        .map(({ publicKey }) =>
          ethUtil.bufferToHex(ethUtil.publicToAddress(publicKey)).toLowerCase(),
        )
        .includes(address.toLowerCase())
    ) {
      throw new Error(`Address ${address} not found in this keyring`);
    }

    this._wallets = this._wallets.filter(
      ({ publicKey }) =>
        ethUtil
          .bufferToHex(ethUtil.publicToAddress(publicKey))
          .toLowerCase() !== address.toLowerCase(),
    );
  }

  _getWalletForAccount(account, opts = {}) {
    const address = normalize(account);
    let wallet = this._wallets.find(
      ({ publicKey }) =>
        ethUtil.bufferToHex(ethUtil.publicToAddress(publicKey)) === address,
    );
    if (!wallet) {
      throw new Error('Simple Keyring - Unable to find matching address.');
    }

    if (opts.withAppKeyOrigin) {
      const { privateKey } = wallet;
      const appKeyOriginBuffer = Buffer.from(opts.withAppKeyOrigin, 'utf8');
      const appKeyBuffer = Buffer.concat([privateKey, appKeyOriginBuffer]);
      const appKeyPrivateKey = ethUtil.keccak(appKeyBuffer, 256);
      const appKeyPublicKey = ethUtil.privateToPublic(appKeyPrivateKey);
      wallet = { privateKey: appKeyPrivateKey, publicKey: appKeyPublicKey };
    }

    return wallet;
  }
}

ProkeyKeyring.type = keyringType;
module.exports = ProkeyKeyring;
