const bcrypt = require("bcrypt");

bcrypt.hash("Prime@123", 10).then((hash) => {
  console.log(hash);
});