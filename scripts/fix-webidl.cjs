// Fix missing worker_threads.markAsUncloneable in Node 22.4.1 for undici / jsdom
const wt = require('node:worker_threads');
if (typeof wt.markAsUncloneable !== 'function') {
  wt.markAsUncloneable = function markAsUncloneable() {};
}
