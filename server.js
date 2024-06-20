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

function easyRequest(url, options) {
    return new Promise((resolve, reject) => {
        options.agent = keepAliveAgent;
        const req = https.request(url, options, res => {
            const chunks = [];
            res.on('data', function(data) { chunks.push(data); });
            res.on('end', function() {
                let resBody = Buffer.concat(chunks);
                if (res.headers['content-type'] == 'application/json')
                  resBody = JSON.parse(resBody);
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

const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets:1, keepAliveMses:10000 });

http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');         
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
    } else {
    //  console.log(req.url.substring(1), req.method);
      let body = await easyParse(req);
      let headers = req.headers.string && JSON.parse(req.headers.string);
      if (body && !(headers && headers['content-type']))
        headers['content-type'] = "application/x-www-form-urlencoded";
      easyRequest(req.url.substring(1), {headers, method:req.method, body}).then(function(data) {
        try { res.write(data); }
        catch { res.write(JSON.stringify(data)); }
        res.end();
      });
    }
  }
}).listen(process.env.PORT);

