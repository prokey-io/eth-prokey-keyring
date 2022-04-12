/* eslint-disable no-unused-vars */
const { EventEmitter } = require('events');
const ethUtil = require('ethereumjs-util');
const { TransactionFactory } = require('@ethereumjs/tx');
const HDKey = require('hdkey');

const PROKEY_LINK_URL = 'http://localhost:4200';

const hdPathString = `m/44'/60'/0'/0`;
const keyringType = 'Prokey Hardware';
const pathBase = 'm';
const MAX_INDEX = 1000;
const DELAY_BETWEEN_POPUPS = 2000;

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

// eslint-disable-next-line jsdoc/require-jsdoc
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ProkeyKeyring extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.type = keyringType;
    this._wallets = [];
    this.accounts = [];
    this.hdKey = new HDKey();
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

  _pathFromAddress(address) {
    const checksummedAddress = ethUtil.toChecksumAddress(address);
    let index = this.paths[checksummedAddress];
    if (typeof index === 'undefined') {
      for (let i = 0; i < MAX_INDEX; i++) {
        if (checksummedAddress === this._addressFromIndex(pathBase, i)) {
          index = i;
          break;
        }
      }
    }

    if (typeof index === 'undefined') {
      throw new Error('Unknown address');
    }
    return `${this.hdPath}/${index}`;
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

  forgetDevice() {
    this.accounts = [];
    this.hdk = new HDKey();
    this.page = 0;
    this.unlockedAccount = 0;
    this.paths = {};
  }

  removeAccount(address) {
    if (
      !this.accounts.map((a) => a.toLowerCase()).includes(address.toLowerCase())
    ) {
      throw new Error(`Address ${address} not found in this keyring`);
    }

    this.accounts = this.accounts.filter(
      (a) => a.toLowerCase() !== address.toLowerCase(),
    );
  }

  // tx is an instance of the ethereumjs-transaction class.
  signTransaction(address, tx) {
    // transactions built with older versions of ethereumjs-tx have a
    // getChainId method that newer versions do not. Older versions are mutable
    // while newer versions default to being immutable. Expected shape and type
    // of data for v, r and s differ (Buffer (old) vs BN (new))
    if (typeof tx.getChainId === 'function') {
      // In this version of ethereumjs-tx we must add the chainId in hex format
      // to the initial v value. The chainId must be included in the serialized
      // transaction which is only communicated to ethereumjs-tx in this
      // value. In newer versions the chainId is communicated via the 'Common'
      // object.
      return this._signTransaction(address, tx.getChainId(), tx, (payload) => {
        tx.v = payload.v;
        tx.r = payload.r;
        tx.s = payload.s;
        return tx;
      });
    }
    // For transactions created by newer versions of @ethereumjs/tx
    // Note: https://github.com/ethereumjs/ethereumjs-monorepo/issues/1188
    // It is not strictly necessary to do this additional setting of the v
    // value. We should be able to get the correct v value in serialization
    // if the above issue is resolved. Until then this must be set before
    // calling .serialize(). Note we are creating a temporarily mutable object
    // forfeiting the benefit of immutability until this happens. We do still
    // return a Transaction that is frozen if the originally provided
    // transaction was also frozen.
    const unfrozenTx = TransactionFactory.fromTxData(tx.toJSON(), {
      common: tx.common,
      freeze: false,
    });
    unfrozenTx.v = new ethUtil.BN(
      ethUtil.addHexPrefix(tx.common.chainId()),
      'hex',
    );
    return this._signTransaction(
      address,
      tx.common.chainIdBN().toNumber(),
      unfrozenTx,
      (payload) => {
        // Because tx will be immutable, first get a plain javascript object that
        // represents the transaction. Using txData here as it aligns with the
        // nomenclature of ethereumjs/tx.
        const txData = tx.toJSON();
        // The fromTxData utility expects v,r and s to be hex prefixed
        txData.v = ethUtil.addHexPrefix(payload.v);
        txData.r = ethUtil.addHexPrefix(payload.r);
        txData.s = ethUtil.addHexPrefix(payload.s);
        // Adopt the 'common' option from the original transaction and set the
        // returned object to be frozen if the original is frozen.
        const a = TransactionFactory.fromTxData(txData, {
          common: tx.common,
          freeze: Object.isFrozen(tx),
        });
        return a;
      },
    );
  }

  // tx is an instance of the ethereumjs-transaction class.
  async _signTransaction(address, chainId, tx, handleSigning) {
    try {
      const deviceStatus = await this.unlock();
      await wait(deviceStatus === 'just unlocked' ? DELAY_BETWEEN_POPUPS : 0);
      const txParams = {
        path: this._pathFromAddress(address),
        transaction: {
          to: this._normalize(tx.to),
          value: this._normalize(tx.value),
          gasPrice: this._normalize(tx.gasPrice),
          gasLimit: this._normalize(tx.gasLimit),
          nonce: this._normalize(tx.nonce),
          data: this._normalize(tx.data),
          chainId,
        },
      };
      const response = await this.runCommandOnProkeyLink(
        txParams,
        CommandType.SignTransaction,
      );
      const newOrMutatedTx = handleSigning(response);

      const addressSignedWith = ethUtil.toChecksumAddress(
        ethUtil.addHexPrefix(newOrMutatedTx.getSenderAddress().toString('hex')),
      );
      const correctAddress = ethUtil.toChecksumAddress(address);
      if (addressSignedWith !== correctAddress) {
        throw new Error("signature doesn't match the right address");
      }

      return newOrMutatedTx;
    } catch (e) {
      throw new Error((e && e.toString()) || 'Unknown error');
    }
  }

  _normalize(buf) {
    return ethUtil.bufferToHex(buf).toString();
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

  signTypedData() {
    return Promise.reject(new Error('Not supported on this device'));
  }

  exportAccount() {
    return Promise.reject(new Error('Not supported on this device'));
  }
}

ProkeyKeyring.type = keyringType;
module.exports = ProkeyKeyring;
