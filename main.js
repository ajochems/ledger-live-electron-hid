require("babel-polyfill");
const TransportNodeHid = require("@ledgerhq/hw-transport-node-hid").default;
const CSC = require("hw-app-csc").default;

var binary = require('casinocoin-libjs-binary-codec');
var CasinocoinAPI = require('casinocoin-libjs').CasinocoinAPI;
var csc_server = "wss://ws01.casinocoin.org:4443";
var feeCSC = '';

let api = new CasinocoinAPI({
  server: csc_server
});

api.connect().then(() => {
  console.log('CasinoCoin Connected');
  api.getServerInfo().then(info => {
    feeCSC = info.validatedLedger.baseFeeCSC;
  });
})
  .catch(e => console.error(e));

const { app, BrowserWindow, ipcMain } = require("electron");

function getCasinoCoinInfo(verify) {
  return TransportNodeHid.open("")
    .then(transport => {
      transport.setDebugMode(true);
      const csc = new CSC(transport);
      return csc.getAddress("44'/144'/0'/0/0", verify).then(r =>
        transport
          .close()
          .catch(e => { })
          .then(() => {
            updateBalance(r);
            setInterval(function() {              
              updateBalance(r);
            }, 5000);
            return r;
          })
      );
    })
    .catch(e => {
      console.warn(e);
      // try again until success!
      return new Promise(s => setTimeout(s, 1000)).then(() =>
        getCasinoCoinInfo(verify)
      );
    });
}

function updateBalance(address) {
  api.getAccountInfo(address.address).then(info => {
    mainWindow.webContents.send("updateBalance", info.cscBalance);
  }).catch(e => {
    mainWindow.webContents.send("updateBalance", "0");
  });
}

function getCasinoCoinSignTransaction(destination_address, destination_tag, amount) {
  TransportNodeHid.open("")
    .then(transport => {

      transport.setDebugMode(true);
      const csc = new CSC(transport);

      const instructions = {
        maxLedgerVersionOffset: 5,
        fee: feeCSC
      };

      destination_address = destination_address ? destination_address : 'cHb9CJAWyB4cj91VRWn96DkukG4bwdtyTh';
      amount = amount ? amount : "1";

      csc.getAddress("44'/144'/0'/0/0").then(address => {
        console.log('Source: ', address.address);
        console.log('Destination: ', destination_address);
        console.log('Amount: ', amount);

        var source_address = address.address;
        let payment = {
          source: {
            address: source_address,
            maxAmount: {
              value: '10',
              currency: 'CSC'
            }
          },
          destination: {
            address: destination_address,
            amount: {
              currency: "CSC",
              value: amount
            }
          }
        };

        if (destination_tag) {
          payment.destination.tag = destination_tag;
        }

        api.preparePayment(source_address, payment, instructions).then(prepared => {
          const json = JSON.parse(prepared.txJSON);
          json.SigningPubKey = address.publicKey.toUpperCase();
          const rawTx = binary.encode(json);
          let txJSON = binary.decode(rawTx);

          csc.signTransaction("44'/144'/0'/0/0", rawTx).then(sign => {
            txJSON.TxnSignature = sign.toUpperCase();
            const txHEX = binary.encode(txJSON);

            api.submit(txHEX).then(info => {
              console.error(info);
              // return api.disconnect();
            }).catch(e => console.error(e));

          }).catch(e => console.error(e));
        }).catch(e => console.error(e));
      });
    });
}

function redirectToExplorer(address) {
  var explorer = new BrowserWindow({ width: 800, height: 600 });
  var url = "https://explorer.casinocoin.org/address/" + address;

  explorer.loadURL(url);
  explorer.show();

  explorer.on('closed', function() {
    explorer = null;
  });
}

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;

function createWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({ width: 800, height: 600 });
  // and load the index.html of the app.
  mainWindow.loadFile("index.html");
  // Open the DevTools.
  // mainWindow.webContents.openDevTools();
  // Emitted when the window is closed.
  mainWindow.on("closed", function () {
    mainWindow = null;
  });

  ipcMain.on("requestCasinoCoinInfo", () => {
    getCasinoCoinInfo(false).then(result => {
      mainWindow.webContents.send("casinocoinInfo", result);
    });
  });

  ipcMain.on("requestCasinoCoinSignTransaction", (event, arg) => {
    getCasinoCoinSignTransaction(arg[0], arg[1], arg[2]);
  });

  ipcMain.on("redirectToExplorer", (event, arg) => {
    redirectToExplorer(arg);
  });

  ipcMain.on("verifyCasinoCoinInfo", () => {
    getCasinoCoinInfo(true);
  });
}


app.on("ready", createWindow);

app.on("window-all-closed", function () {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", function () {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    createWindow();
  }
});