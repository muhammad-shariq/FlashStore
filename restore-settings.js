const fs = require('fs');
const db = require('./backend/db');
const conn = db.open();

const cfg = JSON.parse(fs.readFileSync('./site.config.json', 'utf8'));

function flatten(obj, prefix = '') {
  let result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'object' && v !== null) {
      Object.assign(result, flatten(v, prefix + k + '.'));
    } else {
      result[prefix + k] = v;
    }
  }
  return result;
}

const flat = flatten(cfg);
const save = conn.transaction(() => {
  for (const [key, value] of Object.entries(flat)) {
    const str = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
    db.setSetting(conn, key, str);
  }
});
save();
console.log('Restored settings from site.config.json');
