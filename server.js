const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const STATIC_PATH = path.join(process.cwd(), "./");

const MIME_TYPES = {
  default: "application/octet-stream",
  html: "text/html; charset=UTF-8",
  js: "application/javascript",
  css: "text/css",
  png: "image/png",
  jpg: "image/jpg",
  gif: "image/gif",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};

async function prepareFile(url) {
  const paths = [STATIC_PATH, url];
  if (url.endsWith("/")) paths.push("index.html");
  let filePath = path.join(...paths);
  const found = filePath.startsWith(STATIC_PATH) &&
    (await fs.promises.access(filePath).then(...[() => true, () => false]));
  if (!found) filePath = STATIC_PATH + "/index.html";
  return {found, ext: path.extname(filePath).substring(1).toLowerCase(), 
          stream: fs.createReadStream(filePath)};
}

const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets:1, keepAliveMses:10000 });
function easyRequest(url, options, mainRes) {
    return new Promise((resolve, reject) => {
    //    options.agent = keepAliveAgent;
        const req = https.request(url, options, res => {
            const chunks = [];
            res.on('data', function(data) { chunks.push(data); });
            res.on('end', function() {
                let resBody = Buffer.concat(chunks);
                if (res.headers['content-type'].includes('application/json'))
                  mainRes.setHeader('Content-Type', 'application/json');
                resolve(resBody);
            })
        });
        req.on('error', reject);
        if(options && options.body) req.write(options.body);
        req.end();
    });
}

function easyParse(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', buffer => { body += buffer.toString(); });
      req.on('end', () => { resolve(body); });
    });
}

let rawProxyKey = process.env.PROXYKEY;
var crypto = require('crypto').webcrypto;

var proxyKey;
importKey(rawProxyKey).then(function(key) {proxyKey = key;});

async function generateKey() { console.log((await crypto.subtle.exportKey("jwk", await crypto.subtle.generateKey({name: "AES-GCM", length: 256}, true, ["encrypt", "decrypt"]))).k); }
function importKey(raw) { return crypto.subtle.importKey("jwk", {alg:"A256GCM", ext:true, k:raw, key_ops:['encrypt', 'decrypt'], kty:"oct"}, "AES-GCM", true, ["encrypt", "decrypt"]); }

async function encrypt(key, payload) {
	let iv = crypto.getRandomValues(new Uint8Array(12));
	return {cipher:_arrayBufferToBase64(await crypto.subtle.encrypt({name: "AES-GCM", iv}, key, new TextEncoder().encode(JSON.stringify(payload)))), 
			iv:_arrayBufferToBase64(iv)};	
}

async function decrypt(key, cipherPackage) {
	return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name: "AES-GCM", iv:_base64ToArrayBuffer(cipherPackage.iv)}, key, _base64ToArrayBuffer(cipherPackage.cipher))));
}

function _arrayBufferToBase64(buffer) {	return Buffer.from(buffer).toString('base64'); }	
function _base64ToArrayBuffer(base64) {	return Buffer.from(base64, 'base64'); }


http.createServer(async (req, res) => {       
  res.setHeader('Access-Control-Allow-Origin', '*');      
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
  if (req.method == "OPTIONS") res.end();
  else {
    if (req.url.length < 2) {
      const file = await prepareFile(req.url);
      const statusCode = file.found ? 200 : 404;
      res.writeHead(statusCode, {"Content-Type": MIME_TYPES[file.ext] || MIME_TYPES.default});
      file.stream.pipe(res);
      console.log(`${req.method} ${req.url} ${statusCode}`);
    } else if (req.url == "/aes") {
      let aesBody = await easyParse(req);
      let {url, parameters} = await decrypt(proxyKey, JSON.parse(aesBody));
      easyRequest(url, parameters || {method:"GET"}, res).then(function(data) {
        res.write(data);
        res.end();
      });
    } else {
    //  console.log(req.url.substring(1), req.method);
      let body = await easyParse(req);
      let headers = req.headers.string && JSON.parse(req.headers.string);
      if (body && !(headers && headers['content-type']))
        headers['content-type'] = "application/x-www-form-urlencoded";
      easyRequest(req.url.substring(1), {headers, method:req.method, body}, res).then(function(data) {
        res.write(data);
        res.end();
      });
    }
  }
}).listen(process.env.PORT);

