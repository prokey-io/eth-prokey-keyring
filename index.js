const { EventEmitter } = require('events');
const ethUtil = require('ethereumjs-util');
const { TransactionFactory } = require('@ethereumjs/tx');
const HDKey = require('hdkey');

const isProduction = true;
const PROKEY_LINK_URL = isProduction
  ? 'https://link.prokey.io'
  : 'http://localhost:4200';

const hdPathString = `m/44'/60'/0'/0`;
const keyringType = 'Prokey Hardware';
const pathBase = 'm';
const MAX_INDEX = 1000;
const DELAY_BETWEEN_POPUPS = 2000;

const CommandType = {
  GetEthereumPublicKey: 'GetEthereumPublicKey',
  SignTransaction: 'SignTransaction',
  SignMessage: 'SignMessage',
};

// eslint-disable-next-line jsdoc/require-jsdoc
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// eslint-disable-next-line jsdoc/require-jsdoc
function isOldStyleEthereumjsTx(tx) {
  return typeof tx.getChainId === 'function';
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
    if (isOldStyleEthereumjsTx(tx)) {
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
    return this._signTransaction(
      address,
      tx.common.chainIdBN().toNumber(),
      tx,
      (payload) => {
        // Because tx will be immutable, first get a plain javascript object that
        // represents the transaction. Using txData here as it aligns with the
        // nomenclature of ethereumjs/tx.
        const txData = tx.toJSON();
        // The fromTxData utility expects a type to support transactions with a type other than 0
        txData.type = tx.type;
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
    let transaction;
    if (isOldStyleEthereumjsTx(tx)) {
      // legacy transaction from ethereumjs-tx package has no .toJSON() function,
      // so we need to convert to hex-strings manually manually
      transaction = {
        to: this._normalize(tx.to),
        value: this._normalize(tx.value),
        data: this._normalize(tx.data),
        chainId,
        nonce: this._normalize(tx.nonce),
        gasLimit: this._normalize(tx.gasLimit),
        gasPrice: this._normalize(tx.gasPrice),
      };
    } else {
      // new-style transaction from @ethereumjs/tx package
      // we can just copy tx.toJSON() for everything except chainId, which must be a number
      transaction = {
        ...tx.toJSON(),
        chainId,
        to: this._normalize(tx.to),
      };
    }

    try {
      const deviceStatus = await this.unlock();
      await wait(deviceStatus === 'just unlocked' ? DELAY_BETWEEN_POPUPS : 0);
      const txParams = {
        path: this._pathFromAddress(address),
        transaction,
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

  signMessage(withAccount, data) {
    return this.signPersonalMessage(withAccount, data);
  }

  // For personal_sign, we need to prefix the message:
  signPersonalMessage(withAccount, message) {
    return new Promise((resolve, reject) => {
      this.unlock()
        .then((deviceStatus) => {
          setTimeout(
            (_) => {
              this.runCommandOnProkeyLink(
                {
                  path: this._pathFromAddress(withAccount),
                  message: this._hex2String(ethUtil.stripHexPrefix(message)),
                },
                CommandType.SignMessage,
              )
                .then((response) => {
                  if (
                    response.address !== ethUtil.toChecksumAddress(withAccount)
                  ) {
                    reject(
                      new Error('signature doesnt match the right address'),
                    );
                  }
                  const signature = `0x${response.signature}`;
                  resolve(signature); // should have prefix
                })
                .catch((e) => {
                  reject(new Error((e && e.toString()) || 'Unknown error'));
                });
              // This is necessary to avoid popup collision
              // between the unlock & sign trezor popups
            },
            deviceStatus === 'just unlocked' ? DELAY_BETWEEN_POPUPS : 0,
          );
        })
        .catch((e) => {
          reject(new Error((e && e.toString()) || 'Unknown error'));
        });
    });
  }

  signTypedData() {
    return Promise.reject(new Error('Not supported on this device'));
  }

  exportAccount() {
    return Promise.reject(new Error('Not supported on this device'));
  }

  /* PRIVATE METHODS */

  _normalize(buf) {
    return ethUtil.bufferToHex(buf).toString();
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

  _hex2String(hexx) {
    const hex = hexx.toString();
    let str = '';
    for (let i = 0; i < hex.length; i += 2) {
      str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    return str;
  }
}

ProkeyKeyring.type = keyringType;
module.exports = ProkeyKeyring;
