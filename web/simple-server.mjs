import http from "http";
const port = process.env.PORT || 8080;
http.createServer((req, res) => {
  res.writeHead(200, {"Content-Type":"application/json"});
  res.end(JSON.stringify({ok:true, url:req.url, t:Date.now()}));
}).listen(port, "0.0.0.0", () => console.log("simple server on", port));
