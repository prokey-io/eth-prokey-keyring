# eth-prokey-keyring

An implementation of MetaMask's [Keyring interface](https://github.com/MetaMask/eth-simple-keyring#the-keyring-class-protocol), that uses a Prokey hardware
wallet for all cryptographic operations.

In most regards, it works in the same way as
[eth-hd-keyring](https://github.com/MetaMask/eth-hd-keyring), but using a Prokey
device. However there are a number of differences:

- Because the keys are stored in the device, operations that rely on the device
  will fail if there is no Prokey device attached.
- Passing an EIP-1559 transaction to `signTransaction`
  requires the firmware version 1.10.4+ for  all Prokey devices.

## Using

In addition to all the known methods from the [Keyring class protocol](https://github.com/MetaMask/eth-simple-keyring#the-keyring-class-protocol),
there are a few others:

- **isUnlocked** : Returns true if we have the public key in memory, which allows to generate the list of accounts at any time

- **unlock** : Opens [Prokey-Link](https://link.prokey.io/) tab and after successful connection with device, exports the extended public key, which is later used to read the available ethereum addresses inside the trezor account.

- **setAccountToUnlock** : the index of the account that you want to unlock in order to use with the signTransaction and signPersonalMessage methods

- **getFirstPage** : returns the first ordered set of accounts from the Prokey account

- **getNextPage** : returns the next ordered set of accounts from the Prokey account based on the current page

- **getPreviousPage** : returns the previous ordered set of accounts from the Prokey account based on the current page

- **forgetDevice** : removes all the device info from memory so the next interaction with the keyring will prompt the user to connect the Prokey device and export the account information

## Contributing

### Setup

- Install [Node.js](https://nodejs.org) version 12
- Install [Yarn v1](https://yarnpkg.com/en/docs/install)
- Run `yarn install` to install dependencies and run any requried post-install scripts

### Testing

Run `yarn test` to run the tests.

## Attributions

This code was inspired by [eth-trezor-keyring](https://github.com/MetaMask/eth-trezor-keyring) and [eth-hd-keyring](https://github.com/MetaMask/eth-hd-keyring)
