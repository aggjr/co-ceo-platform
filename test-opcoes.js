require('dotenv').config();
const { fetchOpcoesNetOptionQuotes } = require('./dist/core/invest/opcoesNetQuotes.js');
fetchOpcoesNetOptionQuotes(['WEGEF476']).then(res => console.log(res));
