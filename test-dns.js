const dns = require("dns");

dns.resolveSrv(
  "_mongodb._tcp.cluster0.ga6t9b7.mongodb.net",
  (err, addresses) => {
    if (err) {
      console.error("DNS Error:", err);
    } else {
      console.log(addresses);
    }
  }
);